"""Durable, owner-scoped Field Shift documents and immutable evidence snapshots."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class FieldRecord(Base):
    __tablename__ = "field_shift_fields"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    environment_key: Mapped[str | None] = mapped_column(String(180), nullable=True)
    environment_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    environment_cached_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnalysisRecord(Base):
    __tablename__ = "field_shift_analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    field_id: Mapped[str] = mapped_column(ForeignKey("field_shift_fields.id"), index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    field_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SavedPlanRecord(Base):
    __tablename__ = "field_shift_saved_plans"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id", "analysis_id", "option_id", name="uq_field_shift_saved_option"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    field_id: Mapped[str] = mapped_column(ForeignKey("field_shift_fields.id"), index=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("field_shift_analyses.id"), index=True)
    option_id: Mapped[str] = mapped_column(String(100))
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
