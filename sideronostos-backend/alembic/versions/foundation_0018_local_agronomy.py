"""Owner-scoped local agronomy drafts and immutable published revisions."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "foundation_0018_local_agronomy"
down_revision: str | None = "foundation_0017_field_workspace"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "local_agronomy_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('draft', 'published')", name="ck_local_agronomy_status"),
        sa.CheckConstraint(
            "(status = 'draft' AND revision IS NULL AND NOT is_active) OR "
            "(status = 'published' AND revision IS NOT NULL)",
            name="ck_local_agronomy_lifecycle",
        ),
    )
    op.create_index(
        "ix_local_agronomy_versions_owner_user_id",
        "local_agronomy_versions",
        ["owner_user_id"],
    )
    op.create_index(
        "uq_local_agronomy_owner_draft",
        "local_agronomy_versions",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'draft'"),
    )
    op.create_index(
        "uq_local_agronomy_owner_active",
        "local_agronomy_versions",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_index(
        "uq_local_agronomy_owner_revision",
        "local_agronomy_versions",
        ["owner_user_id", "revision"],
        unique=True,
        postgresql_where=sa.text("revision IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("local_agronomy_versions")
