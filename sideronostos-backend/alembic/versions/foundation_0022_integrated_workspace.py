"""Merge assistant and local field workspace migration branches."""

from collections.abc import Sequence


from alembic import op

revision: str = "foundation_0022_merge"
down_revision: tuple[str, str] = (
    "foundation_0018_local_agronomy",
    "foundation_0021_general",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
