from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field as PydField
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from .schemas import (
    Analysis,
    Contract,
    Environment,
    Field,
    FieldInput,
    Name,
    PlanningInputs,
    SavedPlan,
)
from .service import FieldShiftService

router = APIRouter(prefix="/field-shift", tags=["field-shift"])
User = Annotated[AuthPrincipal, Depends(require_verified_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


class FieldPatch(FieldInput):
    expected_version: int = PydField(strict=True, ge=1)


class AnalysisCreate(PlanningInputs):
    expected_field_version: int = PydField(strict=True, ge=1)


class PlanCreate(Contract):
    analysis_id: str = PydField(min_length=1, max_length=100)
    option_id: str = PydField(min_length=1, max_length=100)
    title: Name
    notes: str = PydField(max_length=5000)


@router.get("/profiles")
async def list_profiles() -> dict[str, object]:
    from .profiles import get_profiles

    return {"items": get_profiles()}


@router.get("/fields")
async def list_fields(
    user: Annotated[AuthPrincipal, Depends(require_verified_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, object]:
    return {"items": await FieldShiftService().list_fields(session, user.id)}


@router.post("/fields", status_code=201, response_model=Field)
async def create_field(body: FieldInput, user: User, session: Session) -> Field:
    return await FieldShiftService().create_field(session, user.id, body)


@router.get("/fields/{field_id}", response_model=Field)
async def get_field(field_id: str, user: User, session: Session) -> Field:
    return await FieldShiftService().get_field(session, user.id, field_id)


@router.patch("/fields/{field_id}", response_model=Field)
async def update_field(field_id: str, body: FieldPatch, user: User, session: Session) -> Field:
    field_input = FieldInput.model_validate(
        body.model_dump(exclude={"expected_version"}, exclude_unset=True)
    )
    return await FieldShiftService().update_field(
        session, user.id, field_id, field_input, body.expected_version
    )


@router.get("/fields/{field_id}/environment", response_model=Environment)
async def get_environment(
    field_id: str,
    user: User,
    session: Session,
    refresh: bool = False,
) -> Environment:
    return await FieldShiftService().get_environment(session, user.id, field_id, refresh=refresh)


@router.post("/fields/{field_id}/analyses", status_code=201, response_model=Analysis)
async def create_analysis(
    field_id: str, body: AnalysisCreate, user: User, session: Session
) -> Analysis:
    inputs = PlanningInputs.model_validate(body.model_dump(exclude={"expected_field_version"}))
    return await FieldShiftService().create_analysis(
        session, user.id, field_id, inputs, body.expected_field_version
    )


@router.get("/analyses/{analysis_id}", response_model=Analysis)
async def get_analysis(analysis_id: str, user: User, session: Session) -> Analysis:
    return await FieldShiftService().get_analysis(session, user.id, analysis_id)


@router.get("/plans")
async def list_plans(
    user: User, session: Session, field_id: str | None = None
) -> dict[str, object]:
    return {"items": await FieldShiftService().list_plans(session, user.id, field_id)}


@router.post("/plans", status_code=201, response_model=SavedPlan)
async def save_plan(body: PlanCreate, user: User, session: Session) -> SavedPlan:
    return await FieldShiftService().save_plan(
        session, user.id, body.analysis_id, body.option_id, body.title, body.notes
    )


@router.get("/plans/{plan_id}", response_model=SavedPlan)
async def get_plan(plan_id: str, user: User, session: Session) -> SavedPlan:
    return await FieldShiftService().get_plan(session, user.id, plan_id)
