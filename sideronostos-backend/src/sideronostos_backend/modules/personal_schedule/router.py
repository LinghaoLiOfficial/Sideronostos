from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from .models import PersonalScheduleDay

router = APIRouter(prefix="/users/me/personal-schedule", tags=["personal-schedule"])


class ScheduleDayBody(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    items: list[str] = Field(max_length=100)


def _details(item: PersonalScheduleDay) -> dict[str, Any]:
    return {"title": item.title, "items": item.items}


@router.get("")
async def list_schedule(
    user: Annotated[AuthPrincipal, Depends(require_verified_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    year: int = Query(..., ge=1, le=9999),
) -> dict[str, Any]:
    rows = (
        await session.scalars(
            select(PersonalScheduleDay)
            .where(
                PersonalScheduleDay.user_id == user.id,
                extract("year", PersonalScheduleDay.date) == year,
            )
            .order_by(PersonalScheduleDay.date)
        )
    ).all()
    return {"year": year, "days": {item.date.isoformat(): _details(item) for item in rows}}


@router.put("/{day}")
async def save_schedule_day(
    day: date,
    body: ScheduleDayBody,
    user: Annotated[AuthPrincipal, Depends(require_verified_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    item = await session.scalar(
        select(PersonalScheduleDay).where(
            PersonalScheduleDay.user_id == user.id,
            PersonalScheduleDay.date == day,
        )
    )
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Schedule title is required")
    items = [value.strip() for value in body.items]
    if any(not value for value in items):
        raise HTTPException(status_code=422, detail="Schedule items cannot be empty")
    if item is None:
        item = PersonalScheduleDay(user_id=user.id, date=day, title=title, items=items)
        session.add(item)
    else:
        item.title = title
        item.items = items
        item.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(item)
    return {"date": item.date.isoformat(), **_details(item), "updated_at": item.updated_at}
