"""Verification emails preserve safe in-app farmer journeys without open redirects."""

from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from sideronostos_backend.core.application import create_app
from sideronostos_backend.core.modules import ModuleSpec
from sideronostos_backend.modules.auth import router as auth_router
from sideronostos_backend.modules.auth.service import AuthService, digest
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.email.service import EmailService, render_template


@pytest.fixture
def verification_client(monkeypatch):
    # Only persistence is replaced. The real AuthService creates the token/URL;
    # the real EmailService and renderer produce the queued message.
    account = SimpleNamespace(
        id="user-1", email="farmer@example.com", display_name="Farmer", email_verified_at=None
    )
    queued, added = [], []

    class Users:
        async def create(self, session, **values):
            return account

        async def by_email(self, session, email):
            return account

    class Organizations:
        async def create_personal(self, session, **values):
            return "organization-1"

    class Jobs:
        async def enqueue(self, session, **values):
            queued.append(values["payload"])
            return SimpleNamespace(id="job-1")

    class Session:
        def add(self, value):
            added.append(value)

        async def commit(self):
            pass

        async def rollback(self):
            pass

    service = AuthService(
        users=Users(), organizations=Organizations(), email=EmailService(jobs=Jobs())
    )
    monkeypatch.setattr(auth_router, "AuthService", lambda: service)
    app = create_app(modules=(ModuleSpec(name="auth", routers=(auth_router.router,)),))

    async def session():
        yield Session()

    app.dependency_overrides[get_session] = session
    return TestClient(app), queued, added


@pytest.mark.parametrize("route", ["/auth/register", "/auth/resend-verification"])
@pytest.mark.parametrize(
    "destination",
    [
        "/field-shift?field=abc&plan=def#comparison",
        "/workspace/files/abc",
        "/personal/account",
    ],
)
def test_email_preserves_escaped_safe_destination(verification_client, route, destination):
    client, queued, added = verification_client
    payload = {"email": "farmer@example.com", "next": destination}
    if route == "/auth/register":
        payload.update(password="a-secure-password", display_name="Farmer")
    response = client.post(route, json=payload)
    assert response.status_code == 202
    assert len(queued) == 1
    url = queued[0]["context"]["url"]
    parsed = urlsplit(url)
    query = parse_qs(parsed.query)
    assert parsed.path == "/verify-email"
    assert query.get("next") == [destination]
    assert "%2F" in url
    assert len(query["token"]) == 1
    assert any(getattr(item, "digest", None) == digest(query["token"][0]) for item in added)
    _, body = render_template(queued[0]["template"], queued[0]["context"])
    assert url in body


@pytest.mark.parametrize(
    "destination",
    [
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        "/field-shift\n",
        "/workspace/../../login",
        "/workspace/%2e%2e/login",
        "/%2f%2fevil.example",
        "/field-shift%0a",
        "/field-shift?x=%0a",
        "/workspace-evil",
        "/login?next=https://evil.example",
    ],
)
@pytest.mark.parametrize("route", ["/auth/register", "/auth/resend-verification"])
def test_unsafe_destinations_are_rejected_before_email(verification_client, route, destination):
    client, queued, _ = verification_client
    payload = {"email": "farmer@example.com", "next": destination}
    if route == "/auth/register":
        payload.update(password="a-secure-password", display_name="Farmer")
    response = client.post(route, json=payload)
    assert response.status_code == 422
    assert queued == []


@pytest.mark.parametrize("route", ["/auth/register", "/auth/resend-verification"])
def test_omitted_next_keeps_original_verification_link(verification_client, route):
    client, queued, _ = verification_client
    payload = {"email": "farmer@example.com"}
    if route == "/auth/register":
        payload.update(password="a-secure-password", display_name="Farmer")
    assert client.post(route, json=payload).status_code == 202
    assert set(parse_qs(urlsplit(queued[0]["context"]["url"]).query)) == {"token"}
