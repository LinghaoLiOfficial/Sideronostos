"""Deterministic orchestration tests; provider responses are simulated, not AI quality evidence."""

from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage
from pydantic import SecretStr

from sideronostos_backend.modules.farm_assistant import pipeline


def context_and_evidence():
    return (
        {
            "reference": {"page": "map"},
            "fields": [],
            "warnings": [],
            "allowed_actions": [],
            "can_claim_optimal": False,
        },
        {
            "intent": "learn",
            "facts": [],
            "knowledge": [],
            "retrieval_mode": "hybrid",
            "kb_release_id": "test-release",
            "embedding_tokens": 10,
            "retrieval_ms": 12,
        },
    )


def response(text, tokens, duration):
    return {
        "parsed": {
            "paragraphs": [{"text": text, "evidence_ids": []}],
            "actions": [],
            "needs_clarification": True,
        },
        "raw": AIMessage(
            content="",
            usage_metadata={
                "input_tokens": tokens,
                "output_tokens": 20,
                "total_tokens": tokens + 20,
            },
            response_metadata={"token_usage": {"cost": 0.001}},
        ),
        "attempts": [{"duration_ms": duration}],
    }


def provider(monkeypatch, responses):
    requests = []

    async def invoke(model, schema, messages, **kwargs):
        requests.append(messages)
        if not responses:
            raise AssertionError("Repair budget exceeded")
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(pipeline, "invoke_structured_model", invoke)
    monkeypatch.setattr(pipeline, "create_chat_model", lambda **kw: object())
    monkeypatch.setattr(
        pipeline,
        "get_ai_settings",
        lambda: SimpleNamespace(for_task=lambda task: SimpleNamespace(model="openai/gpt-5.4-nano")),
    )
    return requests


@pytest.mark.asyncio
async def test_invalid_answer_is_repaired_once_and_all_calls_are_metered(monkeypatch):
    requests = provider(
        monkeypatch,
        [response("需要999毫米水。", 100, 10), response("目前没有可用的补水估算。", 150, 15)],
    )
    context, evidence = context_and_evidence()
    result = await pipeline.generate_answer(
        "需要多少水？", context, evidence, language="zh", detail="brief", history=[]
    )
    assert result["paragraphs"][0]["text"] == "目前没有可用的补水估算。"
    assert result["metrics"]["usage"]["total_tokens"] == 290
    assert result["metrics"]["model_ms"] == 25
    assert result["metrics"]["provider_reported_cost_usd"] == pytest.approx(0.002)
    assert result["metrics"]["validation_repairs"] == 1
    assert len(requests) == 2
    assert "Numbers must come from server-bound facts" in requests[1][-1].content


@pytest.mark.asyncio
async def test_repair_cannot_bypass_guards_and_has_no_third_attempt(monkeypatch):
    requests = provider(
        monkeypatch, [response("需要999毫米水。", 100, 10), response("需要八毫米水。", 150, 15)]
    )
    context, evidence = context_and_evidence()
    with pytest.raises(ValueError, match="Numbers"):
        await pipeline.generate_answer(
            "需要多少水？", context, evidence, language="zh", detail="brief", history=[]
        )
    assert len(requests) == 2


@pytest.mark.asyncio
async def test_valid_response_is_not_repaired(monkeypatch):
    requests = provider(monkeypatch, [response("目前没有可用的补水估算。", 100, 10)])
    context, evidence = context_and_evidence()
    result = await pipeline.generate_answer(
        "需要多少水？", context, evidence, language="zh", detail="brief", history=[]
    )
    assert result["metrics"]["validation_repairs"] == 0
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_transport_failure_does_not_trigger_semantic_repair(monkeypatch):
    requests = provider(monkeypatch, [TimeoutError("Provider unavailable")])
    context, evidence = context_and_evidence()
    with pytest.raises(TimeoutError):
        await pipeline.generate_answer(
            "需要多少水？", context, evidence, language="zh", detail="brief", history=[]
        )
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_other_model_does_not_inherit_nano_estimate_basis(monkeypatch):
    provider(monkeypatch, [response("目前没有可用的补水估算。", 100, 10)])
    monkeypatch.setattr(
        pipeline,
        "get_ai_settings",
        lambda: SimpleNamespace(
            for_task=lambda task: SimpleNamespace(model="openai/gpt-5.4-mini")
        ),
    )
    context, evidence = context_and_evidence()
    result = await pipeline.generate_answer(
        "需要多少水？", context, evidence, language="zh", detail="brief", history=[]
    )
    metrics = result["metrics"]
    assert metrics["provider_reported_cost_usd"] == pytest.approx(0.001)
    assert metrics["estimated_cost_usd"] is None
    assert metrics["pricing_basis"] is None


@pytest.mark.asyncio
async def test_local_mock_answer_uses_published_kb_citation_without_provider(monkeypatch):
    monkeypatch.setattr(
        pipeline,
        "get_ai_settings",
        lambda: SimpleNamespace(
            workflow_mode="mock",
            for_task=lambda task: SimpleNamespace(api_key=SecretStr(""), model="ignored"),
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "create_chat_model",
        lambda **kwargs: pytest.fail("offline mock must not call a provider"),
    )
    context, evidence = context_and_evidence()
    context.update({"language": "zh", "preset": "rotation", "bot_id": "rotation-guide"})
    source = {
        "id": "K1",
        "source": {
            "title": "Local product help",
            "url": "https://docs.example.invalid/help",
            "access_scope": "product_help",
            "regions": ["product documentation"],
            "limitations": ["Product help only."],
        },
        "excerpt": "轮作页面提供预算和作物条件。",
        "claims": [],
    }
    evidence["knowledge"] = [source]
    result = await pipeline.generate_answer(
        "轮作页面能做什么？", context, evidence, language="zh", detail="brief", history=[]
    )
    assert result["metrics"]["model"] == "local-mock"
    assert result["paragraphs"][0]["evidence_ids"] == ["K1"]
    assert "田间工作" in result["paragraphs"][0]["text"]
    assert "演示资料" in result["paragraphs"][0]["text"]
    assert result["citations"] == [source]


@pytest.mark.asyncio
async def test_local_mock_prefers_relevant_farmer_guidance_over_document_metadata(monkeypatch):
    monkeypatch.setattr(
        pipeline, "get_ai_settings",
        lambda: SimpleNamespace(
            workflow_mode="mock",
            for_task=lambda task: SimpleNamespace(api_key=SecretStr(""), model="ignored"),
        ),
    )
    context, evidence = context_and_evidence()
    context.update({"language": "en", "preset": "field_management", "bot_id": "field-guide"})
    evidence["knowledge"] = [{
        "id": "K1",
        "source": {
            "title": "Demo help", "access_scope": "product_help",
            "regions": ["product documentation"], "limitations": ["Demo only"],
        },
        "excerpt": (
            "# Field Shift v2: farmer workflow. Version: product-help-20261114-v2. "
            "For field planning, save an owned field with location, area, soil texture, "
            "irrigation availability, and planting history."
        ),
        "claims": [],
    }]
    result = await pipeline.generate_answer(
        "How do I start field planning?", context, evidence,
        language="en", detail="brief", history=[],
    )
    answer = result["paragraphs"][0]["text"]
    assert "save an owned field" in answer
    assert "Version" not in answer
    assert "numeric detail omitted" not in answer


@pytest.mark.asyncio
async def test_local_mock_asks_for_missing_module_context_without_inventing_facts(monkeypatch):
    monkeypatch.setattr(
        pipeline,
        "get_ai_settings",
        lambda: SimpleNamespace(
            workflow_mode="mock",
            for_task=lambda task: SimpleNamespace(api_key=SecretStr(""), model="ignored"),
        ),
    )
    context, evidence = context_and_evidence()
    context.update({"language": "en", "preset": "field_management", "bot_id": "field-guide"})
    result = await pipeline.generate_answer(
        "What is in my field?", context, evidence, language="en", detail="brief", history=[]
    )
    assert result["needs_clarification"] is True
    assert result["paragraphs"][0]["evidence_ids"] == []
