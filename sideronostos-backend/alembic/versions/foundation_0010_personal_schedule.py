"""Personal schedule days."""

from collections.abc import Sequence

from alembic import op
from sideronostos_backend.modules.personal_schedule.models import PersonalScheduleDay

revision: str = "foundation_0010_schedule"
down_revision: str | None = "foundation_0009_collaboration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    PersonalScheduleDay.__table__.create(op.get_bind())


def downgrade() -> None:
    PersonalScheduleDay.__table__.drop(op.get_bind())
