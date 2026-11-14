"""The agent action boundary asks for missing inputs and reports only service-confirmed results."""

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from sideronostos_backend.modules.farm_assistant.agent_actions import (
    ActionConflict,
    ActionRequest,
    AgentActionService,
)


class FieldService:
    def __init__(self):
        self.items = {}

    async def create_field(self, session, owner, body):
        item = {**body.model_dump(mode="json"), "id": str(uuid4()), "owner": owner}
        self.items[item["id"]] = item
        return item


class AgriService:
    def __init__(self):
        self.layers = {
            "release-1:am": {
                "id": "release-1:am",
                "source": {"release_id": "release-1"},
                "unit": "m3/m3",
            }
        }

    async def layer_manifest(self, session, owner, layer_id):
        if owner != "farmer-1" or layer_id not in self.layers:
            raise HTTPException(404, "Layer not found")
        return self.layers[layer_id]

    async def facts(self, session, owner, selection_id, *, start, end, expected_revision):
        if owner != "farmer-1" or selection_id != "selection-1":
            raise HTTPException(404, "Selection not found")
        return {
            "selection": {"id": selection_id, "revision": 2},
            "facts": [
                {
                    "id": "fact-1",
                    "metric": "surface_soil_moisture",
                    "value": 0.23,
                    "unit": "m3/m3",
                    "source": {"release_id": "release-1"},
                }
            ],
            "unavailable": [],
            "online_fetch_performed": False,
        }


class Journal:
    def __init__(self):
        self.records = {}
        self.lock = asyncio.Lock()

    async def run_once(self, owner, conversation_id, key, fingerprint, operation):
        async with self.lock:
            identity = owner, conversation_id, key
            if identity in self.records:
                prior_hash, prior_outcome = self.records[identity]
                if prior_hash != fingerprint:
                    raise ActionConflict("Idempotency key was reused with different inputs")
                return prior_outcome
            outcome = await operation()
            self.records[identity] = fingerprint, outcome
            return outcome


def field_arguments(**changes):
    return {
        "name": "North field",
        "area_ha": 4,
        "latitude": 42,
        "longitude": -93,
        "soil_texture": "loam",
        "irrigation_available": True,
        "profile_id": "temperate-demo",
        "history": [],
        **changes,
    }


@pytest.mark.asyncio
async def test_missing_field_inputs_resume_to_one_owned_field_and_real_link():
    fields = FieldService()
    service = AgentActionService(
        field_service=fields, agri_service=AgriService(), journal=Journal()
    )
    first = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(
            action="field.create", arguments={"name": "North field"}, idempotency_key="request-1"
        ),
    )
    assert first.status == "needs_input"
    assert "area_ha" in first.missing_fields
    assert first.pending is not None
    assert fields.items == {}

    second = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(
            action="field.create",
            arguments={k: v for k, v in field_arguments().items() if k != "name"},
            idempotency_key="request-1",
        ),
        pending=first.pending,
    )
    assert second.status == "succeeded"
    assert second.result["owner"] == "farmer-1"
    assert second.href == f"/field-shift?field={second.result['id']}&step=field"
    assert len(fields.items) == 1

    replay = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(
            action="field.create", arguments=field_arguments(), idempotency_key="request-1"
        ),
    )
    assert replay.result["id"] == second.result["id"]
    assert len(fields.items) == 1


@pytest.mark.asyncio
async def test_invalid_field_payload_and_foreign_pending_never_write():
    fields = FieldService()
    service = AgentActionService(
        field_service=fields, agri_service=AgriService(), journal=Journal()
    )
    pending = (
        await service.advance(
            None,
            "farmer-1",
            "conversation-1",
            ActionRequest(
                action="field.create", arguments={"name": "A"}, idempotency_key="request-1"
            ),
        )
    ).pending
    with pytest.raises(ActionConflict):
        await service.advance(
            None,
            "farmer-2",
            "conversation-1",
            ActionRequest(
                action="field.create", arguments=field_arguments(), idempotency_key="request-1"
            ),
            pending=pending,
        )
    invalid = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(
            action="field.create",
            arguments=field_arguments(latitude=91),
            idempotency_key="request-2",
        ),
    )
    assert invalid.status == "failed" and invalid.href is None
    assert fields.items == {}


@pytest.mark.asyncio
async def test_supported_layer_and_fact_have_scoped_map_links_and_real_source():
    service = AgentActionService(
        field_service=FieldService(), agri_service=AgriService(), journal=Journal()
    )
    layer = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(action="remote_sensing.layer", arguments={"layer_id": "release-1:am"}),
    )
    assert layer.status == "succeeded"
    assert layer.href == "/field-shift/map?layer=release-1%3Aam"
    assert layer.result["source"]["release_id"] == "release-1"
    fact = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(
            action="remote_sensing.fact",
            arguments={
                "selection_id": "selection-1",
                "metric": "surface_soil_moisture",
                "expected_revision": 2,
            },
        ),
    )
    assert fact.status == "succeeded"
    assert fact.href == "/field-shift/map?selection=selection-1"
    assert fact.result["source"]["release_id"] == "release-1"
    denied = await service.advance(
        None,
        "farmer-2",
        "conversation-1",
        ActionRequest(action="remote_sensing.layer", arguments={"layer_id": "release-1:am"}),
    )
    assert denied.status == "failed" and denied.href is None


@pytest.mark.asyncio
async def test_fact_requires_specific_metric_and_rejects_unsupported_action():
    service = AgentActionService(
        field_service=FieldService(), agri_service=AgriService(), journal=Journal()
    )
    missing = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(action="remote_sensing.fact", arguments={"selection_id": "selection-1"}),
    )
    assert missing.status == "needs_input" and missing.missing_fields == ["metric"]
    unsupported = await service.advance(
        None,
        "farmer-1",
        "conversation-1",
        ActionRequest(
            action="remote_sensing.fact",
            arguments={"selection_id": "selection-1", "metric": "future_yield"},
        ),
    )
    assert unsupported.status == "failed" and unsupported.href is None
    with pytest.raises(ValueError):
        ActionRequest(action="arbitrary.http", arguments={})
