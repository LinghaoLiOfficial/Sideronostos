"""Pin each assistant conversation to a stable bot identity."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "foundation_0018_bot_identity"
down_revision: str | None = "foundation_0017_actions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assistant_conversations", sa.Column("bot_id", sa.String(40), nullable=True))
    op.execute(
        """
        UPDATE assistant_conversations SET bot_id = CASE preset
            WHEN 'field_management' THEN 'field-guide'
            WHEN 'remote_sensing' THEN 'remote-water'
            WHEN 'local_agriculture' THEN 'local-knowledge-guide'
            ELSE 'rotation-guide'
        END
        """
    )
    op.alter_column("assistant_conversations", "bot_id", nullable=False)
    op.create_check_constraint(
        "ck_assistant_conversation_bot_preset",
        "assistant_conversations",
        "(preset = 'field_management' AND bot_id = 'field-guide') OR "
        "(preset = 'remote_sensing' AND bot_id IN "
        "('remote-water', 'remote-soil', 'remote-weather')) OR "
        "(preset = 'local_agriculture' AND bot_id = 'local-knowledge-guide') OR "
        "(preset = 'rotation' AND bot_id = 'rotation-guide')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_assistant_conversation_bot_preset", "assistant_conversations", type_="check"
    )
    op.drop_column("assistant_conversations", "bot_id")
