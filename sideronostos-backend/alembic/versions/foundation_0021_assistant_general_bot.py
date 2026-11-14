"""Add a cross-module assistant identity without changing existing conversations."""

from collections.abc import Sequence

from alembic import op

revision: str = "foundation_0021_general"
down_revision: str | None = "foundation_0020_previews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD = (
    "(preset = 'field_management' AND bot_id = 'field-guide') OR "
    "(preset = 'remote_sensing' AND bot_id IN "
    "('remote-water', 'remote-soil', 'remote-weather')) OR "
    "(preset = 'local_agriculture' AND bot_id = 'local-knowledge-guide') OR "
    "(preset = 'rotation' AND bot_id = 'rotation-guide')"
)


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_assistant_conversations_ck_assistant_conversation_bot_preset"),
        "assistant_conversations",
        type_="check",
    )
    op.create_check_constraint(
        "ck_assistant_conversation_bot_preset",
        "assistant_conversations",
        "(preset = 'general' AND bot_id = 'general-guide') OR " + _OLD,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_assistant_conversations_ck_assistant_conversation_bot_preset"),
        "assistant_conversations",
        type_="check",
    )
    op.create_check_constraint(
        "ck_assistant_conversation_bot_preset", "assistant_conversations", _OLD
    )
