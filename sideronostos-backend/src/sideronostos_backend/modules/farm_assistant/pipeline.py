"""Evidence-bounded generation with at most one validated repair; read-only business context."""

import json
import time
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.provider import create_chat_model, invoke_structured_model
from ..ai.settings import get_ai_settings
from ..knowledge.embeddings import EmbeddingProvider, EmbeddingUnavailable
from ..knowledge.models import KBRelease
from ..knowledge.store import search_release
from .intents import classify, excluded_product_sources, retrieval_query, retrieval_sources
from .model_view import model_view
from .prompts import SYSTEM, VERSION
from .schemas import ModelAnswer, generation_schema
from .settings import get_assistant_settings
from .validation import bind_answer


async def collect_evidence(
    session: AsyncSession, question: str, context: dict[str, Any], release: KBRelease
) -> dict[str, Any]:
    started = time.perf_counter()
    intent = classify(question, context)
    query = retrieval_query(question)
    provider = EmbeddingProvider()
    vector = None
    tokens = 0
    degraded = None
    try:
        if provider.namespace != release.embedding_namespace:
            degraded = "embedding_identity_changed"
        else:
            try:
                vectors, tokens = await provider.embed([query])
                vector = vectors[0]
            except EmbeddingUnavailable:
                degraded = "embedding_unavailable"
    finally:
        await provider.close()
    product = "SPL3SMP_E" if "smap" in question.casefold() else None
    hits = await search_release(
        session,
        release_id=release.id,
        query=query,
        vector=vector,
        namespace=release.embedding_namespace,
        product=product,
        product_version="006" if product else None,
        source_ids=retrieval_sources(question, intent, context),
        excluded_source_ids=excluded_product_sources(context),
        limit=get_assistant_settings().retrieval_limit,
    )
    knowledge = [{**hit, "chunk_id": hit["id"], "id": f"K{i + 1}"} for i, hit in enumerate(hits)]
    return {
        "intent": intent,
        "retrieval_query": query,
        "knowledge": knowledge,
        "facts": context["facts"],
        "kb_release_id": release.id,
        "kb_manifest_sha256": release.manifest_sha256,
        "retrieval_mode": "lexical_degraded" if degraded else "hybrid",
        "degraded_reason": degraded,
        "embedding_tokens": tokens,
        "retrieval_ms": round((time.perf_counter() - started) * 1000),
        "prompt_version": VERSION,
    }


async def generate_answer(
    question: str,
    context: dict[str, Any],
    evidence: dict[str, Any],
    *,
    language: str,
    detail: str,
    history: list[dict[str, str]],
) -> dict[str, Any]:
    settings = get_ai_settings().for_task("farm_assistant")
    view = model_view(question, context, evidence)
    messages: list[BaseMessage] = [
        SystemMessage(content=SYSTEM),
        SystemMessage(
            content=(
                "Write every paragraph in English. Keep source IDs only in evidence_ids."
                if language == "en"
                else "所有段落使用简体中文，仅保留必要的产品名称和单位。"
            )
        ),
        HumanMessage(
            content=json.dumps(
                {
                    "question": question,
                    "language": language,
                    "detail": detail,
                    "intent": evidence["intent"],
                    "current_context": view["context"],
                    "facts": view["facts"],
                    "knowledge": view["knowledge"],
                    "previous_messages": history,
                    "retrieval_mode": evidence["retrieval_mode"],
                },
                ensure_ascii=False,
            )
        ),
    ]
    model = create_chat_model(task="farm_assistant")
    responses = []
    validation_errors = []
    visible_ids = {v["id"] for v in view["facts"]}
    visible_facts = [f for f in evidence["facts"] if f["id"] in visible_ids]
    visible_knowledge_ids = {k["id"] for k in view["knowledge"]}
    visible_knowledge = [k for k in evidence["knowledge"] if k["id"] in visible_knowledge_ids]
    output_schema = generation_schema(
        [fact["id"] for fact in view["facts"] if fact["render_reference"]],
        sorted(visible_ids | visible_knowledge_ids),
    )
    for attempt in range(2):
        # The service's enclosing deadline includes both calls. Transport failures
        # are not validation repairs and propagate without another provider call.
        response = await invoke_structured_model(
            model, output_schema, messages, max_retries=0, method="json_schema"
        )
        responses.append(response)
        parsed = ModelAnswer.model_validate(response["parsed"])
        try:
            bound = bind_answer(
                parsed,
                visible_facts,
                visible_knowledge,
                allowed_actions=view["context"]["allowed_actions"],
                can_claim_optimal=context["can_claim_optimal"],
                answer_requirement=view["context"].get("answer_requirement"),
            )
        except ValueError as error:
            if attempt:
                raise
            validation_errors.append(str(error))
            messages = [
                *messages,
                HumanMessage(
                    content=(
                        "The server rejected the answer: " + str(error) + ". "
                        "Return a corrected full JSON answer using the SAME evidence and rules. "
                        "Do not repeat the invalid claim or invent evidence. "
                        "Only {{F...}} placeholders may appear in prose; K/F citation IDs belong "
                        "in evidence_ids, never inline brackets. Use only allowed_actions or []. "
                        "If no supported quantity exists, explain the limitation qualitatively. "
                        "Do not echo any quantity from the question, "
                        "including quantities spelled in words. "
                        "Keep the answer short and in the requested language. "
                        "A pure refusal needs no farming citation; "
                        "other factual claims must cite their actual supporting evidence."
                    )
                ),
            ]
        else:
            break
    usage: dict[str, Any] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    costs = []
    for result in responses:
        for key, value in (result["raw"].usage_metadata or {}).items():
            if isinstance(value, int):
                usage[key] = usage.get(key, 0) + value
            elif isinstance(value, dict):
                detail_usage = usage.setdefault(key, {})
                for detail_key, detail_value in value.items():
                    detail_usage[detail_key] = detail_usage.get(detail_key, 0) + detail_value
        cost = ((result["raw"].response_metadata or {}).get("token_usage") or {}).get("cost")
        if cost is not None:
            costs.append(cost)
    input_tokens = usage.get("input_tokens", 0)
    output_tokens = usage.get("output_tokens", 0)
    # Pricing is an explicitly dated estimate, not a provider invoice.
    estimated_cost = (
        (input_tokens * 0.20 + output_tokens * 1.25 + evidence["embedding_tokens"] * 0.02)
        / 1_000_000
        if settings.model == "openai/gpt-5.4-nano"
        else None
    )
    reported_cost = sum(costs) if len(costs) == len(responses) else None
    return {
        **bound,
        "intent": evidence["intent"],
        "facts": evidence["facts"],
        "citations": visible_knowledge,
        "warnings": context["warnings"],
        "retrieval_mode": evidence["retrieval_mode"],
        "kb_release_id": evidence["kb_release_id"],
        "metrics": {
            "model": settings.model,
            "prompt_version": VERSION,
            "usage": usage,
            "embedding_tokens": evidence["embedding_tokens"],
            "retrieval_ms": evidence["retrieval_ms"],
            "model_ms": sum(a["duration_ms"] for r in responses for a in r["attempts"]),
            "validation_repairs": len(validation_errors),
            "initial_validation_errors": validation_errors,
            "provider_reported_cost_usd": reported_cost,
            "estimated_cost_usd": estimated_cost,
            "pricing_basis": (
                "OpenRouter listed GPT-5.4 Nano and text-embedding-3-small, "
                "2026-11-12; not an invoice"
                if estimated_cost is not None
                else None
            ),
        },
    }
