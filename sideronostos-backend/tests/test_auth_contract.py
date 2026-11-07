from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException, Response
from pydantic import ValidationError
from starlette.requests import Request

from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.config import Settings
from sideronostos_backend.modules.auth import router as auth_router
from sideronostos_backend.modules.auth.dependencies import AuthPrincipal
from sideronostos_backend.modules.auth.models import AuthSession
from sideronostos_backend.modules.auth.module import module as auth_module
from sideronostos_backend.modules.auth.router import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetRequest,
    TokenRequest,
)
from sideronostos_backend.modules.auth.service import (
    MIN_PASSWORD_LENGTH,
    AuthenticationError,
    AuthService,
    RefreshTokenReuseError,
    TokenPair,
    digest,
)
from sideronostos_backend.modules.auth.settings import AuthSettings


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


class FakeRotationSession:
    def __init__(self, current: AuthSession) -> None:
        self.current = current
        self.revocations = 0

    async def scalar(self, statement: Any) -> AuthSession:
        del statement
        return self.current

    async def execute(self, statement: Any) -> None:
        del statement
        self.revocations += 1


class FakeUsers:
    async def by_id(self, session: Any, user_id: str) -> SimpleNamespace:
        del session
        return SimpleNamespace(id=user_id)

    def active(self, user: Any) -> bool:
        del user
        return True


@asynccontextmanager
async def empty_lifespan(app: FastAPI, settings: Settings) -> AsyncIterator[None]:
    del app, settings
    yield


def auth_app() -> FastAPI:
    module = auth_module.__class__(
        name=auth_module.name,
        routers=(auth_router.router,),
        lifespan=empty_lifespan,
    )
    return create_app(
        Settings(cors_allowed_origins="http://localhost:3000"),
        modules=(module,),
    )


def test_auth_routes_are_registered() -> None:
    paths = {route.path for route in auth_router.router.routes}
    assert {
        "/auth/register",
        "/auth/verify-email",
        "/auth/login",
        "/auth/refresh",
        "/auth/logout",
        "/auth/resend-verification",
        "/users/me",
    } <= paths


def test_new_password_requests_share_eight_character_minimum() -> None:
    assert MIN_PASSWORD_LENGTH == 8
    assert (
        RegisterRequest(email="user@example.com", password="12345678", display_name="User").password
        == "12345678"
    )
    assert ResetRequest(token="reset-token", password="12345678").password == "12345678"
    assert (
        ChangePasswordRequest(current_password="current", new_password="12345678").new_password
        == "12345678"
    )

    rejected = (
        lambda: RegisterRequest(email="user@example.com", password="1234567", display_name="User"),
        lambda: ResetRequest(token="reset-token", password="1234567"),
        lambda: ChangePasswordRequest(current_password="current", new_password="1234567"),
    )
    for build_request in rejected:
        with pytest.raises(ValidationError):
            build_request()


def test_openapi_exposes_eight_character_new_password_minimum() -> None:
    schemas = auth_app().openapi()["components"]["schemas"]
    password_fields = (
        schemas["RegisterRequest"]["properties"]["password"],
        schemas["ResetRequest"]["properties"]["password"],
        schemas["ChangePasswordRequest"]["properties"]["new_password"],
    )

    for field in password_fields:
        assert field["minLength"] == 8
        assert field["maxLength"] == 256


@pytest.mark.asyncio
async def test_auth_service_rejects_short_new_passwords() -> None:
    service = AuthService()

    with pytest.raises(AuthenticationError, match="at least 8 characters"):
        await service.register(  # type: ignore[arg-type]
            FakeSession(), email="user@example.com", password="1234567", display_name="User"
        )
    with pytest.raises(AuthenticationError, match="at least 8 characters"):
        await service.reset_password(FakeSession(), "reset-token", "1234567")  # type: ignore[arg-type]


def rotated_session(*, age_seconds: int) -> AuthSession:
    now = datetime.now(UTC)
    return AuthSession(
        id="session-1",
        user_id="user-1",
        family_id="family-1",
        refresh_digest=digest("refresh-1"),
        csrf_digest=digest("csrf-1"),
        expires_at=now + timedelta(days=1),
        rotated_at=now - timedelta(seconds=age_seconds),
        revoked_at=None,
    )


@pytest.mark.asyncio
async def test_refresh_reuse_during_grace_period_recovers_from_a_lost_response() -> None:
    current = rotated_session(age_seconds=5)
    session = FakeRotationSession(current)
    service = AuthService(
        settings=AuthSettings(refresh_reuse_grace_seconds=30), users=FakeUsers()  # type: ignore[arg-type]
    )
    replacement = TokenPair("access-2", "refresh-2", "csrf-2", 900)
    service._new_session = AsyncMock(return_value=replacement)  # type: ignore[method-assign]

    result = await service.rotate(session, "refresh-1", "csrf-1")  # type: ignore[arg-type]

    assert result == replacement
    assert session.revocations == 0
    service._new_session.assert_awaited_once()


@pytest.mark.asyncio
async def test_refresh_reuse_after_grace_period_still_revokes_the_session_family() -> None:
    session = FakeRotationSession(rotated_session(age_seconds=31))
    service = AuthService(
        settings=AuthSettings(refresh_reuse_grace_seconds=30), users=FakeUsers()  # type: ignore[arg-type]
    )

    with pytest.raises(RefreshTokenReuseError, match="reuse detected"):
        await service.rotate(session, "refresh-1", "csrf-1")  # type: ignore[arg-type]

    assert session.revocations == 1


@pytest.mark.asyncio
async def test_invalid_csrf_cannot_revoke_a_rotated_session_family() -> None:
    session = FakeRotationSession(rotated_session(age_seconds=31))
    service = AuthService(
        settings=AuthSettings(refresh_reuse_grace_seconds=30), users=FakeUsers()  # type: ignore[arg-type]
    )

    with pytest.raises(AuthenticationError, match="Invalid CSRF token"):
        await service.rotate(session, "refresh-1", "wrong-csrf")  # type: ignore[arg-type]

    assert session.revocations == 0


@pytest.mark.asyncio
async def test_registration_keeps_a_generic_response_for_duplicate_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Service:
        async def register(self, session: Any, **values: str) -> None:
            del session, values
            raise AuthenticationError("Unable to register account")

    monkeypatch.setattr(auth_router, "AuthService", Service)
    session = FakeSession()
    response = await auth_router.register(
        RegisterRequest(
            email="existing@example.com",
            password="a-secure-password",
            display_name="Existing User",
        ),
        session,  # type: ignore[arg-type]
    )

    assert response == {
        "message": "If registration is available, a verification email will be sent."
    }
    assert session.commits == 0
    assert session.rollbacks == 1


@pytest.mark.asyncio
async def test_login_returns_backend_token_contract_and_sets_session_cookies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Service:
        async def login(self, session: Any, email: str, password: str) -> TokenPair:
            del session
            assert email == "user@example.com"
            assert password == "a-secure-password"
            return TokenPair("access-1", "refresh-1", "csrf-1", 900)

    async def audit(*args: Any, **kwargs: Any) -> None:
        del args, kwargs

    monkeypatch.setattr(auth_router, "AuthService", Service)
    monkeypatch.setattr(auth_router, "record_audit", audit)
    session = FakeSession()
    response = Response()

    payload = await auth_router.login(
        LoginRequest(email="user@example.com", password="a-secure-password"),
        response,
        session,  # type: ignore[arg-type]
    )

    assert payload == {
        "access_token": "access-1",
        "token_type": "bearer",
        "expires_in": 900,
    }
    cookies = response.headers.getlist("set-cookie")
    assert any("refresh_token=refresh-1" in cookie and "HttpOnly" in cookie for cookie in cookies)
    assert any("csrf_token=csrf-1" in cookie and "HttpOnly" not in cookie for cookie in cookies)
    assert session.commits == 1


@pytest.mark.asyncio
async def test_email_verification_consumes_the_backend_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Service:
        async def verify_email(self, session: Any, token: str) -> None:
            del session
            assert token == "verification-token"

    monkeypatch.setattr(auth_router, "AuthService", Service)
    session = FakeSession()
    payload = await auth_router.verify_email(
        TokenRequest(token="verification-token"),
        session,  # type: ignore[arg-type]
    )

    assert payload == {"message": "Email verified"}
    assert session.commits == 1


def test_refresh_rejects_an_untrusted_origin_before_using_tokens() -> None:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/refresh",
            "headers": [(b"origin", b"https://untrusted.example")],
        }
    )

    with pytest.raises(HTTPException, match="Origin is not allowed"):
        auth_router._validate_origin(request)


@pytest.mark.asyncio
async def test_current_user_response_uses_the_public_backend_fields() -> None:
    payload = await auth_router.me(
        AuthPrincipal(
            id="user-1",
            email="user@example.com",
            display_name="Test User",
            email_verified_at=None,
        )
    )
    assert payload == {
        "id": "user-1",
        "email": "user@example.com",
        "display_name": "Test User",
        "email_verified": False,
    }
