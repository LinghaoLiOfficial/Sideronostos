"""Owned, active-partition inputs and auditable preflight snapshots for daily v3."""

import hashlib
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agri_data.service import AgriDataService
from ...field_shift.models import FarmRecord, FieldRecord
from ...field_shift.schemas import Field as FieldSnapshot
from .inputs import PlanningDraft
from .preflight import assess_inputs
from .profiles import get_profile, profile_hash
from .weather import prepare_weather


def fingerprint(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()


async def owned_fields(
    session: AsyncSession, owner: str, body: PlanningDraft, *, lock: bool = False
) -> tuple[list[FieldSnapshot], list[dict[str, Any]]]:
    ids = [c.id for c in body.fields]
    query = (
        select(FieldRecord)
        .where(FieldRecord.id.in_(ids), FieldRecord.owner_user_id == owner)
        .order_by(FieldRecord.id)
        .execution_options(populate_existing=True)
    )
    rows = list((await session.scalars(query)).all())
    if len(rows) != len(ids):
        raise HTTPException(404, "Planning field not found")
    farm_ids = {row.farm_id for row in rows if row.farm_id}
    farms_query = (
        select(FarmRecord)
        .where(FarmRecord.id.in_(farm_ids), FarmRecord.owner_user_id == owner)
        .order_by(FarmRecord.id)
        .execution_options(populate_existing=True)
    )
    # Match synchronization's lock order: farms, then their field rows.
    farms = {
        f.id: f
        for f in (
            await session.scalars(farms_query.with_for_update() if lock else farms_query)
        ).all()
    }
    if lock:
        rows = list((await session.scalars(query.with_for_update())).all())
    fields = []
    for row in rows:
        if row.farm_id:
            farm = farms.get(row.farm_id)
            if farm is None:
                raise HTTPException(404, "Planning farm not found")
            if row.partition_revision != farm.data.get("partition_revision"):
                raise HTTPException(
                    409, "This field belongs to an archived farm partition; select a current field"
                )
        fields.append(
            FieldSnapshot(
                **row.data,
                id=row.id,
                version=row.version,
                farm_id=row.farm_id,
                partition_revision=row.partition_revision,
                local_id=row.local_id,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )
    return fields, [
        {"id": f.id, "version": f.version, "local_id": f.local_id, "data": f.data}
        for f in farms.values()
    ]


async def prepare_input_snapshot(
    session: AsyncSession, owner: str, body: PlanningDraft, *, lock: bool = False
) -> dict[str, Any]:
    try:
        profile = get_profile(body.profile_id)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    fields, farms = await owned_fields(session, owner, body, lock=lock)
    report = assess_inputs(body, profile, fields)
    raw = None
    try:
        raw = await AgriDataService().weather(session, owner, profile.weather_release_id)
    except HTTPException as error:
        if error.status_code not in (404, 422):
            raise
        weather = {
            "ready": False,
            "issues": ["weather_release_unavailable"],
            "warnings": [],
            "days": {},
        }
    else:
        weather = prepare_weather(raw, profile, body)
    weather_metadata = {k: v for k, v in weather.items() if k != "days"}
    report["weather"] = weather_metadata
    if not weather["ready"]:
        report["items"].append(
            {
                "path": "weather.release",
                "value": None,
                "unit": "daily weather",
                "expected_unit": "daily weather",
                "sources": [],
                "missing_reason": "No usable published weather covers this profile and calendar",
                "status": "blocked",
                "issues": weather["issues"],
                "warnings": weather["warnings"],
                "engineering_assumption": False,
                "blocks": ["weather"],
            }
        )
        report["blocked_features"] = sorted({*report["blocked_features"], "weather"})
        report["ready"] = False
    report["stage"] = "data_preflight"
    report["farm_versions"] = [
        {
            "id": f["id"],
            "version": f["version"],
            "partition_revision": f["data"].get("partition_revision"),
        }
        for f in farms
    ]
    snapshot = {
        "schema": "rotation-input-v3.0",
        "request": body.model_dump(mode="json"),
        "fields": [f.model_dump(mode="json") for f in fields],
        "farms": farms,
        "profile": profile.model_dump(mode="json"),
        "weather": raw,
        "provenance": {
            "profile_id": profile.id,
            "profile_sha256": profile_hash(profile),
            "weather_release_id": profile.weather_release_id,
            "weather_sha256": raw.get("manifest_sha256") if raw else None,
            "weather_content_sha256": raw.get("content_sha256") if raw else None,
            "benchmark_scope": profile.scope,
            "sources": {k: v.model_dump(mode="json") for k, v in profile.sources.items()},
            "parameter_origins": profile.parameter_origins,
            "spatial_checks": report["spatial_checks"],
            "weather_calendar": weather_metadata,
            "limitations": profile.limitations,
        },
    }
    # Includes actual frozen weather bytes and farm/field versions, not just manifest names.
    report["fingerprint"] = fingerprint(snapshot)
    snapshot["readiness"] = report
    return snapshot


async def readiness(session: AsyncSession, owner: str, body: PlanningDraft) -> dict[str, Any]:
    snapshot = await prepare_input_snapshot(session, owner, body)
    report: dict[str, Any] = snapshot["readiness"]
    return report
