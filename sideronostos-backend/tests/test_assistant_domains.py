"""Domain conversations preserve owner boundaries and source-bound message context."""

import json
import os
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from langchain_core.messages import SystemMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_assistant_pipeline import context_and_evidence, provider, response

from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.farm_assistant import pipeline
from sideronostos_backend.modules.farm_assistant.context import freeze_context
from sideronostos_backend.modules.farm_assistant.models import (
    AssistantAction,
    AssistantMessage,
    Conversation,
    FarmerPreference,
)
from sideronostos_backend.modules.farm_assistant.presets import enabled_presets
from sideronostos_backend.modules.farm_assistant.schemas import (
    ContextRef,
    ConversationCreate,
    MessageCreate,
    PreferenceInput,
)
from sideronostos_backend.modules.farm_assistant.service import AssistantService
from sideronostos_backend.modules.field_shift.models import FarmRecord, FieldRecord
from sideronostos_backend.modules.knowledge.models import KBActivation, KBRelease

DOMAINS = ("field_management", "remote_sensing", "local_agriculture", "rotation")


@pytest_asyncio.fixture
async def assistant_db():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL test database required")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Test database required")
    tables = [
        model.__table__
        for model in (
            FarmRecord,
            FieldRecord,
            KBRelease,
            KBActivation,
            AssistantAction,
            FarmerPreference,
            Conversation,
            AssistantMessage,
        )
    ]
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner, field_id = str(uuid4()), str(uuid4())
    async with factory() as session:
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
        session.add_all(
            [
                release,
                FieldRecord(
                    id=field_id,
                    owner_user_id=owner,
                    data={"name": "Test field", "area_ha": 2},
                ),
            ]
        )
        await session.flush()
        activation = await session.get(KBActivation, "default")
        if activation is None:
            session.add(KBActivation(name="default", release_id=release.id))
        else:
            activation.release_id = release.id
        await session.commit()
    yield factory, owner, field_id
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync: Base.metadata.drop_all(sync, tables=tables))
    await engine.dispose()


def test_four_domains_are_creatable_and_new_users_default_to_english():
    assert {item["id"] for item in enabled_presets()} == set(DOMAINS)
    for preset in DOMAINS:
        body = ConversationCreate(preset=preset)
        assert body.preset == preset
        assert body.language == "en"
    assert PreferenceInput().language == "en"


def test_local_agriculture_catalog_discloses_mock_price_and_variety_data():
    local = next(item for item in enabled_presets() if item["id"] == "local_agriculture")
    assert local["enabled"] is True
    assert "mock" in local["description"].casefold()
    assert "mock" in local["description_en"].casefold()


def test_message_without_page_context_uses_safe_empty_map_reference():
    message = MessageCreate(client_message_id="msg-12345678", text="What can you help with?")
    assert message.context == ContextRef(page="map", revision=1)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("domain", "expected_guidance"),
    [
        ("field_management", "owned fields"),
        ("remote_sensing", "selected area"),
        ("local_agriculture", "mock"),
        ("rotation", "rotation"),
    ],
)
async def test_generation_receives_domain_without_weakening_evidence_gate(
    monkeypatch, domain, expected_guidance
):
    requests = provider(monkeypatch, [response("Please select a relevant item first.", 2, 1)])
    context, evidence = context_and_evidence()
    context["preset"] = domain
    await pipeline.generate_answer(
        "Please help", context, evidence, language="en", detail="brief", history=[]
    )
    sent = requests[0]
    instructions = " ".join(
        message.content for message in sent if isinstance(message, SystemMessage)
    )
    assert expected_guidance in instructions.casefold()
    assert "evidence" in instructions.casefold()
    assert json.loads(sent[-1].content)["domain"] == domain


@pytest.mark.asyncio
async def test_domain_conversations_and_language_survive_new_sessions(assistant_db):
    factory, owner, _ = assistant_db
    service = AssistantService()
    async with factory() as session:
        assert (await service.preferences(session, owner))["language"] == "en"
        created = [
            await service.create_conversation(session, owner, ConversationCreate(preset=preset))
            for preset in DOMAINS
        ]
        assert [item["preset"] for item in created] == list(DOMAINS)
        await service.set_preferences(session, owner, PreferenceInput(language="zh"))
        chinese = await service.create_conversation(
            session, owner, ConversationCreate(preset="remote_sensing")
        )
        assert chinese["language"] == "zh"
        await service.set_preferences(
            session, owner, PreferenceInput(language="en"), created[0]["id"]
        )

    async with factory() as session:
        assert (await service.preferences(session, owner))["language"] == "en"
        field_chat = await service.get_conversation(session, owner, created[0]["id"])
        assert field_chat["preset"] == "field_management"
        assert field_chat["language"] == "en"
        assert field_chat["messages"] == []
        assert {item["id"] for item in await service.list_conversations(session, owner)} >= {
            item["id"] for item in created
        }
        assert await service.list_conversations(session, "another-owner") == []
        with pytest.raises(HTTPException) as denied:
            await service.get_conversation(session, "another-owner", created[0]["id"])
        assert denied.value.status_code == 404
        rows = (
            await session.scalars(select(Conversation).where(Conversation.owner_user_id == owner))
        ).all()
        assert len(rows) == 5  # Four domains and one Chinese chat.


@pytest.mark.asyncio
async def test_field_chat_freezes_only_owned_fields_and_persists_history(assistant_db):
    factory, owner, field_id = assistant_db
    service = AssistantService()
    async with factory() as session:
        foreign_id = str(uuid4())
        session.add(
            FieldRecord(
                id=foreign_id,
                owner_user_id="another-owner",
                data={"name": "Private neighbour field", "area_ha": 9},
            )
        )
        await session.commit()
        created = await service.create_conversation(
            session, owner, ConversationCreate(preset="field_management")
        )
        message, work = await service.start_message(
            session,
            owner,
            created["id"],
            MessageCreate(client_message_id="field-message-123", text="Tell me about my fields"),
        )
        assert work
        assert message.context_snapshot["preset"] == "field_management"
        assert [field["id"] for field in message.context_snapshot["fields"]] == [field_id]
        assert message.context_snapshot["language"] == "en"
        assert await service.finish_message(
            session,
            message.id,
            "complete",
            {"paragraphs": [{"text": "Your field is available.", "evidence_ids": []}]},
            None,
        )

    async with factory() as session:
        page = await service.get_conversation(session, owner, created["id"])
        assert [item["text"] for item in page["messages"]] == ["Tell me about my fields"]
        assert page["messages"][0]["response"]["paragraphs"][0]["text"] == (
            "Your field is available."
        )
        assert [item["id"] for item in page["messages"][0]["context_labels"]["fields"]] == [
            field_id
        ]
        assert (
            await session.scalars(
                select(AssistantMessage).where(AssistantMessage.owner_user_id == "another-owner")
            )
        ).all() == []
        with pytest.raises(HTTPException) as denied:
            await service.get_conversation(session, "another-owner", created["id"])
        assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_explicit_foreign_field_reference_remains_forbidden(assistant_db):
    factory, owner, field_id = assistant_db
    async with factory() as session:
        with pytest.raises(HTTPException) as denied:
            await freeze_context(
                session,
                "another-owner",
                ContextRef(
                    page="map", revision=1, fields=[{"id": field_id, "expected_version": 1}]
                ),
                "en",
                preset="field_management",
            )
        assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_field_domain_discloses_when_its_owned_field_snapshot_is_truncated(assistant_db):
    factory, owner, _ = assistant_db
    async with factory() as session:
        session.add_all(
            FieldRecord(
                id=str(uuid4()),
                owner_user_id=owner,
                data={"name": f"Extra field {index}", "area_ha": 1},
            )
            for index in range(11)
        )
        await session.commit()
        snapshot = await freeze_context(
            session, owner, ContextRef(page="map", revision=1), "en", preset="field_management"
        )
        assert len(snapshot["fields"]) == 10
        assert "field_list_truncated" in snapshot["warnings"]
