import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from sideronostos_backend.core.application import create_app
from sideronostos_backend.modules.database.session import get_session
from sideronostos_backend.modules.field_shift.workspace import (
    FIELD_RINGS,
    SAMPLE_RELEASE_ID,
    SAMPLE_VERSION,
    WorkspaceDocument,
    _sample,
)


def test_iowa_sample_contains_the_versioned_four_exact_fields() -> None:
    sample = _sample()
    assert sample.initialized_from == SAMPLE_VERSION
    assert len(sample.farms) == 1
    assert sample.farms[0].properties.sourceReleaseId == SAMPLE_RELEASE_ID
    assert [field.properties.name for field in sample.fields] == [
        "Field 1",
        "Field 2",
        "Field 3",
        "Field 4",
    ]
    assert sample.fields[0].geometry.coordinates[0] == [list(point) for point in FIELD_RINGS[0]]
    assert all(field.properties.status == "confirmed" for field in sample.fields)


def test_workspace_rejects_orphan_fields_and_mismatched_ids() -> None:
    payload = _sample().model_dump(mode="json")
    payload["fields"][0]["properties"]["farmId"] = "missing"
    with pytest.raises(ValidationError, match="Every field must belong"):
        WorkspaceDocument.model_validate(payload)

    payload = _sample().model_dump(mode="json")
    payload["fields"][0]["id"] = "forged"
    with pytest.raises(ValidationError, match="must match"):
        WorkspaceDocument.model_validate(payload)

    payload = _sample().model_dump(mode="json")
    payload["fields"][0]["geometry"]["coordinates"][0][0][0] += 0.0001
    payload["fields"][0]["geometry"]["coordinates"][0][-1][0] += 0.0001
    with pytest.raises(ValidationError, match="locked four-field sample"):
        WorkspaceDocument.model_validate(payload)


def test_workspace_round_trips_sync_metadata_without_accepting_client_ownership() -> None:
    payload = _sample().model_dump(mode="json")
    payload["farms"][0]["properties"].update({
        "backendFarmId": "server-farm-1",
        "backendVersion": 2,
        "partitionRevision": "partition-revision-1",
        "expectedFieldCount": 4,
        "partitionMetadataKnown": True,
        "conflictOfFarmId": "original-farm-id",
        "syncError": None,
        "pendingSync": None,
    })
    payload["fields"][0]["properties"].update({
        "backendFieldId": "server-field-1",
        "backendVersion": 3,
        "syncStatus": "synced",
        "syncError": None,
        "details": None,
    })
    document = WorkspaceDocument.model_validate(payload)
    restored = document.model_dump(mode="json")
    assert restored["farms"][0]["properties"]["backendVersion"] == 2
    assert restored["farms"][0]["properties"]["conflictOfFarmId"] == "original-farm-id"
    assert restored["fields"][0]["properties"]["syncStatus"] == "synced"

    payload["farms"][0]["properties"]["ownerUserId"] = "forged-owner"
    with pytest.raises(ValidationError, match="ownerUserId"):
        WorkspaceDocument.model_validate(payload)


def test_workspace_requires_a_verified_account() -> None:
    app = create_app()

    async def unused_session():
        yield None

    app.dependency_overrides[get_session] = unused_session
    response = TestClient(app).get("/field-shift/workspace")
    assert response.status_code == 401
