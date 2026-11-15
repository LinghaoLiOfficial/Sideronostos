"""Conversation/ownership tests use synthetic KB metadata; no fake model quality claims."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from test_rotation_persistence import setup as setup

from sideronostos_backend.modules.farm_assistant.models import AssistantMessage
from sideronostos_backend.modules.farm_assistant.schemas import ConversationCreate, MessageCreate
from sideronostos_backend.modules.farm_assistant.service import AssistantService
from sideronostos_backend.modules.knowledge.models import KBActivation, KBRelease

pytestmark = pytest.mark.asyncio


async def conversation(factory, owner):
    async with factory() as s:
        release = KBRelease(
            id="test-kb-" + uuid4().hex,
            status="published",
            manifest_sha256="a" * 64,
            embedding_model="synthetic-no-provider",
            embedding_dimensions=2,
            embedding_namespace="test",
            recipe="test-only",
            report={},
        )
        s.add(release)
        await s.flush()
        pointer = await s.get(KBActivation, "default")
        if pointer:
            pointer.release_id = release.id
        else:
            s.add(KBActivation(name="default", release_id=release.id))
        await s.commit()
        return await AssistantService().create_conversation(s, owner, ConversationCreate())


def message(**changes):
    return MessageCreate.model_validate(
        {
            "client_message_id": "message-" + uuid4().hex,
            "text": "轮作是什么？",
            "context": {"page": "map", "revision": 1},
            **changes,
        }
    )


async def test_message_idempotency_and_conversation_owner_checked_before_work(setup):
    factory, owner, _, _ = setup
    conv = await conversation(factory, owner)
    service = AssistantService()
    request = message()
    async with factory() as s:
        first, work = await service.start_message(s, owner, conv["id"], request)
        assert work and first.status == "pending"
        again, work = await service.start_message(s, owner, conv["id"], request)
        assert first.id == again.id and not work
        with pytest.raises(HTTPException) as conflict:
            await service.start_message(
                s, owner, conv["id"], request.model_copy(update={"text": "different"})
            )
        assert conflict.value.status_code == 409
        await s.rollback()
        with pytest.raises(HTTPException) as foreign:
            await service.get_conversation(s, "other-owner", conv["id"])
        assert foreign.value.status_code == 404
        with pytest.raises(HTTPException) as busy:
            await service.start_message(s, owner, conv["id"], message())
        assert busy.value.status_code == 409


async def test_bot_identity_persists_through_create_list_and_detail(setup):
    factory, owner, _, _ = setup
    await conversation(factory, owner)  # Publishes synthetic knowledge for creation.
    service = AssistantService()
    async with factory() as session:
        soil = await service.create_conversation(
            session, owner, ConversationCreate(preset="remote_sensing", bot_id="remote-soil")
        )
        legacy = await service.create_conversation(
            session, owner, ConversationCreate(preset="remote_sensing")
        )
        assert soil["bot_id"] == "remote-soil"
        assert legacy["bot_id"] == "remote-water"
        assert (await service.get_conversation(session, owner, soil["id"]))[
            "bot_id"
        ] == "remote-soil"
        rows = await service.list_conversations(session, owner)
        assert {row["id"]: row["bot_id"] for row in rows}[soil["id"]] == "remote-soil"
        assert {row["id"]: row["bot_id"] for row in rows}[legacy["id"]] == "remote-water"
        with pytest.raises(HTTPException) as denied:
            await service.get_conversation(session, "other-owner", soil["id"])
        assert denied.value.status_code == 404


async def test_context_authority_and_pending_recovery_prevent_late_overwrite(setup):
    factory, owner, fid, _ = setup
    conv = await conversation(factory, owner)
    service = AssistantService()
    async with factory() as s:
        bad = message(
            context={
                "page": "map",
                "revision": 1,
                "fields": [{"id": "foreign-field", "expected_version": 1}],
            }
        )
        with pytest.raises(HTTPException) as denied:
            await service.start_message(s, owner, conv["id"], bad)
        assert denied.value.status_code == 404
        await s.rollback()
        assert not (
            await s.scalars(
                select(AssistantMessage).where(AssistantMessage.conversation_id == conv["id"])
            )
        ).all()
        first, _ = await service.start_message(
            s,
            owner,
            conv["id"],
            message(
                context={
                    "page": "map",
                    "revision": 3,
                    "fields": [{"id": fid, "expected_version": 1}],
                }
            ),
        )
        first.deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        await s.commit()
        second, _ = await service.start_message(s, owner, conv["id"], message())
        assert first.id != second.id
        await s.refresh(first)
        assert (
            first.status == "interrupted" and first.context_snapshot["reference"]["revision"] == 3
        )
        assert not await service.finish_message(
            s, first.id, "complete", {"paragraphs": [{"text": "late"}]}, None
        )
        assert (await s.get(AssistantMessage, first.id)).status == "interrupted"


async def test_run_only_context_retains_frozen_field_and_calendar_facts(setup):
    from sideronostos_backend.modules.farm_assistant.context import freeze_context
    from sideronostos_backend.modules.farm_assistant.schemas import ContextRef
    from sideronostos_backend.modules.field_shift.models import FieldRecord
    from sideronostos_backend.modules.rotation_optimizer.service import RotationService

    factory, owner, fid, request = setup
    async with factory() as s:
        run = await RotationService().create_run(s, owner, request)
        current = await s.get(FieldRecord, fid)
        current.data = {**current.data, "name": "Renamed field", "area_ha": 99}
        current.version += 1
        await s.commit()
        frozen = await freeze_context(
            s, owner, ContextRef(page="rotation", revision=1, run_id=run["id"]), "zh"
        )
        assert frozen["fields"][0]["name"] == "Test field"
        assert frozen["fields"][0]["area_ha"] == 2
        assert frozen["fields"][0]["version"] == 1
        assert any(f["value"] == 2 and f["source"]["field_id"] == fid for f in frozen["facts"])
        dates = await freeze_context(
            s,
            owner,
            ContextRef.model_validate(
                {
                    "page": "map",
                    "revision": 1,
                    "dates": {"start": "2025-04-01", "end": "2025-04-30"},
                }
            ),
            "zh",
        )
        assert {f["display"] for f in dates["facts"]} >= {"2025-04-01", "2025-04-30"}
