"""Account-backed field management workspaces."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "foundation_0017_field_workspace"
down_revision: str | None = "foundation_0016_assistant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "field_shift_workspaces",
        sa.Column("owner_user_id", sa.String(36), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("field_shift_workspaces")
