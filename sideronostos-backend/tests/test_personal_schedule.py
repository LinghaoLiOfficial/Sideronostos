import pytest
from fastapi.routing import APIRoute
from pydantic import ValidationError

from sideronostos_backend.modules.personal_schedule.router import ScheduleDayBody, router


def test_personal_schedule_routes_are_registered() -> None:
    paths = {route.path for route in router.routes if isinstance(route, APIRoute)}
    assert "/users/me/personal-schedule" in paths
    assert "/users/me/personal-schedule/{day}" in paths


def test_schedule_day_body_keeps_empty_items_for_persistence() -> None:
    body = ScheduleDayBody(title="  今日计划  ", items=[])
    assert body.title == "  今日计划  "
    assert body.items == []


def test_schedule_day_body_rejects_empty_title() -> None:
    with pytest.raises(ValidationError):
        ScheduleDayBody(title="", items=[])
