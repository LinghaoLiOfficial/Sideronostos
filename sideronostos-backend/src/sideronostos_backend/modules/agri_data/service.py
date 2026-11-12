"""Read published local scientific assets. This service never calls a NASA API."""

import asyncio
import hashlib
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .adapters.smap_l3 import point_fact, raster_tile
from .models import RegionSelection, ScienceRelease
from .schemas import GEOD, SelectionInput, validate_geometry
from .settings import get_agri_data_settings


def _selection(row: RegionSelection) -> dict[str, Any]:
    return {
        "id": row.id,
        "revision": row.revision,
        "kind": row.kind,
        **row.data,
        "created_at": row.created_at.isoformat(),
    }


def _scope(user_id: str) -> Any:
    return or_(ScienceRelease.owner_user_id.is_(None), ScienceRelease.owner_user_id == user_id)


@lru_cache(maxsize=2)
def _grid(path_string: str, sha256: str) -> dict[str, Any]:
    path = Path(path_string)
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != sha256:
        raise ValueError("Scientific asset integrity check failed")
    with np.load(path, allow_pickle=False) as archive:
        return dict(archive)


def _asset(release: ScienceRelease, orbit: str) -> dict[str, Any]:
    root = get_agri_data_settings().asset_root.resolve()
    name = release.data["passes"][orbit]["asset"]
    path = (root / release.id / name).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Asset escapes science root")
    return _grid(str(path), release.data["passes"][orbit]["asset_sha256"])


def _smap_fact(release: ScienceRelease, orbit: str, coordinates: list[float]) -> dict[str, Any]:
    return point_fact(_asset(release, orbit), *coordinates)


def _source(release: ScienceRelease) -> dict[str, Any]:
    return {
        "release_id": release.id,
        "product": release.product,
        "product_version": release.data.get("product_version"),
        "sha256": release.manifest_sha256,
        "recipe": release.data["recipe"],
        "raw_sha256": release.data.get("sha256", release.data.get("content_sha256")),
        "url": release.data.get(
            "guide_url", "https://power.larc.nasa.gov/docs/services/api/temporal/daily/"
        ),
    }


class AgriDataService:
    async def create_selection(
        self, session: AsyncSession, user_id: str, body: SelectionInput
    ) -> dict[str, Any]:
        row = RegionSelection(
            owner_user_id=user_id,
            revision=body.revision,
            kind=body.kind,
            data=validate_geometry(body.geometry),
        )
        session.add(row)
        await session.commit()
        return _selection(row)

    async def get_selection(
        self,
        session: AsyncSession,
        user_id: str,
        identifier: str,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        row = await session.scalar(
            select(RegionSelection).where(
                RegionSelection.id == identifier, RegionSelection.owner_user_id == user_id
            )
        )
        if row is None:
            raise HTTPException(404, "Selection not found")
        if expected_revision is not None and row.revision != expected_revision:
            raise HTTPException(409, "Selection revision changed")
        return _selection(row)

    async def get_release(
        self, session: AsyncSession, user_id: str, release_id: str
    ) -> ScienceRelease:
        row = await session.scalar(
            select(ScienceRelease).where(
                ScienceRelease.id == release_id,
                ScienceRelease.status == "published",
                _scope(user_id),
            )
        )
        if row is None:
            raise HTTPException(404, "Published science release not found")
        return row

    async def weather(self, session: AsyncSession, user_id: str, release_id: str) -> dict[str, Any]:
        row = await self.get_release(session, user_id, release_id)
        if row.product != "NASA_POWER_DAILY":
            raise HTTPException(422, "Release does not contain daily weather")
        return {**row.data, "release_id": row.id, "manifest_sha256": row.manifest_sha256}

    async def layers(self, session: AsyncSession, user_id: str) -> list[dict[str, Any]]:
        rows = (
            await session.scalars(
                select(ScienceRelease).where(
                    ScienceRelease.status == "published",
                    ScienceRelease.product == "SPL3SMP_E",
                    _scope(user_id),
                )
            )
        ).all()
        return [
            {
                "id": f"{row.id}:{orbit.lower()}",
                "release_id": row.id,
                "pass": orbit,
                "title": f"SMAP surface soil moisture · {orbit}",
                "start": row.data["start"],
                "end": row.data["end"],
                "unit": "m3/m3",
                "source": _source(row),
            }
            for row in rows
            for orbit in row.data["passes"]
        ]

    async def layer_manifest(
        self, session: AsyncSession, user_id: str, layer_id: str
    ) -> dict[str, Any]:
        release_id, separator, orbit = layer_id.rpartition(":")
        if not separator or orbit not in ("am", "pm"):
            raise HTTPException(404, "Layer not found")
        row = await self.get_release(session, user_id, release_id)
        if row.product != "SPL3SMP_E" or orbit.upper() not in row.data["passes"]:
            raise HTTPException(404, "Layer not found")
        return {
            "id": layer_id,
            "type": "raster",
            "tile_size": 256,
            "minzoom": 0,
            "maxzoom": 12,
            "tiles": [f"/agri-data/layers/{layer_id}/tiles/{{z}}/{{x}}/{{y}}"],
            "bounds": row.data["bounds"],
            "start": row.data["start"],
            "end": row.data["end"],
            "pass": orbit.upper(),
            "unit": "m3/m3",
            "legend": {
                "min": 0.02,
                "max": 0.50,
                "colors": ["#a86837", "#dac480", "#5daa9f", "#245e97"],
                "missing": "transparent",
            },
            "resampling": "nearest_native_cell",
            "spatial_support": row.data["grid_spacing_label"],
            "limitations": row.data["limitations"],
            "source": _source(row),
        }

    async def tile(
        self, session: AsyncSession, user_id: str, layer_id: str, z: int, x: int, y: int
    ) -> bytes:
        manifest = await self.layer_manifest(session, user_id, layer_id)
        row = await self.get_release(session, user_id, manifest["source"]["release_id"])

        def render() -> bytes:
            return raster_tile(_asset(row, manifest["pass"]), z, x, y)

        try:
            return await asyncio.to_thread(render)
        except (ValueError, OSError):
            raise HTTPException(503, "Layer asset is unavailable or invalid") from None

    async def facts(
        self,
        session: AsyncSession,
        user_id: str,
        selection_id: str,
        *,
        start: date | None = None,
        end: date | None = None,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        selection = await self.get_selection(session, user_id, selection_id, expected_revision)
        if (start is None) != (end is None) or (
            start and end and (end < start or (end - start).days > 1095)
        ):
            raise HTTPException(422, "Provide an ordered date window of at most three years")
        result: dict[str, Any] = {
            "selection": selection,
            "facts": [],
            "unavailable": [],
            "online_fetch_performed": False,
        }
        if selection["kind"] != "point":
            result["unavailable"].append(
                {
                    "reason": "no_prepared_area_statistics",
                    "detail": (
                        "Native grid layers are available; "
                        "this polygon has no published area statistics."
                    ),
                }
            )
            return result
        rows = (
            await session.scalars(
                select(ScienceRelease)
                .where(ScienceRelease.status == "published", _scope(user_id))
                .order_by(ScienceRelease.id)
            )
        ).all()
        for row in rows:
            source_start = date.fromisoformat(row.data["start"][:10])
            source_end = date.fromisoformat(row.data["end"][:10])
            if start and end and (end < source_start or start > source_end):
                result["unavailable"].append(
                    {"release_id": row.id, "reason": "outside_time_coverage"}
                )
                continue
            if row.product == "SPL3SMP_E":
                for orbit in row.data["passes"]:
                    try:
                        fact = await asyncio.to_thread(_smap_fact, row, orbit, selection["center"])
                    except (OSError, ValueError):
                        result["unavailable"].append(
                            {"release_id": row.id, "reason": "asset_unavailable"}
                        )
                        continue
                    result["facts"].append(
                        {
                            "id": f"{row.id}:{orbit}:surface_moisture",
                            "metric": "surface_soil_moisture",
                            **fact,
                            "pass": orbit,
                            "period": {"start": row.data["start"], "end": row.data["end"]},
                            "data_kind": "satellite_retrieval",
                            "source": _source(row),
                            "limitations": row.data["limitations"],
                        }
                    )
            elif row.product == "NASA_POWER_DAILY":
                longitude, latitude = selection["center"]
                _, _, distance = GEOD.inv(
                    longitude, latitude, row.data["longitude"], row.data["latitude"]
                )
                # This is an application matching radius, not a claimed pixel resolution.
                if distance > 1000:
                    result["unavailable"].append(
                        {"release_id": row.id, "reason": "no_prepared_weather_for_location"}
                    )
                    continue
                first, last = start or source_start, end or source_end
                days = [
                    day
                    for day in row.data["days"]
                    if first.isoformat() <= day["date"] <= last.isoformat()
                ]
                expected = (last - first).days + 1
                for field, metric, unit in [
                    ("rain_mm", "rainfall_total", "mm"),
                    ("et0_mm", "reference_et0_total", "mm"),
                ]:
                    values = [day[field] for day in days if day.get(field) is not None]
                    result["facts"].append(
                        {
                            "id": f"{row.id}:{metric}:{first}:{last}",
                            "metric": metric,
                            "value": sum(values) if len(values) == expected else None,
                            "status": "available"
                            if len(values) == expected
                            else "incomplete_period",
                            "unit": unit,
                            "coverage": {"valid_days": len(values), "expected_days": expected},
                            "period": {
                                "start": first.isoformat(),
                                "end": last.isoformat(),
                                "time_standard": "UTC",
                            },
                            "data_kind": "derived_historical",
                            "spatial_support": "regional_background",
                            "source": _source(row),
                            "source_kind": row.data["source_kind"],
                            "limitations": [
                                "Historical regional data, not future weather or a field sensor.",
                                (
                                    "Reference ET0 is not measured crop water use "
                                    "or an irrigation prescription."
                                ),
                            ],
                        }
                    )
        if not rows:
            result["unavailable"].append({"reason": "no_published_scientific_data"})
        return result
