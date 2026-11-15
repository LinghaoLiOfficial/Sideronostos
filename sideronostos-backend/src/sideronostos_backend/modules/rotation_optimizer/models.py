"""Owner-scoped, immutable input snapshots and independently saved v2 plans."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
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


class LocalAgronomyVersion(Base):
    __tablename__ = "local_agronomy_versions"
    __table_args__ = (
        Index(
            "uq_local_agronomy_owner_draft",
            "owner_user_id",
            unique=True,
            postgresql_where=text("status = 'draft'"),
        ),
        Index(
            "uq_local_agronomy_owner_active",
            "owner_user_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
