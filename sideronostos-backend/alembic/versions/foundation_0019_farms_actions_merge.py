"""Merge the owned-farm and assistant-action migration branches."""

from collections.abc import Sequence

revision: str = "foundation_0019_farms_merge"
down_revision: tuple[str, str] = ("foundation_0017_farms", "foundation_0018_bot_identity")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
