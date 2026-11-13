"""Immutable knowledge releases, exact vectors and bilingual lexical index."""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from alembic import op

revision: str = "foundation_0013_knowledge"
down_revision: str | None = "foundation_0012_field_shift"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "knowledge_releases",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("manifest_sha256", sa.String(64), nullable=False),
        sa.Column("embedding_model", sa.String(100), nullable=False),
        sa.Column("embedding_dimensions", sa.Integer(), nullable=False),
        sa.Column("embedding_namespace", sa.String(24), nullable=False),
        sa.Column("recipe", sa.String(80), nullable=False),
        sa.Column("report", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "knowledge_activation",
        sa.Column("name", sa.String(40), primary_key=True),
        sa.Column(
            "release_id", sa.String(80), sa.ForeignKey("knowledge_releases.id"), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "knowledge_sources",
        sa.Column(
            "release_id", sa.String(80), sa.ForeignKey("knowledge_releases.id"), primary_key=True
        ),
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("canonical_key", sa.Text(), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
    )
    op.create_table(
        "knowledge_chunks",
        sa.Column("release_id", sa.String(80), primary_key=True),
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("text_sha256", sa.String(64), nullable=False),
        sa.Column("lexical_terms", sa.Text(), nullable=False),
        sa.Column("topics", ARRAY(sa.Text()), nullable=False),
        sa.Column("product", sa.String(80), nullable=True),
        sa.Column("product_version", sa.String(80), nullable=True),
        sa.Column("embedding", Vector(), nullable=True),
        sa.ForeignKeyConstraint(
            ["release_id", "source_id"], ["knowledge_sources.release_id", "knowledge_sources.id"]
        ),
    )
    op.execute(
        "CREATE INDEX ix_knowledge_chunks_lexical ON knowledge_chunks "
        "USING gin (to_tsvector('simple'::regconfig, lexical_terms))"
    )
    op.create_index(
        "ix_knowledge_chunks_product",
        "knowledge_chunks",
        ["release_id", "product", "product_version"],
    )
    op.create_table(
        "knowledge_claims",
        sa.Column("release_id", sa.String(80), primary_key=True),
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["release_id", "source_id"], ["knowledge_sources.release_id", "knowledge_sources.id"]
        ),
    )


def downgrade() -> None:
    for table in (
        "knowledge_claims",
        "knowledge_chunks",
        "knowledge_sources",
        "knowledge_activation",
        "knowledge_releases",
    ):
        op.drop_table(table)
    # The shared extension may be used elsewhere; never drop it on module rollback.
