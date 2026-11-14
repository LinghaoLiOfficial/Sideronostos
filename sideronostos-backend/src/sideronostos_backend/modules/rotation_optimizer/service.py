"""Atomic run/job submission, ownership, frozen inputs and generation-safe publication."""

import hashlib
import json
from copy import deepcopy
from datetime import date
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..agri_data.nasa_release import NASA_BUNDLE_PRODUCT
from ..agri_data.schemas import GEOD
from ..agri_data.service import AgriDataService
from ..field_shift.models import FieldRecord
from ..field_shift.schemas import Field as FieldSnapshot
from ..jobs.models import Job, JobStatus
from ..jobs.service import JobService
from .capacity import CapacityLimits, analyze_snapshot_capacity
from .models import OptimizationRun, SavedOptimizationPlan, utcnow
from .profiles import get_profile, profile_hash
from .requests import PreflightRequest, RunRequest, resolve_history
from .schemas import PlanningField
from .settings import get_rotation_settings

ACTIVE = ("pending", "running")


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def run_view(row: OptimizationRun, *, evidence: bool = False) -> dict[str, Any]:
    result = row.result
    if result and not evidence:
        result = {k: v for k, v in result.items() if k not in ("candidate_traces", "problem")}
    snapshot = row.input_snapshot
    return {
        "id": row.id,
        "job_id": row.job_id,
        "status": row.status,
        "generation": row.generation,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "request": snapshot["request"],
        "field_snapshots": snapshot["fields"],
        "provenance": snapshot["provenance"],
        "result": result,
        **({"input_snapshot": snapshot} if evidence else {}),
    }


class RotationService:
    async def _owned(
        self, session: AsyncSession, owner: str, identifier: str, *, lock: bool = False
    ) -> OptimizationRun:
        query = (
            select(OptimizationRun)
            .where(OptimizationRun.id == identifier, OptimizationRun.owner_user_id == owner)
            .execution_options(populate_existing=True)
        )
        if lock:
            query = query.with_for_update()
        row = await session.scalar(query)
        if row is None:
            raise HTTPException(404, "Rotation run not found")
        return row

    @staticmethod
    def _capacity_limits() -> CapacityLimits:
        settings = get_rotation_settings()
        return CapacityLimits(
            max_candidates=settings.max_candidates,
            max_transition_edges=settings.max_transition_edges,
        )

    async def preflight(
        self, session: AsyncSession, owner: str, body: PreflightRequest
    ) -> dict[str, Any]:
        try:
            profile = get_profile(body.profile_id)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        fields: list[dict[str, Any]] = []
        planning: list[dict[str, Any]] = []
        distances: list[dict[str, Any]] = []
        for choice in body.fields:
            row = await session.scalar(
                select(FieldRecord).where(
                    FieldRecord.id == choice.id, FieldRecord.owner_user_id == owner
                )
            )
            if row is None:
                raise HTTPException(404, "Planning field not found")
            if row.version != choice.expected_version:
                raise HTTPException(409, "A field changed; reload its current version")
            field = FieldSnapshot(
                **row.data,
                id=row.id,
                version=row.version,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            points = [[field.longitude, field.latitude]]
            if field.geometry:
                points.extend(field.geometry["coordinates"][0])
            distance = max(
                abs(
                    GEOD.inv(
                        profile.weather_center[0],
                        profile.weather_center[1],
                        point[0],
                        point[1],
                    )[2]
                )
                / 1000
                for point in points
            )
            if distance > profile.weather_radius_km:
                raise HTTPException(
                    422, "Published benchmark weather does not cover this planning field"
                )
            distances.append({"field_id": field.id, "max_distance_km": distance})
            try:
                history = resolve_history(field, profile, body.start)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            planning.append(
                PlanningField(
                    id=field.id,
                    area_ha=field.area_ha,
                    irrigation_available=field.irrigation_available,
                    require_crop=choice.require_crop,
                    history=history,
                ).model_dump(mode="json")
            )
            fields.append(field.model_dump(mode="json"))
        known = {crop.id for crop in profile.crops}
        if not set(body.allowed_crop_ids) <= known:
            raise HTTPException(422, "Unknown crop for this published profile")
        for crop_id, (first, last) in body.sow_windows.items():
            crop = next((value for value in profile.crops if value.id == crop_id), None)
            if (
                crop is None
                or crop_id not in body.allowed_crop_ids
                or not crop.sow_start_mmdd <= first <= last <= crop.sow_end_mmdd
            ):
                raise HTTPException(
                    422, "Sowing windows may only narrow the selected crop's published window"
                )
        nasa_release = None
        if body.data_release_id:
            nasa_release = await AgriDataService().get_release(session, owner, body.data_release_id)
            if nasa_release.product != NASA_BUNDLE_PRODUCT:
                raise HTTPException(422, "Selected release is not a NASA rotation bundle")
            release = nasa_release.data
            if not release.get("model_usable"):
                raise HTTPException(422, "NASA release is not model-usable")
            release_start = date.fromisoformat(release["start"])
            release_end = date.fromisoformat(release["end"])
            if body.start < release_start or body.end > release_end:
                raise HTTPException(422, "Planning horizon is outside NASA release coverage")
            if release.get("complete_days") != release.get("expected_days"):
                raise HTTPException(422, "NASA core daily inputs are incomplete")
            west, south, east, north = map(float, release["bounds"])
            for field_data in fields:
                points = [[field_data["longitude"], field_data["latitude"]]]
                if field_data.get("geometry"):
                    points.extend(field_data["geometry"]["coordinates"][0])
                if any(
                    not (west <= point[0] <= east and south <= point[1] <= north)
                    for point in points
                ):
                    raise HTTPException(422, "Planning field is outside NASA release coverage")
            weather = {
                **release["weather"],
                "release_id": nasa_release.id,
                "manifest_sha256": nasa_release.manifest_sha256,
            }
        else:
            weather = await AgriDataService().weather(session, owner, profile.weather_release_id)
        snapshot = {
            "request": body.model_dump(mode="json"),
            "fields": fields,
            "planning_fields": planning,
            "profile": profile.model_dump(mode="json"),
            "weather": weather,
        }
        report = analyze_snapshot_capacity(snapshot, self._capacity_limits())
        report["profile_sha256"] = profile_hash(profile)
        return report

    async def create_run(
        self, session: AsyncSession, owner: str, body: RunRequest
    ) -> dict[str, Any]:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "rotation-owner:" + owner}
        )
        payload = body.model_dump(mode="json")
        payload_hash = digest({k: v for k, v in payload.items() if k != "idempotency_key"})
        existing = await session.scalar(
            select(OptimizationRun).where(
                OptimizationRun.owner_user_id == owner,
                OptimizationRun.idempotency_key == body.idempotency_key,
            )
        )
        if existing:
            if existing.payload_hash != payload_hash:
                raise HTTPException(
                    409, "Idempotency key already belongs to different planning inputs"
                )
            return run_view(existing)
        count = await session.scalar(
            select(func.count())
            .select_from(OptimizationRun)
            .where(OptimizationRun.owner_user_id == owner, OptimizationRun.status.in_(ACTIVE))
        )
        if (count or 0) >= get_rotation_settings().max_pending_per_owner:
            raise HTTPException(
                429, "Finish or cancel an existing calculation before starting another"
            )
        try:
            profile = get_profile(body.profile_id)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        fields = []
        planning = []
        distances = []
        for choice in body.fields:
            row = await session.scalar(
                select(FieldRecord)
                .where(FieldRecord.id == choice.id, FieldRecord.owner_user_id == owner)
                .with_for_update()
            )
            if row is None:
                raise HTTPException(404, "Planning field not found")
            if row.version != choice.expected_version:
                raise HTTPException(409, "A field changed; reload its current version")
            field = FieldSnapshot(
                **row.data,
                id=row.id,
                version=row.version,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            points = [[field.longitude, field.latitude]]
            if field.geometry:
                points.extend(field.geometry["coordinates"][0])
            distance = max(
                abs(
                    GEOD.inv(
                        profile.weather_center[0], profile.weather_center[1], point[0], point[1]
                    )[2]
                )
                / 1000
                for point in points
            )
            if distance > profile.weather_radius_km:
                raise HTTPException(
                    422, "Published benchmark weather does not cover this planning field"
                )
            distances.append(
                {
                    "field_id": field.id,
                    "max_distance_km": distance,
                    "interpretation": "benchmark applicability guard, not weather pixel resolution",
                }
            )
            try:
                history = resolve_history(field, profile, body.start)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            planning.append(
                PlanningField(
                    id=field.id,
                    area_ha=field.area_ha,
                    irrigation_available=field.irrigation_available,
                    require_crop=choice.require_crop,
                    history=history,
                ).model_dump(mode="json")
            )
            fields.append(field.model_dump(mode="json"))
        known = {crop.id for crop in profile.crops}
        if not set(body.allowed_crop_ids) <= known or any(
            b.crop_id not in known for b in body.baseline
        ):
            raise HTTPException(422, "Unknown crop for this published profile")
        for crop_id, (first, last) in body.sow_windows.items():
            crop = next((c for c in profile.crops if c.id == crop_id), None)
            if (
                crop is None
                or crop_id not in body.allowed_crop_ids
                or not crop.sow_start_mmdd <= first <= last <= crop.sow_end_mmdd
            ):
                raise HTTPException(
                    422, "Sowing windows may only narrow the selected crop's published window"
                )
        nasa_release = None
        if body.data_release_id:
            nasa_release = await AgriDataService().get_release(session, owner, body.data_release_id)
            if nasa_release.product != NASA_BUNDLE_PRODUCT:
                raise HTTPException(422, "Selected release is not a NASA rotation bundle")
            release = nasa_release.data
            if not release.get("model_usable"):
                raise HTTPException(422, "NASA release is not model-usable")
            release_start = date.fromisoformat(release["start"])
            release_end = date.fromisoformat(release["end"])
            if body.start < release_start or body.end > release_end:
                raise HTTPException(422, "Planning horizon is outside NASA release coverage")
            if release.get("complete_days") != release.get("expected_days"):
                raise HTTPException(422, "NASA core daily inputs are incomplete")
            west, south, east, north = map(float, release["bounds"])
            for field_data in fields:
                points = [[field_data["longitude"], field_data["latitude"]]]
                if field_data.get("geometry"):
                    points.extend(field_data["geometry"]["coordinates"][0])
                if any(
                    not (west <= point[0] <= east and south <= point[1] <= north)
                    for point in points
                ):
                    raise HTTPException(422, "Planning field is outside NASA release coverage")
            weather = {
                **release["weather"],
                "release_id": nasa_release.id,
                "manifest_sha256": nasa_release.manifest_sha256,
            }
        else:
            weather = await AgriDataService().weather(session, owner, profile.weather_release_id)
        snapshot = {
            "schema": "rotation-input-v2.0",
            "request": payload,
            "fields": fields,
            "planning_fields": planning,
            "profile": profile.model_dump(mode="json"),
            "weather": weather,
            "provenance": {
                "profile_id": profile.id,
                "profile_sha256": profile_hash(profile),
                "weather_release_id": weather["release_id"],
                "weather_sha256": weather["manifest_sha256"],
                "data_release_id": nasa_release.id if nasa_release else None,
                "data_release_sha256": nasa_release.manifest_sha256 if nasa_release else None,
                "data_release": (
                    AgriDataService.nasa_release_view(nasa_release) if nasa_release else None
                ),
                "benchmark_scope": profile.scope,
                "spatial_checks": distances,
                "sources": {k: v.model_dump(mode="json") for k, v in profile.sources.items()},
                "parameter_origins": profile.parameter_origins,
                "limitations": profile.limitations,
            },
        }
        limits = self._capacity_limits()
        preflight = analyze_snapshot_capacity(snapshot, limits)
        preflight["profile_sha256"] = profile_hash(profile)
        if not preflight["within_capacity"]:
            raise HTTPException(
                422,
                detail={
                    "code": "rotation_capacity_exceeded",
                    "message": "Rotation candidate capacity exceeded",
                    "preflight": preflight,
                },
            )
        snapshot["capacity"] = limits.as_dict()
        snapshot["preflight"] = preflight
        identifier = str(uuid4())
        job = await JobService().enqueue(
            session,
            job_type="rotation.optimize",
            payload={"run_id": identifier, "owner_user_id": owner},
            idempotency_key=owner + ":" + body.idempotency_key,
            created_by=owner,
            maximum_attempts=2,
            timeout_seconds=150,
            concurrency_limit=1,
        )
        run = OptimizationRun(
            id=identifier,
            owner_user_id=owner,
            idempotency_key=body.idempotency_key,
            payload_hash=payload_hash,
            job_id=job.id,
            input_snapshot=snapshot,
        )
        session.add(run)
        await session.commit()
        return run_view(run)

    async def get_run(
        self, session: AsyncSession, owner: str, identifier: str, *, evidence: bool = False
    ) -> dict[str, Any]:
        row = await self._owned(session, owner, identifier)
        job = await session.get(Job, row.job_id)
        if (
            row.status in ACTIVE
            and job
            and job.status
            in (JobStatus.FAILED, JobStatus.DEAD_LETTERED, JobStatus.ABANDONED, JobStatus.CANCELLED)
        ):
            row = await self._owned(session, owner, identifier, lock=True)
            if row.status in ACTIVE:
                row.status = "cancelled" if job.status == JobStatus.CANCELLED else "failed"
                row.result = {
                    "status": row.status,
                    "error_code": job.error_code or "worker_interrupted",
                }
                row.updated_at = utcnow()
                await session.commit()
        return run_view(row, evidence=evidence)

    async def list_runs(self, session: AsyncSession, owner: str) -> list[dict[str, Any]]:
        rows = (
            await session.scalars(
                select(OptimizationRun)
                .where(OptimizationRun.owner_user_id == owner)
                .order_by(OptimizationRun.created_at.desc())
                .limit(50)
            )
        ).all()
        return [run_view(row) for row in rows]

    async def cancel_run(
        self, session: AsyncSession, owner: str, identifier: str
    ) -> dict[str, Any]:
        row = await self._owned(session, owner, identifier, lock=True)
        if row.status in ACTIVE:
            row.status = "cancelled"
            row.generation += 1
            row.updated_at = utcnow()
            job = await session.get(Job, row.job_id, with_for_update=True)
            if job:
                await JobService().cancel(job)
            await session.commit()
        return run_view(row)

    async def retry_run(self, session: AsyncSession, owner: str, identifier: str) -> dict[str, Any]:
        row = await self._owned(session, owner, identifier, lock=True)
        if row.status not in ("failed", "cancelled", "timeout_no_solution"):
            raise HTTPException(409, "Only failed, cancelled or empty timed-out runs can retry")
        job = await session.get(Job, row.job_id, with_for_update=True)
        if job is None:
            raise HTTPException(409, "Run job is unavailable")
        if job.status in (JobStatus.RUNNING, JobStatus.CANCELLING):
            raise HTTPException(409, "Wait for the previous worker to finish cancelling")
        job.status = JobStatus.FAILED
        await JobService().retry(session, job)
        row.generation += 1
        row.status = "pending"
        row.result = None
        row.updated_at = utcnow()
        await session.commit()
        return run_view(row)

    async def publish_result(
        self, session: AsyncSession, identifier: str, generation: int, result: dict[str, Any]
    ) -> bool:
        row = await session.get(
            OptimizationRun, identifier, with_for_update=True, populate_existing=True
        )
        if row is None or row.generation != generation or row.status not in ACTIVE:
            return False
        row.status = result["status"]
        row.result = result
        row.updated_at = utcnow()
        await session.commit()
        return True

    async def save_plan(
        self,
        session: AsyncSession,
        owner: str,
        identifier: str,
        option_id: str,
        title: str,
        notes: str,
    ) -> dict[str, Any]:
        row = await self._owned(session, owner, identifier, lock=True)
        if row.status in ACTIVE or not row.result:
            raise HTTPException(409, "A completed result is required before saving")
        options = [*row.result.get("options", []), row.result.get("baseline")]
        chosen = next((o for o in options if o and o["id"] == option_id), None)
        if chosen is None:
            raise HTTPException(404, "Option not found in this run")
        if not chosen["feasible"]:
            raise HTTPException(409, "The selected option is not feasible")
        saved = await session.scalar(
            select(SavedOptimizationPlan).where(
                SavedOptimizationPlan.owner_user_id == owner,
                SavedOptimizationPlan.run_id == identifier,
                SavedOptimizationPlan.option_id == option_id,
            )
        )
        if saved is None:
            saved = SavedOptimizationPlan(
                owner_user_id=owner,
                run_id=identifier,
                option_id=option_id,
                title=title,
                data={
                    "schema": "rotation-saved-v2.0",
                    "input_snapshot": deepcopy(row.input_snapshot),
                    "option": deepcopy(chosen),
                    "notes": notes,
                    "run_created_at": row.created_at.isoformat(),
                },
            )
            session.add(saved)
            await session.commit()
        return self.plan_view(saved)

    def plan_view(self, row: SavedOptimizationPlan) -> dict[str, Any]:
        return {
            "id": row.id,
            "run_id": row.run_id,
            "option_id": row.option_id,
            "title": row.title,
            "created_at": row.created_at.isoformat(),
            **row.data,
        }

    async def get_plan(self, session: AsyncSession, owner: str, identifier: str) -> dict[str, Any]:
        row = await session.scalar(
            select(SavedOptimizationPlan).where(
                SavedOptimizationPlan.id == identifier, SavedOptimizationPlan.owner_user_id == owner
            )
        )
        if row is None:
            raise HTTPException(404, "Saved rotation plan not found")
        return self.plan_view(row)

    async def list_plans(self, session: AsyncSession, owner: str) -> list[dict[str, Any]]:
        rows = (
            await session.scalars(
                select(SavedOptimizationPlan)
                .where(SavedOptimizationPlan.owner_user_id == owner)
                .order_by(SavedOptimizationPlan.created_at.desc())
                .limit(50)
            )
        ).all()
        return [
            {
                "id": r.id,
                "title": r.title,
                "run_id": r.run_id,
                "option_id": r.option_id,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
