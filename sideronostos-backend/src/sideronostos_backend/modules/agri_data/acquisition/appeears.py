"""AppEEARS point/area task submission and resumable bundle acquisition."""

from __future__ import annotations

import calendar
import json
import time
from datetime import date
from pathlib import Path
from typing import Any, cast

import httpx

from .auth import earthdata_credentials
from .budget import StorageBudget
from .config import PipelineConfig
from .manifest import RunManifest, atomic_json, download, sha256_file

API = "https://appeears.earthdatacloud.nasa.gov/api"

PRODUCT_LAYERS: dict[str, list[dict[str, str]]] = {
    "smap": [
        {"product": "SPL4SMGP.008", "layer": "Geophysical_Data_sm_surface"},
        {"product": "SPL4SMGP.008", "layer": "Geophysical_Data_sm_rootzone"},
        {"product": "SPL4SMGP.008", "layer": "Geophysical_Data_sm_rootzone_pctl"},
    ],
    "hls": [{"product": "HLSL30.020", "layer": layer} for layer in ("B04", "B05", "B06", "Fmask")]
    + [{"product": "HLSS30.020", "layer": layer} for layer in ("B04", "B8A", "B11", "Fmask")],
    "ecostress": [
        {"product": "ECO_L2T_LSTE.002", "layer": layer}
        for layer in ("LST", "LST_err", "QC", "cloud", "water")
    ]
    + [
        {"product": "ECO_L3T_JET.002", "layer": layer}
        for layer in ("ETdaily", "ETinstUncertainty", "cloud", "water")
    ],
}


def bundle_relative_path(file_name: str, file_id: str) -> Path:
    relative = Path(file_name or file_id)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Unsafe AppEEARS bundle path: {relative}")
    return relative


def bundle_target_path(
    output: Path,
    *,
    task_id: str,
    file_name: str,
    file_id: str,
    expected_sha256: str | None,
) -> Path:
    """Keep bundle paths intact, isolating same-name files with different contents."""
    relative = bundle_relative_path(file_name, file_id)
    target = output / relative
    scoped_target = output / "_task_bundles" / task_id / file_id / relative

    for candidate in (target, scoped_target):
        if not candidate.is_file():
            continue
        if expected_sha256 is None or sha256_file(candidate).lower() == expected_sha256.lower():
            return candidate
    if target.exists():
        return scoped_target
    return target


class AppEEARSClient:
    def __init__(self) -> None:
        username, password = earthdata_credentials()
        login = httpx.post(f"{API}/login", auth=(username, password), timeout=60)
        login.raise_for_status()
        token = login.json().get("token")
        if not token:
            raise RuntimeError("AppEEARS login did not return a token")
        self.client = httpx.Client(
            headers={"Authorization": f"Bearer {token}", "User-Agent": "Sideronostos-NASA/1.0"},
            timeout=120,
        )

    def products(self) -> list[dict[str, Any]]:
        response = self.client.get(f"{API}/product")
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else payload.get("data", [])

    def submit(self, payload: dict[str, Any]) -> str:
        response = self.client.post(f"{API}/task", json=payload)
        response.raise_for_status()
        task_id = response.json().get("task_id")
        if not task_id:
            raise RuntimeError("AppEEARS task response omitted task_id")
        return str(task_id)

    def status(self, task_id: str) -> dict[str, Any]:
        response = self.client.get(f"{API}/task/{task_id}")
        response.raise_for_status()
        return cast(dict[str, Any], response.json())

    def wait(
        self, task_id: str, *, timeout_seconds: int = 21_600, poll_seconds: int = 30
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            status = self.status(task_id)
            state = str(status.get("status", "")).lower()
            if state in {"done", "complete", "completed"}:
                return status
            if state in {"error", "failed", "cancelled", "canceled", "expired"}:
                raise RuntimeError(f"AppEEARS task {task_id} ended with status {state}")
            time.sleep(poll_seconds)
        raise TimeoutError(f"AppEEARS task {task_id} did not complete within {timeout_seconds}s")

    def bundle(self, task_id: str) -> list[dict[str, Any]]:
        response = self.client.get(f"{API}/bundle/{task_id}")
        response.raise_for_status()
        payload = response.json()
        return cast(list[dict[str, Any]], payload.get("files", []))

    def download_bundle(
        self,
        *,
        task_id: str,
        output: Path,
        budget: StorageBudget,
        product: str,
        manifest: RunManifest,
        files: list[dict[str, Any]] | None = None,
    ) -> list[Path]:
        files = files if files is not None else self.bundle(task_id)
        total = 0
        for item in files:
            file_id = str(item["file_id"])
            target = bundle_target_path(
                output,
                task_id=task_id,
                file_name=str(item.get("file_name") or ""),
                file_id=file_id,
                expected_sha256=str(item.get("sha256") or "") or None,
            )
            if target.exists():
                continue
            part = target.with_suffix(target.suffix + ".part")
            partial_size = part.stat().st_size if part.exists() else 0
            expected = int(item.get("file_size", item.get("size", 0)) or 0)
            total += max(0, expected - partial_size)
        budget.check(additional_bytes=total, product=product)
        paths: list[Path] = []
        for item in files:
            file_id = str(item["file_id"])
            destination = bundle_target_path(
                output,
                task_id=task_id,
                file_name=str(item.get("file_name") or ""),
                file_id=file_id,
                expected_sha256=str(item.get("sha256") or "") or None,
            )
            result = download(
                self.client,
                url=f"{API}/bundle/{task_id}/{file_id}",
                destination=destination,
                budget=budget,
                product=product,
                expected_size=int(item.get("file_size", item.get("size", 0)) or 0) or None,
                expected_sha256=str(item.get("sha256") or "") or None,
            )
            manifest.add(
                {
                    "key": f"appeears:{task_id}:{file_id}",
                    "provider": "NASA AppEEARS",
                    "task_id": task_id,
                    "file_id": file_id,
                    "product_group": product,
                    **result,
                }
            )
            paths.append(destination)
        return paths


def _dates(start: date, end: date) -> list[dict[str, str]]:
    return [{"startDate": start.strftime("%m-%d-%Y"), "endDate": end.strftime("%m-%d-%Y")}]


def task_payloads(config: PipelineConfig, fields: dict[str, Any]) -> dict[str, dict[str, Any]]:
    coordinates = []
    from shapely.geometry import shape  # type: ignore[import-untyped]

    for feature in fields["features"]:
        centroid = shape(feature["geometry"]).centroid
        coordinates.append(
            {
                "id": feature["properties"]["field_id"],
                "longitude": centroid.x,
                "latitude": centroid.y,
            }
        )
    point = {
        "task_type": "point",
        "task_name": "sideronostos-iowa-smap-2022-2024",
        "params": {
            "dates": _dates(config.start, config.end),
            "layers": PRODUCT_LAYERS["smap"],
            "coordinates": coordinates,
        },
    }
    output = {"format": {"type": "geotiff"}, "projection": "geographic"}

    def area(name: str, start: date, end: date, layers: list[dict[str, str]]) -> dict[str, Any]:
        return {
            "task_type": "area",
            "task_name": name,
            "params": {
                "dates": _dates(start, end),
                "layers": layers,
                "output": output,
                "geo": fields,
            },
        }

    tasks: dict[str, dict[str, Any]] = {"smap": point}
    for year in range(config.start.year, config.end.year + 1):
        start, end = date(year, 1, 1), date(year, 12, 31)
        for sensor, product in (("l30", "HLSL30.020"), ("s30", "HLSS30.020")):
            layers = [layer for layer in PRODUCT_LAYERS["hls"] if layer["product"] == product]
            key = f"hls-{sensor}-{year}"
            tasks[key] = area(f"sideronostos-{key}", start, end, layers)
        et_layers = [
            layer for layer in PRODUCT_LAYERS["ecostress"] if layer["product"] == "ECO_L3T_JET.002"
        ]
        for quarter, first_month in enumerate((1, 4, 7, 10), start=1):
            last_month = first_month + 2
            first = date(year, first_month, 1)
            last = date(year, last_month, calendar.monthrange(year, last_month)[1])
            key = f"ecostress-et-{year}-q{quarter}"
            tasks[key] = area(f"sideronostos-{key}", first, last, et_layers)
        lst_layers = [
            layer for layer in PRODUCT_LAYERS["ecostress"] if layer["product"] == "ECO_L2T_LSTE.002"
        ]
        for period, first_month in enumerate(range(1, 13, 2), start=1):
            last_month = first_month + 1
            first = date(year, first_month, 1)
            last = date(year, last_month, calendar.monthrange(year, last_month)[1])
            key = f"ecostress-lst-{year}-p{period}"
            tasks[key] = area(f"sideronostos-{key}", first, last, lst_layers)
    return tasks


def ensure_tasks(
    config: PipelineConfig,
    fields: dict[str, Any],
    client: AppEEARSClient,
    *,
    groups: list[str],
    manifest: RunManifest | None = None,
) -> dict[str, str]:
    state_path = config.root / "raw" / "appeears" / "tasks.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    payloads = task_payloads(config, fields)
    requested = [
        key
        for key in payloads
        if key in groups or any(key.startswith(f"{group}-") for group in groups)
    ]
    for key in requested:
        if key not in state:
            state[key] = {"task_id": client.submit(payloads[key]), "payload": payloads[key]}
            atomic_json(state_path, state)
        if manifest is not None:
            manifest.add(
                {
                    "key": f"appeears-task:{key}",
                    "provider": "NASA AppEEARS",
                    "task_id": state[key]["task_id"],
                    "product_group": key.split("-", 1)[0],
                    "request": state[key].get("payload", payloads[key]),
                    "state_path": str(state_path),
                }
            )
    return {key: str(state[key]["task_id"]) for key in requested}
