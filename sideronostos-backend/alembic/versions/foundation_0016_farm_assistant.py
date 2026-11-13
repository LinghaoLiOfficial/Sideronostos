"""Private conversations with pinned knowledge, idempotent messages and deadlines."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "foundation_0016_assistant"
down_revision: str | None = "foundation_0015_rotation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistant_preferences",
        sa.Column("owner_user_id", sa.String(36), primary_key=True),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("detail", sa.String(12), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("preset", sa.String(30), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("detail", sa.String(12), nullable=False),
        sa.Column(
            "kb_release_id", sa.String(80), sa.ForeignKey("knowledge_releases.id"), nullable=False
        ),
        sa.Column("next_sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_assistant_conversations_owner_user_id", "assistant_conversations", ["owner_user_id"]
    )
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("assistant_conversations.id"),
            nullable=False,
        ),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("client_message_id", sa.String(80), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("context_snapshot", JSONB(), nullable=False),
        sa.Column("evidence_snapshot", JSONB(), nullable=True),
        sa.Column("response", JSONB(), nullable=True),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "conversation_id", "client_message_id", name="uq_assistant_client_message"
        ),
        sa.UniqueConstraint("conversation_id", "sequence", name="uq_assistant_message_sequence"),
    )
    op.create_index(
        "ix_assistant_messages_conversation_id", "assistant_messages", ["conversation_id"]
    )
    op.create_index("ix_assistant_messages_owner_user_id", "assistant_messages", ["owner_user_id"])


def downgrade() -> None:
    op.drop_table("assistant_messages")
    op.drop_table("assistant_conversations")
    op.drop_table("assistant_preferences")
