"""Provider-boundary contract only; synthetic HTTP response is not a quality evaluation."""

import json

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from sideronostos_backend.modules.ai.provider import invoke_structured_model
from sideronostos_backend.modules.farm_assistant.schemas import ModelAnswer


@pytest.mark.asyncio
@pytest.mark.parametrize("strict_schema", [False, True])
async def test_structured_mode_reaches_provider_without_changing_legacy_default(strict_schema):
    requests = []
    payload = {
        "paragraphs": [{"text": "请选择地块。", "evidence_ids": []}],
        "actions": ["choose_field"],
        "needs_clarification": True,
    }

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "test-completion",
                "object": "chat.completion",
                "created": 0,
                "model": "test-only",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": json.dumps(payload)},
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        model = ChatOpenAI(
            model="test-only",
            api_key="test-only",
            base_url="https://test.invalid/v1",
            http_async_client=client,
            max_retries=0,
        )
        kwargs = {"method": "json_schema"} if strict_schema else {}
        result = await invoke_structured_model(
            model, ModelAnswer, [HumanMessage(content="Return JSON")], max_retries=0, **kwargs
        )
    assert result["parsed"] == payload
    assert len(requests) == 1
    fmt = requests[0]["response_format"]
    assert fmt["type"] == ("json_schema" if strict_schema else "json_object")
    if strict_schema:
        assert fmt["json_schema"]["strict"] is True
        schema = fmt["json_schema"]["schema"]
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == {"paragraphs", "actions", "needs_clarification"}


@pytest.mark.asyncio
async def test_task_can_omit_unsupported_temperature_at_transport_boundary():
    from openai import AsyncOpenAI
    from sideronostos_backend.modules.ai.provider import create_chat_model
    from sideronostos_backend.modules.ai.settings import AISettings

    captured = []

    def respond(request):
        captured.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "test",
                "object": "chat.completion",
                "created": 0,
                "model": "test-only",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "ok"},
                    }
                ],
            },
        )

    settings = AISettings(
        _env_file=None,
        api_key="test-only",
        model="test-only",
        task_configs={"farm_assistant": {"omit_temperature": True}},
    )
    model = create_chat_model(settings, task="farm_assistant")
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as transport:
        client = AsyncOpenAI(api_key="test-only", http_client=transport)
        model.async_client = client.chat.completions
        model.root_async_client = client
        await model.ainvoke([HumanMessage(content="hello")])
    assert "temperature" not in captured[0]
