"""Owner-scoped fields, cached climate, analyses and immutable saved plans."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "foundation_0012_field_shift"
down_revision: str | None = "foundation_0011_group_schedule"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "field_shift_fields",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("environment_key", sa.String(180), nullable=True),
        sa.Column("environment_snapshot", sa.JSON(), nullable=True),
        sa.Column("environment_cached_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_field_shift_fields_owner_user_id", "field_shift_fields", ["owner_user_id"])
    op.create_table(
        "field_shift_analyses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column(
            "field_id", sa.String(36), sa.ForeignKey("field_shift_fields.id"), nullable=False
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("field_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_field_shift_analyses_owner_user_id", "field_shift_analyses", ["owner_user_id"]
    )
    op.create_index("ix_field_shift_analyses_field_id", "field_shift_analyses", ["field_id"])
    op.create_table(
        "field_shift_saved_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column(
            "field_id", sa.String(36), sa.ForeignKey("field_shift_fields.id"), nullable=False
        ),
        sa.Column(
            "analysis_id", sa.String(36), sa.ForeignKey("field_shift_analyses.id"), nullable=False
        ),
        sa.Column("option_id", sa.String(100), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "owner_user_id", "analysis_id", "option_id", name="uq_field_shift_saved_option"
        ),
    )
    for column in ("owner_user_id", "field_id", "analysis_id"):
        op.create_index(f"ix_field_shift_saved_plans_{column}", "field_shift_saved_plans", [column])


def downgrade() -> None:
    op.drop_table("field_shift_saved_plans")
    op.drop_table("field_shift_analyses")
    op.drop_table("field_shift_fields")
