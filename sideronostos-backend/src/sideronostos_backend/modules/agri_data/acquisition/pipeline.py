"""Pipeline orchestration kept separate from the CLI presentation layer."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .appeears import AppEEARSClient, bundle_target_path, ensure_tasks
from .audit import audit, plan
from .budget import StorageBudget
from .config import PipelineConfig
from .geometry import write_fields
from .gpm import fetch_gpm
from .manifest import RunManifest
from .power import fetch_power
from .static_products import fetch_grace, fetch_srtm


def storage_budget(config: PipelineConfig) -> StorageBudget:
    return StorageBudget(
        root=config.root,
        hard_limit_bytes=config.hard_limit_bytes,
        min_free_bytes=config.min_free_bytes,
        product_limits=config.product_budgets,
    )


def initialize(config: PipelineConfig) -> tuple[dict[str, Any], RunManifest]:
    config.ensure_directories()
    config_path = config.root / "config.json"
    if not config_path.exists():
        config.dump(config_path)
    fields_path = config.root / "aoi" / "fields.geojson"
    fields = (
        json.loads(fields_path.read_text())
        if fields_path.exists()
        else write_fields(fields_path, longitude=config.longitude, latitude=config.latitude)
    )
    manifest = RunManifest(
        config.root / "run-manifest.json",
        config={
            "start": config.start.isoformat(),
            "end": config.end.isoformat(),
            "bbox": list(config.bbox),
            "hard_limit_bytes": config.hard_limit_bytes,
            "minimum_free_bytes": config.min_free_bytes,
            "credentials": "Earthdata .netrc; never persisted",
        },
    )
    return fields, manifest


def run_audit(config: PipelineConfig) -> dict[str, Any]:
    _, manifest = initialize(config)
    result = audit(config)
    manifest.add(
        {
            "key": "availability-audit",
            "provider": "NASA CMR and AppEEARS service metadata",
            "path": str(config.root / "audit" / "availability.json"),
            "window": result["window"],
            "coverage": result["products"],
            "appeears": result["appeears"],
        }
    )
    return result


def run_plan(config: PipelineConfig) -> dict[str, Any]:
    _, manifest = initialize(config)
    availability_path = config.root / "audit" / "availability.json"
    availability = (
        json.loads(availability_path.read_text()) if availability_path.exists() else audit(config)
    )
    result = plan(config, storage_budget(config), availability)
    manifest.add(
        {
            "key": "download-plan",
            "provider": "local storage budget planner",
            "path": str(config.root / "audit" / "download-plan.json"),
            "plan": result,
        }
    )
    return result


def run_fetch(
    config: PipelineConfig,
    *,
    products: set[str] | None = None,
    wait_for_appeears: bool = True,
) -> dict[str, Any]:
    fields, manifest = initialize(config)
    selected = products or {"power", "gpm", "smap", "hls", "ecostress", "srtm", "grace"}
    allowed = {"power", "gpm", "smap", "hls", "ecostress", "srtm", "grace"}
    if not selected <= allowed:
        raise ValueError(f"Unknown product(s): {sorted(selected - allowed)}")
    budget = storage_budget(config)
    budget.check()
    result: dict[str, Any] = {}
    with httpx.Client(
        headers={"User-Agent": "Sideronostos-NASA/1.0"}, follow_redirects=True
    ) as client:
        if "power" in selected:
            result["power"] = fetch_power(config, manifest, client)
    if "gpm" in selected:
        result["gpm"] = str(fetch_gpm(config, manifest))
    app_groups = sorted(selected & {"smap", "hls", "ecostress"})
    if app_groups:
        appeears = AppEEARSClient()
        tasks = ensure_tasks(config, fields, appeears, groups=app_groups, manifest=manifest)
        result["appeears_tasks"] = tasks
        if wait_for_appeears:
            completed: dict[str, tuple[str, dict[str, Any], list[dict[str, Any]]]] = {}
            for task_key, task_id in tasks.items():
                status = appeears.wait(task_id)
                completed[task_key] = (task_id, status, appeears.bundle(task_id))
            pending_by_product: dict[str, int] = {}
            for task_key, (task_id, _, files) in completed.items():
                group = task_key.split("-", 1)[0]
                destination = config.root / "raw" / "appeears" / group
                incoming = 0
                for item in files:
                    target = bundle_target_path(
                        destination,
                        task_id=task_id,
                        file_name=str(item.get("file_name") or ""),
                        file_id=str(item["file_id"]),
                        expected_sha256=str(item.get("sha256") or "") or None,
                    )
                    expected = int(item.get("file_size", item.get("size", 0)) or 0)
                    if target.exists():
                        continue
                    part = target.with_suffix(target.suffix + ".part")
                    partial_size = part.stat().st_size if part.exists() else 0
                    incoming += max(0, expected - partial_size)
                pending_by_product[group] = pending_by_product.get(group, 0) + incoming
            budget.check(additional_bytes=sum(pending_by_product.values()))
            for group, incoming in pending_by_product.items():
                budget.check(additional_bytes=incoming, product=group)
            for task_key, (task_id, status, files) in completed.items():
                group = task_key.split("-", 1)[0]
                paths = appeears.download_bundle(
                    task_id=task_id,
                    output=config.root / "raw" / "appeears" / group,
                    budget=budget,
                    product=group,
                    manifest=manifest,
                    files=files,
                )
                result[task_key] = {"status": status.get("status"), "files": len(paths)}
    if "srtm" in selected:
        result["srtm"] = [str(path) for path in fetch_srtm(config, budget, manifest)]
    if "grace" in selected:
        result["grace"] = [str(path) for path in fetch_grace(config, budget, manifest)]
    budget.check()
    return result


def download_completed_appeears(
    config: PipelineConfig, *, products: set[str] | None = None
) -> dict[str, Any]:
    """Download only already-completed AppEEARS tasks; never waits for pending work."""
    _, manifest = initialize(config)
    selected = products or {"smap", "hls", "ecostress"}
    if not selected <= {"smap", "hls", "ecostress"}:
        raise ValueError("completed-only mode accepts smap, hls, and ecostress")
    task_path = config.root / "raw" / "appeears" / "tasks.json"
    if not task_path.exists():
        raise RuntimeError("No AppEEARS task state exists; run fetch --submit-only first")
    state = json.loads(task_path.read_text())
    client = AppEEARSClient()
    completed: list[tuple[str, str, dict[str, Any], list[dict[str, Any]]]] = []
    statuses: dict[str, str] = {}
    for key, entry in state.items():
        group = key.split("-", 1)[0]
        if group not in selected:
            continue
        task_id = str(entry["task_id"])
        status = client.status(task_id)
        state_name = str(status.get("status", "unknown"))
        statuses[key] = state_name
        if state_name.lower() in {"done", "complete", "completed"}:
            completed.append((key, group, status, client.bundle(task_id)))
    budget = storage_budget(config)
    pending_by_product: dict[str, int] = {}
    for task_key, group, _, files in completed:
        destination = config.root / "raw" / "appeears" / group
        task_id = str(state[task_key]["task_id"])
        for item in files:
            target = bundle_target_path(
                destination,
                task_id=task_id,
                file_name=str(item.get("file_name") or ""),
                file_id=str(item["file_id"]),
                expected_sha256=str(item.get("sha256") or "") or None,
            )
            if target.exists():
                continue
            part = target.with_suffix(target.suffix + ".part")
            partial_size = part.stat().st_size if part.exists() else 0
            expected = int(item.get("file_size", item.get("size", 0)) or 0)
            pending_by_product[group] = pending_by_product.get(group, 0) + max(
                0, expected - partial_size
            )
    budget.check(additional_bytes=sum(pending_by_product.values()))
    for group, incoming in pending_by_product.items():
        budget.check(additional_bytes=incoming, product=group)
    downloaded: dict[str, int] = {}
    for key, group, _status, files in completed:
        paths = client.download_bundle(
            task_id=str(state[key]["task_id"]),
            output=config.root / "raw" / "appeears" / group,
            budget=budget,
            product=group,
            manifest=manifest,
            files=files,
        )
        downloaded[key] = len(paths)
    return {
        "mode": "completed-only",
        "statuses": statuses,
        "completed_tasks": len(completed),
        "downloaded_files_by_task": downloaded,
    }
