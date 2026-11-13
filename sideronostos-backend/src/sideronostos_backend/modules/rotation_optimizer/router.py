from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from .comparison import compare_run_views
from .profiles import list_profiles
from .requests import RunRequest
from .schemas import Contract
from .service import RotationService
from .v3.inputs import PlanningDraft
from .v3.inputs import RunRequest as DailyRunRequest
from .v3.profiles import list_profiles as list_v3_profiles
from .v3.service import readiness as v3_readiness

router = APIRouter(prefix="/rotation-optimizer", tags=["rotation-optimizer"])
User = Annotated[AuthPrincipal, Depends(require_verified_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


class SaveRequest(Contract):
    run_id: str = Field(min_length=1, max_length=100)
    option_id: str = Field(min_length=1, max_length=80)
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    notes: str = Field(default="", max_length=5000)


class CompareRequest(Contract):
    first_run_id: str
    second_run_id: str
    first_option_id: str
    second_option_id: str


@router.get("/profiles")
async def profiles(user: User) -> dict[str, Any]:
    return {"items": list_profiles()}


@router.get("/v3/profiles")
async def daily_profiles(user: User) -> dict[str, Any]:
    return {"items": list_v3_profiles()}


@router.post("/v3/readiness")
async def daily_readiness(
    body: PlanningDraft,
    user: User,
    session: Session,
    workspace_owner: Annotated[str | None, Header(alias="X-Workspace-Owner")] = None,
) -> dict[str, Any]:
    if workspace_owner is not None and workspace_owner != user.id:
        raise HTTPException(409, "Workspace account changed; reload the current account")
    return await v3_readiness(session, user.id, body)


@router.post("/v3/runs", status_code=202)
async def create_daily(
    body: DailyRunRequest,
    user: User,
    session: Session,
    workspace_owner: Annotated[str | None, Header(alias="X-Workspace-Owner")] = None,
) -> dict[str, Any]:
    if workspace_owner is not None and workspace_owner != user.id:
        raise HTTPException(409, "Workspace account changed; reload the current account")
    return await RotationService().create_run(session, user.id, body)


@router.post("/runs", status_code=202)
async def create(body: RunRequest, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().create_run(session, user.id, body)


@router.get("/runs")
async def runs(user: User, session: Session) -> dict[str, Any]:
    return {"items": await RotationService().list_runs(session, user.id)}


@router.get("/runs/{run_id}")
async def get(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().get_run(session, user.id, run_id)


@router.get("/runs/{run_id}/export")
async def export(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().get_run(session, user.id, run_id, evidence=True)


@router.post("/runs/{run_id}/cancel")
async def cancel(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().cancel_run(session, user.id, run_id)


@router.post("/runs/{run_id}/retry", status_code=202)
async def retry(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().retry_run(session, user.id, run_id)


@router.post("/plans", status_code=201)
async def save(body: SaveRequest, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().save_plan(
        session, user.id, body.run_id, body.option_id, body.title.strip(), body.notes
    )


@router.get("/plans")
async def plans(user: User, session: Session) -> dict[str, Any]:
    return {"items": await RotationService().list_plans(session, user.id)}


@router.get("/plans/{plan_id}")
async def plan(plan_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().get_plan(session, user.id, plan_id)


@router.post("/compare")
async def compare(body: CompareRequest, user: User, session: Session) -> dict[str, Any]:
    a = await RotationService().get_run(session, user.id, body.first_run_id)
    b = await RotationService().get_run(session, user.id, body.second_run_id)
    return compare_run_views(a, b, body.first_option_id, body.second_option_id)
