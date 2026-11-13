"""Owned farms, stable partition field links and idempotent sync receipts."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "foundation_0017_farms"
down_revision: str | None = "foundation_0016_assistant"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "field_shift_farms",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), nullable=False),
        sa.Column("local_id", sa.String(100), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "local_id", name="uq_farm_owner_local"),
    )
    op.create_index("ix_field_shift_farms_owner_user_id", "field_shift_farms", ["owner_user_id"])
    op.add_column("field_shift_fields", sa.Column("farm_id", sa.String(36), nullable=True))
    op.add_column(
        "field_shift_fields", sa.Column("partition_revision", sa.String(100), nullable=True)
    )
    op.add_column("field_shift_fields", sa.Column("local_id", sa.String(100), nullable=True))
    op.create_foreign_key(
        "fk_field_farm", "field_shift_fields", "field_shift_farms", ["farm_id"], ["id"]
    )
    op.create_unique_constraint(
        "uq_farm_partition_field",
        "field_shift_fields",
        ["farm_id", "partition_revision", "local_id"],
    )
    op.create_table(
        "field_shift_farm_sync_receipts",
        sa.Column("owner_user_id", sa.String(36), primary_key=True),
        sa.Column("idempotency_key", sa.String(80), primary_key=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("field_shift_farm_sync_receipts")
    op.drop_constraint("uq_farm_partition_field", "field_shift_fields", type_="unique")
    op.drop_constraint("fk_field_farm", "field_shift_fields", type_="foreignkey")
    for name in ("local_id", "partition_revision", "farm_id"):
        op.drop_column("field_shift_fields", name)
    op.drop_table("field_shift_farms")
