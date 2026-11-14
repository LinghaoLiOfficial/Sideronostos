"""Conversation and product help must work before any farm data is saved."""

from types import SimpleNamespace

import pytest
from pydantic import SecretStr
from test_assistant_pipeline import context_and_evidence, provider, response

from sideronostos_backend.modules.farm_assistant import intents, pipeline
from sideronostos_backend.modules.farm_assistant.dialogue import route_message


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(
        pipeline,
        "get_ai_settings",
        lambda: SimpleNamespace(
            workflow_mode="mock",
            for_task=lambda task: SimpleNamespace(api_key=SecretStr(""), model="unused"),
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "create_chat_model",
        lambda **kwargs: pytest.fail("No model credential is configured"),
    )
    monkeypatch.setattr(
        pipeline,
        "EmbeddingProvider",
        lambda: pytest.fail("Conversation and shipped product help must not need retrieval"),
    )

    async def unavailable(*args, **kwargs):
        pytest.fail("Conversation and shipped product help must not search the web")

    monkeypatch.setattr(pipeline, "search_web", unavailable)


async def reply(question, *, language="en", bot="field-guide", preset="field_management"):
    context, _ = context_and_evidence()
    context.update(language=language, bot_id=bot, preset=preset)
    release = SimpleNamespace(
        id="old-pinned-demo", manifest_sha256="a" * 64, embedding_namespace="mock"
    )
    evidence = await pipeline.collect_evidence(None, question, context, release)
    return await pipeline.generate_answer(
        question, context, evidence, language=language, detail="brief", history=[]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("question", ["hi", "Hello!", "hey there", "Good morning"])
async def test_greeting_does_not_require_a_field_source_or_web_search(offline, question):
    result = await reply(question)
    text = " ".join(p["text"] for p in result["paragraphs"])
    assert "Field guide" in text
    assert "?" in text
    assert "no published source" not in text
    assert result["needs_clarification"] is False
    assert result["citations"] == []
    assert result["metrics"]["model_ms"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "question",
    [
        "What information do I need before creating a new field?",
        "How do I add a field?",
        "Hi, what details are required to register my field?",
        "I want to create a new field",
    ],
)
async def test_field_setup_explains_required_inputs_without_saved_records(offline, question):
    result = await reply(question)
    text = " ".join(p["text"] for p in result["paragraphs"]).casefold()
    for required in ("name", "area", "latitude", "longitude", "soil", "irrigation", "profile"):
        assert required in text
    assert "use module tools" in text and "create field" in text
    assert result["needs_clarification"] is False
    assert result["citations"]
    assert result["paragraphs"][0]["evidence_ids"]
    assert result["actions"] == []  # Explaining the form never performs a write.


@pytest.mark.asyncio
async def test_chinese_conversation_and_field_setup_use_the_selected_language(offline):
    greeting = await reply("你好", language="zh")
    assert "地块助手" in greeting["paragraphs"][0]["text"]
    result = await reply("新建地块需要提供哪些信息？", language="zh")
    text = " ".join(p["text"] for p in result["paragraphs"])
    for required in ("名称", "面积", "经纬度", "土壤", "灌溉", "配置"):
        assert required in text
    assert result["needs_clarification"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("bot", "preset", "expected"),
    [
        ("field-guide", "field_management", "field"),
        ("remote-soil", "remote_sensing", "surface"),
        ("remote-weather", "remote_sensing", "historical"),
        ("rotation-guide", "rotation", "rotation"),
        ("local-knowledge-guide", "local_agriculture", "knowledge"),
    ],
)
async def test_capabilities_are_available_without_a_knowledge_release_lookup(
    offline, bot, preset, expected
):
    result = await reply("What can you help me with?", bot=bot, preset=preset)
    text = " ".join(p["text"] for p in result["paragraphs"]).casefold()
    assert expected in text
    assert result["needs_clarification"] is False
    assert "no published source" not in text


@pytest.mark.parametrize("preset", ["field_management", "remote_sensing", "local_agriculture"])
def test_rotation_version_filters_do_not_remove_other_modules_product_help(preset):
    context = {"preset": preset, "run": None}
    assert intents.excluded_product_sources(context) == []
    assert intents.retrieval_sources("How do I use this module?", "guide", context) is None


@pytest.mark.parametrize(
    "question",
    [
        "Hi, why is my soil dry?",
        "Thanks, how much rain fell on my field?",
        "What happens if I add too much nitrogen to my field?",
        "你好，我的地块缺水吗？",
    ],
)
def test_greetings_and_field_words_do_not_hide_substantive_questions(question):
    route = route_message(question, {"preset": "field_management", "bot_id": "field-guide"})
    assert route.kind == "evidence"


@pytest.mark.asyncio
async def test_configured_llm_receives_product_help_without_needing_saved_fields(
    offline, monkeypatch
):
    generated = response(
        "Prepare the field name, area and location using the creation form.", 10, 1
    )
    generated["parsed"]["paragraphs"][0]["evidence_ids"] = ["K1"]
    generated["parsed"]["needs_clarification"] = False
    requests = provider(monkeypatch, [generated])
    result = await reply("What information do I need before creating a new field?")
    assert result["needs_clarification"] is False
    assert result["citations"][0]["source"]["access_scope"] == "product_help"
    assert "parameter profile" in requests[0][-1].content
    assert result["metrics"]["model"] != "local-mock"
