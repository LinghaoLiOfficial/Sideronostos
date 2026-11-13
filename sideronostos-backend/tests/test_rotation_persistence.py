"""Real PostgreSQL transactions; weather below is explicitly a synthetic fixture."""

import asyncio
import os
from datetime import date, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core import installed_models  # noqa: F401
from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.agri_data.models import ScienceRelease
from sideronostos_backend.modules.field_shift.models import FieldRecord
from sideronostos_backend.modules.jobs.models import Job, OutboxMessage
from sideronostos_backend.modules.rotation_optimizer.models import OptimizationRun
from sideronostos_backend.modules.rotation_optimizer.requests import RunRequest
from sideronostos_backend.modules.rotation_optimizer.service import RotationService

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def setup():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL database required")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Test database required")
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner = str(uuid4())
    fid = str(uuid4())
    start = date(2025, 1, 1)
    weather = {
        "latitude": 42,
        "longitude": -93.5,
        "elevation_m": 310,
        "units": {"ALLSKY_SFC_SW_DWN": "MJ/m^2/day"},
        "source_kind": "synthetic_test_only",
        "days": [
            {
                "date": (start + timedelta(days=i)).isoformat(),
                "tmin_c": 12,
                "tmax_c": 24,
                "tdew_c": 10,
                "rain_mm": 2,
                "wind_2m_ms": 2,
                "pressure_kpa": 97,
                "shortwave": 15,
            }
            for i in range(365)
        ],
    }
    async with factory() as s:
        existing = await s.get(ScienceRelease, "power-iowa-2025-v1")
        if existing:
            await s.delete(existing)
            await s.flush()
        s.add(
            ScienceRelease(
                id="power-iowa-2025-v1",
                product="NASA_POWER_DAILY",
                status="published",
                manifest_sha256="b" * 64,
                data=weather,
            )
        )
        s.add(
            FieldRecord(
                id=fid,
                owner_user_id=owner,
                data={
                    "name": "Test field",
                    "area_ha": 2,
                    "latitude": 42,
                    "longitude": -93.5,
                    "soil_texture": "loam",
                    "irrigation_available": True,
                    "profile_id": "temperate-demo",
                    "history": [],
                },
            )
        )
        await s.commit()
    request = RunRequest.model_validate(
        {
            "idempotency_key": "case-" + uuid4().hex,
            "profile_id": "iowa-benchmark-20261112-v1",
            "fields": [{"id": fid, "expected_version": 1, "history_reviewed": True}],
            "start": "2027-01-01",
            "end": "2027-12-31",
            "allowed_crop_ids": ["maize", "pea"],
            "farm_limits": {"2027": {"water_m3": 50000, "cost_usd": 10000, "labor_days": 100}},
            "accept_benchmark_assumptions": True,
        }
    )
    yield factory, owner, fid, request
    tables = [
        t for t in Base.metadata.sorted_tables if t.name.startswith(("rotation_", "assistant_"))
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.drop_all(c, tables=tables))
    await engine.dispose()


async def test_run_atomic_idempotency_owner_and_payload_conflicts(setup):
    factory, owner, fid, request = setup
    service = RotationService()

    async def create():
        async with factory() as s:
            return await service.create_run(s, owner, request)

    a, b = await asyncio.gather(create(), create())
    assert a["id"] == b["id"] and a["job_id"] == b["job_id"]
    async with factory() as s:
        job = await s.get(Job, a["job_id"])
        assert job.created_by == owner and job.idempotency_key.startswith(owner + ":")
        assert (
            await s.scalar(
                select(func.count())
                .select_from(OutboxMessage)
                .where(OutboxMessage.aggregate_id == job.id)
            )
            == 1
        )
        with pytest.raises(HTTPException) as denied:
            await service.get_run(s, "other-owner", a["id"])
        assert denied.value.status_code == 404
        changed = request.model_copy(
            update={"scenario": request.scenario.model_copy(update={"rainfall_change_pct": -10})}
        )
        with pytest.raises(HTTPException) as conflict:
            await service.create_run(s, owner, changed)
        assert conflict.value.status_code == 409
        await s.rollback()
        assert (await s.get(OptimizationRun, a["id"])).input_snapshot["weather"][
            "source_kind"
        ] == "synthetic_test_only"


async def test_cancel_generation_rejects_late_result_and_snapshot_is_frozen(setup):
    factory, owner, fid, request = setup
    service = RotationService()
    async with factory() as s:
        run = await service.create_run(s, owner, request)
        field = await s.get(FieldRecord, fid)
        field.data = {**field.data, "area_ha": 999}
        field.version += 1
        await s.commit()
        snapshot = (await s.get(OptimizationRun, run["id"])).input_snapshot
        assert snapshot["planning_fields"][0]["area_ha"] == 2
        cancelled = await service.cancel_run(s, owner, run["id"])
        assert cancelled["status"] == "cancelled"
        assert not await service.publish_result(
            s, run["id"], run["generation"], {"status": "optimal", "options": []}
        )
        assert (await service.get_run(s, owner, run["id"]))["status"] == "cancelled"


@pytest.mark.parametrize("change", ["cancel", "new_generation"])
async def test_generic_worker_cannot_overwrite_cancellation_or_retry(setup, change):
    from sideronostos_backend.core.modules import JobHandlerSpec
    from sideronostos_backend.modules.jobs.worker import build_job_activity
    from sideronostos_backend.modules.jobs.service import JobService

    factory, owner, _, _ = setup
    entered = asyncio.Event()
    finish = asyncio.Event()

    async def handler(job_id, payload):
        entered.set()
        await finish.wait()
        return {"late": True}

    async with factory() as s:
        job = await JobService().enqueue(
            s, job_type="test.guard", payload={}, idempotency_key=uuid4().hex, created_by=owner
        )
        await s.commit()
        identifier = job.id
    activity = build_job_activity(factory, (JobHandlerSpec("test.guard", handler),))
    running = asyncio.create_task(activity({"job_id": identifier, "attempt": 1}))
    await asyncio.wait_for(entered.wait(), 3)
    async with factory() as s:
        job = await s.get(Job, identifier)
        if change == "cancel":
            job.status = "cancelling"
        else:
            job.generation += 1
            job.attempt += 1
            job.status = "pending"
        await s.commit()
    finish.set()
    await running
    async with factory() as s:
        job = await s.get(Job, identifier)
        assert job.status == ("cancelled" if change == "cancel" else "pending")
        assert job.result is None


async def test_real_worker_verifies_baseline_and_saved_evidence_reopens(setup):
    from sideronostos_backend.modules.rotation_optimizer.jobs import run_job

    factory, owner, fid, request = setup
    service = RotationService()
    async with factory() as s:
        run = await service.create_run(s, owner, request)
        job = await s.get(Job, run["job_id"])
        payload = job.payload
    outcome = await run_job(factory, run["job_id"], payload)
    assert outcome["published"] and outcome["status"] == "optimal"
    async with factory() as s:
        result = await service.get_run(s, owner, run["id"])
        assert result["result"]["options"][0]["scientific_verification"]["valid"]
        assert result["result"]["options"][0]["verification"]["valid"]
        saved = await service.save_plan(
            s,
            owner,
            run["id"],
            "option-1",
            "Reviewed test plan",
            "Test fixture, not a farm recommendation",
        )
        again = await service.save_plan(
            s, owner, run["id"], "option-1", "Ignored duplicate title", ""
        )
        assert saved["id"] == again["id"]
    async with factory() as s:
        reopened = await service.get_plan(s, owner, saved["id"])
        assert reopened["input_snapshot"]["fields"][0]["id"] == fid
        assert reopened["option"]["seasons"]
        with pytest.raises(HTTPException) as denied:
            await service.get_plan(s, "other", saved["id"])
        assert denied.value.status_code == 404


async def test_obsolete_worker_heartbeat_cannot_extend_new_generation_lease(setup):
    from datetime import UTC, datetime, timedelta
    from sideronostos_backend.modules.jobs.models import JobExecutionLease
    from sideronostos_backend.modules.jobs.worker import renew_job_lease

    factory, owner, _, request = setup
    async with factory() as session:
        run = await RotationService().create_run(session, owner, request)
        job = await session.get(Job, run["job_id"])
        job.status = "running"
        before = datetime.now(UTC) - timedelta(seconds=10)
        lease = JobExecutionLease(
            job_id=job.id,
            job_type=job.job_type,
            owner=f"job/{job.id}/{job.attempt}",
            heartbeat_at=before,
            expires_at=before,
        )
        session.add(lease)
        attempt, generation = job.attempt, job.generation
        await session.commit()
    assert await renew_job_lease(factory, run["job_id"], attempt, generation)
    async with factory() as session:
        lease = await session.get(JobExecutionLease, run["job_id"])
        renewed = lease.heartbeat_at
        assert renewed > before
        job = await session.get(Job, run["job_id"])
        job.attempt += 1
        job.generation += 1
        lease.owner = f"job/{job.id}/{job.attempt}"
        await session.commit()
    assert not await renew_job_lease(factory, run["job_id"], attempt, generation)
    async with factory() as session:
        lease = await session.get(JobExecutionLease, run["job_id"])
        assert lease.heartbeat_at == renewed
