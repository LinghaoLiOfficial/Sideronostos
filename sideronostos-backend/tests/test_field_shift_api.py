"""Field Shift's public catalogue and authenticated HTTP boundary."""

from fastapi.testclient import TestClient

from sideronostos_backend.core.application import create_app
from sideronostos_backend.modules.database.session import get_session


def test_profile_catalogue_is_public_and_exposes_explicit_demo_rules() -> None:
    # Removing the module registration or hiding its assumptions breaks this journey.
    response = TestClient(create_app()).get("/field-shift/profiles")
    assert response.status_code == 200
    profiles = response.json()["items"]
    assert profiles
    assert profiles[0]["is_demo"] is True
    assert profiles[0]["assumptions"]
    assert profiles[0]["crops"]
    assert profiles[0]["rules"]


def test_field_data_requires_an_authenticated_account() -> None:
    # An accidental public route must not expose a farmer's fields.
    app = create_app()

    async def unused_session():
        yield None

    app.dependency_overrides[get_session] = unused_session
    response = TestClient(app).get("/field-shift/fields")
    assert response.status_code == 401
    assert response.json()["error"]["request_id"]
