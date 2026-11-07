from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.routing import APIRoute

import sideronostos_backend.modules.collaboration.router as collaboration_router
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal
from sideronostos_backend.modules.collaboration.models import Notification
from sideronostos_backend.modules.collaboration.router import (
    INVITE_TTL,
    RolePatch,
    _digest,
    router,
    update_member_role,
)
from sideronostos_backend.modules.email.service import render_template
from sideronostos_backend.modules.rbac.models import MembershipRole


def test_invitation_tokens_are_stored_as_digests() -> None:
    assert _digest("secret-token") != "secret-token"
    assert len(_digest("secret-token")) == 64
    assert INVITE_TTL.days == 7


def test_group_invitation_email_contains_confirmation_link() -> None:
    subject, body = render_template(
        "group_invite",
        {
            "url": "https://app.test/workspace/invitations/token",
            "group_name": "Research",
            "inviter": "Lin",
        },
    )
    assert subject == "Group invitation"
    assert "Research" in body
    assert "/workspace/invitations/token" in body


def test_collaboration_routes_are_registered() -> None:
    paths = {route.path for route in router.routes if isinstance(route, APIRoute)}
    assert "/groups" in paths
    assert "/groups/{group_id}/members" in paths
    assert "/groups/{group_id}/members/{member_id}/personal-schedule" in paths
    assert "/groups/{group_id}/personal-schedule/{day}" in paths
    assert "/invitations/{token}/{action}" in paths
    assert "/invitations/by-id/{invitation_id}/{action}" in paths
    assert "/notifications" in paths
    assert "/notifications/delete-batch" in paths


def test_user_search_accepts_single_character_queries() -> None:
    route = next(
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.path == "/users/search"
    )
    query = next(parameter for parameter in route.dependant.query_params if parameter.name == "q")
    min_length = next(
        item.min_length for item in query.field_info.metadata if hasattr(item, "min_length")
    )
    assert min_length == 1


@pytest.mark.parametrize(
    ("current_role_name", "new_role", "role_id_value", "role_label"),
    [
        ("member", "admin", "admin-role", "管理员"),
        ("admin", "member", "member-role", "普通成员"),
    ],
)
@pytest.mark.asyncio
async def test_role_change_notifies_the_target_member(
    monkeypatch: pytest.MonkeyPatch,
    current_role_name: str,
    new_role: str,
    role_id_value: str,
    role_label: str,
) -> None:
    group = SimpleNamespace(id="group-1", name="研究小组")

    async def require(*args: object, **kwargs: object) -> tuple[object, str]:
        return group, "owner"

    async def current_role(*args: object, **kwargs: object) -> str:
        return current_role_name

    async def role_id(*args: object, **kwargs: object) -> str:
        return role_id_value

    monkeypatch.setattr(collaboration_router, "_require", require)
    monkeypatch.setattr(collaboration_router, "_role", current_role)
    monkeypatch.setattr(collaboration_router, "_role_id", role_id)
    session = MagicMock()
    session.scalar = AsyncMock(return_value=SimpleNamespace(id="membership-1"))
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    actor = AuthPrincipal(
        id="owner-1",
        email="owner@example.com",
        display_name="群主",
        email_verified_at=datetime.now(UTC),
    )

    result = await update_member_role(
        "group-1", "member-1", RolePatch(role=new_role), actor, session
    )

    assert result == {"role": new_role}
    added = [call.args[0] for call in session.add.call_args_list]
    assignment = next(item for item in added if isinstance(item, MembershipRole))
    notification = next(item for item in added if isinstance(item, Notification))
    assert assignment.membership_id == "membership-1"
    assert assignment.role_id == role_id_value
    assert notification.recipient_id == "member-1"
    assert notification.actor_id == "owner-1"
    assert notification.organization_id == "group-1"
    assert notification.type == "group_role_changed"
    assert notification.title == "你在 研究小组 中的权限已变更"
    assert notification.body == f"群主 已将你的权限修改为{role_label}。"
    assert notification.payload == {
        "group_name": "研究小组",
        "role": new_role,
        "role_label": role_label,
    }
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unchanged_role_does_not_create_a_notification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def require(*args: object, **kwargs: object) -> tuple[object, str]:
        return SimpleNamespace(id="group-1", name="研究小组"), "owner"

    async def current_role(*args: object, **kwargs: object) -> str:
        return "member"

    monkeypatch.setattr(collaboration_router, "_require", require)
    monkeypatch.setattr(collaboration_router, "_role", current_role)
    session = MagicMock()
    session.scalar = AsyncMock(return_value=SimpleNamespace(id="membership-1"))
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    actor = AuthPrincipal(
        id="owner-1",
        email="owner@example.com",
        display_name="群主",
        email_verified_at=datetime.now(UTC),
    )

    result = await update_member_role(
        "group-1", "member-1", RolePatch(role="member"), actor, session
    )

    assert result == {"role": "member"}
    session.add.assert_not_called()
    session.execute.assert_not_awaited()
    session.commit.assert_not_awaited()
