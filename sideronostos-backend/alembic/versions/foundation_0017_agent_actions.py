"""Persistent owner-scoped assistant actions and idempotency audit."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "foundation_0017_actions"
down_revision: str | None = "foundation_0016_assistant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistant_actions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("assistant_conversations.id"),
            nullable=False,
        ),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(80), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=True),
        sa.Column("arguments", JSONB(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("outcome", JSONB(), nullable=True),
        sa.Column("audit_events", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("conversation_id", "idempotency_key", name="uq_assistant_action_key"),
    )
    op.create_index(
        "ix_assistant_actions_conversation_id", "assistant_actions", ["conversation_id"]
    )
    op.create_index("ix_assistant_actions_owner_user_id", "assistant_actions", ["owner_user_id"])


def downgrade() -> None:
    op.drop_table("assistant_actions")
