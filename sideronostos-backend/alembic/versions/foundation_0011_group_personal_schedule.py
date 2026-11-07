"""Group-scoped personal schedule days."""

from collections.abc import Sequence

from alembic import op
from sideronostos_backend.modules.personal_schedule.models import GroupPersonalScheduleDay

revision: str = "foundation_0011_group_schedule"
down_revision: str | None = "foundation_0010_schedule"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    GroupPersonalScheduleDay.__table__.create(op.get_bind())


def downgrade() -> None:
    GroupPersonalScheduleDay.__table__.drop(op.get_bind())
