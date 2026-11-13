"""Owner-scoped v2 runs with atomic jobs and frozen saved plans."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "foundation_0015_rotation"
down_revision: str | None = "foundation_0014_agri_data"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rotation_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id"), nullable=False, unique=True),
        sa.Column("input_snapshot", JSONB(), nullable=False),
        sa.Column("result", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "idempotency_key", name="uq_rotation_owner_key"),
    )
    op.create_index("ix_rotation_runs_owner_user_id", "rotation_runs", ["owner_user_id"])
    op.create_table(
        "rotation_saved_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("rotation_runs.id"), nullable=False),
        sa.Column("option_id", sa.String(80), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "owner_user_id", "run_id", "option_id", name="uq_rotation_saved_option"
        ),
    )
    op.create_index(
        "ix_rotation_saved_plans_owner_user_id", "rotation_saved_plans", ["owner_user_id"]
    )


def downgrade() -> None:
    op.drop_table("rotation_saved_plans")
    op.drop_table("rotation_runs")
