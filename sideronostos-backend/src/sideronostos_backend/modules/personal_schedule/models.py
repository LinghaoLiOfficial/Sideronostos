from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database.base import Base


class PersonalScheduleDay(Base):
    __tablename__ = "personal_schedule_days"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_personal_schedule_days_user_date"),
        Index("ix_personal_schedule_days_user_date", "user_id", "date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    date: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(255))
    items: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class GroupPersonalScheduleDay(Base):
    __tablename__ = "group_personal_schedule_days"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            "date",
            name="uq_group_personal_schedule_days_group_user_date",
        ),
        Index(
            "ix_group_personal_schedule_days_group_user_date",
            "organization_id",
            "user_id",
            "date",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(255))
    items: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
