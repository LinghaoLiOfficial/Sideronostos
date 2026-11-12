"""Published scientific data and private immutable map selections."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "foundation_0014_agri_data"
down_revision: str | None = "foundation_0013_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agri_data_releases",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=True),
        sa.Column("product", sa.String(60), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("manifest_sha256", sa.String(64), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agri_data_releases_owner_user_id", "agri_data_releases", ["owner_user_id"])
    op.create_table(
        "agri_data_selections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_agri_data_selections_owner_user_id", "agri_data_selections", ["owner_user_id"]
    )


def downgrade() -> None:
    op.drop_table("agri_data_selections")
    op.drop_table("agri_data_releases")
