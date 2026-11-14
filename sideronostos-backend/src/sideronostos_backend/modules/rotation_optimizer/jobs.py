"""Bounded real MILP work; retries reuse frozen inputs and late generations cannot publish."""

import asyncio
from contextlib import suppress
from threading import Event
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ...core.config import get_settings
from ..database.session import create_engine, create_session_factory
from ..jobs.models import Job, JobStatus
from ..jobs.service import PermanentJobError
from .execution import execute_snapshot
from .models import OptimizationRun, utcnow
from .service import ACTIVE, RotationService
from .settings import get_rotation_settings


async def run_job(
    factory: async_sessionmaker[AsyncSession], job_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    async with factory() as session:
        run = await session.get(OptimizationRun, str(payload["run_id"]), with_for_update=True)
        job = await session.get(Job, job_id)
        if (
            run is None
            or job is None
            or run.job_id != job_id
            or run.owner_user_id != payload.get("owner_user_id")
            or job.created_by != run.owner_user_id
        ):
            raise PermanentJobError(
                "Rotation job relation is invalid", code="rotation_job_relation_invalid"
            )
        if run.status not in ACTIVE:
            return {"run_id": run.id, "status": run.status, "reused": True}
        generation = run.generation
        snapshot = run.input_snapshot
        run.status = "running"
        run.updated_at = utcnow()
        await session.commit()
    stop = Event()

    async def monitor() -> None:
        while True:
            async with factory() as session:
                current = await session.get(OptimizationRun, run.id)
                current_job = await session.get(Job, job_id)
                if (
                    current is None
                    or current.generation != generation
                    or current.status not in ACTIVE
                    or current_job is None
                    or current_job.status in (JobStatus.CANCELLING, JobStatus.CANCELLED)
                ):
                    stop.set()
                    return
            await asyncio.sleep(0.5)

    watch = asyncio.create_task(monitor())
    request_limit = float(snapshot.get("request", {}).get("solver_time_limit_seconds", 30))
    limit = min(get_rotation_settings().solve_seconds, request_limit)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(execute_snapshot, snapshot, time_limit=limit, cancelled=stop.is_set),
            timeout=limit * 2 + 20,
        )
    except asyncio.CancelledError:
        stop.set()
        raise
    except TimeoutError:
        stop.set()
        result = {"status": "failed", "error_code": "execution_deadline_exceeded"}
    except (ValueError, KeyError, TypeError):
        result = {"status": "failed", "error_code": "invalid_frozen_input"}
    finally:
        watch.cancel()
        with suppress(asyncio.CancelledError):
            await watch
    async with factory() as session:
        published = await RotationService().publish_result(session, run.id, generation, result)
    return {
        "run_id": run.id,
        "generation": generation,
        "status": result["status"],
        "published": published,
    }


async def optimize_handler(job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    engine = create_engine(get_settings())
    try:
        return await run_job(create_session_factory(engine), job_id, payload)
    finally:
        await engine.dispose()
