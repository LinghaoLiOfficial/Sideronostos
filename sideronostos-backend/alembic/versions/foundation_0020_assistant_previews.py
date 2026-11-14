"""Private screenshots for confirmed assistant results."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "foundation_0020_previews"
down_revision: str | None = "foundation_0019_farms_merge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistant_previews",
        sa.Column("workflow_id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("assistant_conversations.id"),
            nullable=False,
        ),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("png", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_assistant_previews_conversation_id", "assistant_previews", ["conversation_id"]
    )
    op.create_index("ix_assistant_previews_owner_user_id", "assistant_previews", ["owner_user_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_previews_owner_user_id", table_name="assistant_previews")
    op.drop_index("ix_assistant_previews_conversation_id", table_name="assistant_previews")
    op.drop_table("assistant_previews")
