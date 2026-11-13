"""Owner-scoped, immutable input snapshots and independently saved v2 plans."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..database.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class OptimizationRun(Base):
    __tablename__ = "rotation_runs"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "idempotency_key", name="uq_rotation_owner_key"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(80))
    payload_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    generation: Mapped[int] = mapped_column(Integer, default=1)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), unique=True)
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SavedOptimizationPlan(Base):
    __tablename__ = "rotation_saved_plans"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "run_id", "option_id", name="uq_rotation_saved_option"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("rotation_runs.id"))
    option_id: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(120))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
