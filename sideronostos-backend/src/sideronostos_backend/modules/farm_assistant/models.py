from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..database.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class FarmerPreference(Base):
    __tablename__ = "assistant_preferences"
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    language: Mapped[str] = mapped_column(String(8), default="zh")
    detail: Mapped[str] = mapped_column(String(12), default="brief")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Conversation(Base):
    __tablename__ = "assistant_conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    preset: Mapped[str] = mapped_column(String(30), default="rotation")
    language: Mapped[str] = mapped_column(String(8), default="zh")
    detail: Mapped[str] = mapped_column(String(12), default="brief")
    kb_release_id: Mapped[str] = mapped_column(ForeignKey("knowledge_releases.id"))
    next_sequence: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id", "client_message_id", name="uq_assistant_client_message"
        ),
        UniqueConstraint("conversation_id", "sequence", name="uq_assistant_message_sequence"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("assistant_conversations.id"), index=True
    )
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    client_message_id: Mapped[str] = mapped_column(String(80))
    payload_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="pending")
    text: Mapped[str] = mapped_column(Text)
    context_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    evidence_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
