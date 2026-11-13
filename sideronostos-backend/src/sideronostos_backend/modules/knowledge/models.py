"""Published knowledge is immutable; activation is a separate transactional pointer."""

from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector  # type: ignore[import-untyped]
from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    func,
    literal_column,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..database.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class KBRelease(Base):
    __tablename__ = "knowledge_releases"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="staging")
    manifest_sha256: Mapped[str] = mapped_column(String(64))
    embedding_model: Mapped[str] = mapped_column(String(100))
    embedding_dimensions: Mapped[int] = mapped_column(Integer)
    embedding_namespace: Mapped[str] = mapped_column(String(24))
    recipe: Mapped[str] = mapped_column(String(80))
    report: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class KBActivation(Base):
    __tablename__ = "knowledge_activation"
    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    release_id: Mapped[str] = mapped_column(ForeignKey("knowledge_releases.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"
    release_id: Mapped[str] = mapped_column(ForeignKey("knowledge_releases.id"), primary_key=True)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    canonical_key: Mapped[str] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["release_id", "source_id"], ["knowledge_sources.release_id", "knowledge_sources.id"]
        ),
    )
    release_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(80))
    page: Mapped[int] = mapped_column(Integer)
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    text_sha256: Mapped[str] = mapped_column(String(64))
    lexical_terms: Mapped[str] = mapped_column(Text)
    topics: Mapped[list[str]] = mapped_column(ARRAY(Text))
    product: Mapped[str | None] = mapped_column(String(80), nullable=True)
    product_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    embedding: Mapped[Any | None] = mapped_column(Vector(), nullable=True)


Index(
    "ix_knowledge_chunks_product",
    KnowledgeChunk.release_id,
    KnowledgeChunk.product,
    KnowledgeChunk.product_version,
)
Index(
    "ix_knowledge_chunks_lexical",
    func.to_tsvector(literal_column("'simple'::regconfig"), KnowledgeChunk.lexical_terms),
    postgresql_using="gin",
)


class KnowledgeClaim(Base):
    __tablename__ = "knowledge_claims"
    __table_args__ = (
        ForeignKeyConstraint(
            ["release_id", "source_id"], ["knowledge_sources.release_id", "knowledge_sources.id"]
        ),
    )
    release_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(80))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
