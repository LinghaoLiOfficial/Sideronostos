from datetime import date

from sqlalchemy import inspect

from sideronostos_backend.modules.personal_schedule.models import GroupPersonalScheduleDay


def test_group_personal_schedule_is_scoped_to_group_member_and_day() -> None:
    table = GroupPersonalScheduleDay.__table__
    unique = next(
        constraint
        for constraint in table.constraints
        if constraint.name == "uq_group_personal_schedule_days_group_user_date"
    )
    assert tuple(column.name for column in unique.columns) == ("organization_id", "user_id", "date")
    assert {column.name for column in inspect(GroupPersonalScheduleDay).columns} >= {
        "organization_id",
        "user_id",
        "date",
        "title",
        "items",
    }


def test_group_personal_schedule_keeps_date_values() -> None:
    item = GroupPersonalScheduleDay(
        organization_id="group-1", user_id="user-1", date=date(2026, 10, 7), title="计划", items=[]
    )
    assert item.date == date(2026, 10, 7)
