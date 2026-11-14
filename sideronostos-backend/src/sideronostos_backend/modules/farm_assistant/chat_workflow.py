"""Persist the first farmer-facing, confirmation-gated field workflow."""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..field_shift.profiles import get_profiles
from ..field_shift.schemas import FieldInput
from .agent_actions import ActionRequest
from .models import AssistantAction, AssistantMessage, utcnow

REQUIRED = tuple(name for name, field in FieldInput.model_fields.items() if field.is_required())
ACTIVE = ("needs_input", "awaiting_confirmation")


def _details(text: str) -> dict[str, Any]:
    """Extract only explicitly supplied values in the local mock workflow."""
    found: dict[str, Any] = {}
    name = re.search(r"\bcall it\s+([^.!?]+)", text, re.I)
    if name:
        found["name"] = name.group(1).strip()
    area = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:hectares?|ha)\b", text, re.I)
    if area:
        found["area_ha"] = float(area.group(1))
    for key in ("latitude", "longitude"):
        value = re.search(rf"\b{key}\s*(?:is|:)?\s*(-?\d+(?:\.\d+)?)", text, re.I)
        if value:
            found[key] = float(value.group(1))
    soil = re.search(r"\b(?:soil(?: texture)?\s+(?:is\s+)?)?(loam|sand|clay|unknown)\b", text, re.I)
    if soil:
        found["soil_texture"] = soil.group(1).lower()
    if re.search(r"\b(?:no|without)\s+irrigation\b", text, re.I):
        found["irrigation_available"] = False
    elif re.search(r"\birrigation\s+(?:is\s+)?available\b", text, re.I):
        found["irrigation_available"] = True
    if re.search(r"\bno\s+(?:planting|crop)\s+history\b", text, re.I):
        found["history"] = []
    if re.search(r"\btemperate\s+demo\b", text, re.I):
        matching = [
            profile
            for profile in get_profiles()
            if profile.id == "temperate-demo" and profile.is_demo
        ]
        if matching:
            found["profile_id"] = matching[0].id
    return found


def _reply(flow: AssistantAction, text: str, *, href: str | None = None) -> dict[str, Any]:
    task = {
        "id": flow.id,
        "status": flow.status,
        "missing_inputs": [key for key in REQUIRED if key not in flow.arguments],
        "summary": dict(flow.arguments) if flow.status == "awaiting_confirmation" else None,
        "href": href,
        "preview_url": (
            f"/farm-assistant/conversations/{flow.conversation_id}/previews/{flow.id}"
            if flow.status == "completed" and href
            else None
        ),
    }
    return {
        "paragraphs": [{"text": text, "evidence_ids": []}],
        "facts": [],
        "citations": [],
        "actions": [],
        "needs_clarification": flow.status in ACTIVE,
        "retrieval_mode": "mock_field_workflow",
        "task": task,
    }


async def handle_field_chat(session: AsyncSession, message_id: str) -> dict[str, Any] | None:
    message = await session.get(AssistantMessage, message_id)
    if message is None or message.context_snapshot.get("bot_id") not in {
        "field-guide",
        "general-guide",
    }:
        return None
    flow = await session.scalar(
        select(AssistantAction)
        .where(
            AssistantAction.conversation_id == message.conversation_id,
            AssistantAction.owner_user_id == message.owner_user_id,
            AssistantAction.action == "chat.field.create",
            AssistantAction.status.in_(ACTIVE),
        )
        .order_by(AssistantAction.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    question = message.text.strip()
    if flow is None:
        if re.match(r"^(?:what|how|which|why|when|where)\b|^(?:什么|如何|怎么)", question, re.I):
            return None
        if re.search(
            r"\b(?:do\s+not|don't|not)\s+(?:add|create)\b|不要(?:新增|创建)", question, re.I
        ):
            return None
        if not re.search(
            r"\b(?:add|create|new)\b.*\bfield\b|"
            r"\bfield\b.{0,80}\b(?:add|create)\s+it\b|"
            r"(?:新增|创建).*(?:地块|田地)",
            question,
            re.I,
        ):
            return None
        flow = AssistantAction(
            id=str(uuid4()),
            conversation_id=message.conversation_id,
            owner_user_id=message.owner_user_id,
            idempotency_key=f"field-flow-{message.id}",
            action="chat.field.create",
            arguments={},
            status="needs_input",
            outcome=None,
            audit_events=[{"at": utcnow().isoformat(), "status": "started"}],
        )
        session.add(flow)
    elif re.fullmatch(
        r"(?:cancel|stop|no(?:,?\s+(?:do\s+not|don't)\s+create\s+it)?|取消|不要创建)[.!。 ]*",
        question,
        re.I,
    ):
        flow.status = "cancelled"
        flow.updated_at = utcnow()
        await session.commit()
        return _reply(flow, "I have cancelled this field request. No field was saved.")

    if flow.status == "awaiting_confirmation" and re.fullmatch(
        r"(?:yes|confirm|确认|是的)[,! ]*(?:create (?:the |this )?field)?[.!。 ]*", question, re.I
    ):
        from .action_execution import AssistantActionService

        outcome = await AssistantActionService().advance(
            session,
            message.owner_user_id,
            message.conversation_id,
            ActionRequest(
                action="field.create",
                arguments=dict(flow.arguments),
                idempotency_key=f"field-exec-{flow.id}",
            ),
        )
        flow.status = "completed" if outcome.status == "succeeded" else "failed"
        flow.outcome = outcome.model_dump(mode="json")
        flow.audit_events = [
            *flow.audit_events,
            {"at": utcnow().isoformat(), "status": flow.status},
        ]
        flow.updated_at = utcnow()
        await session.commit()
        if outcome.status == "succeeded":
            return _reply(
                flow,
                f"{flow.arguments['name']} is saved. Open the field to check its details.",
                href=outcome.href,
            )
        return _reply(flow, outcome.text)

    supplied = _details(question)
    if supplied:
        flow.arguments = {**flow.arguments, **supplied}
    missing = [key for key in REQUIRED if key not in flow.arguments]
    if missing:
        flow.status = "needs_input"
        flow.updated_at = utcnow()
        await session.commit()
        return _reply(
            flow,
            "To add this field, please tell me its name, area in hectares, "
            "latitude, longitude, soil texture, whether irrigation is available, "
            "planting history, and which crop settings to use.",
        )
    try:
        FieldInput.model_validate(flow.arguments)
    except ValueError:
        flow.status = "needs_input"
        await session.commit()
        return _reply(
            flow,
            "Some field details need correction. "
            "Please check the location, area and crop settings.",
        )
    flow.status = "awaiting_confirmation"
    flow.updated_at = utcnow()
    await session.commit()
    args = flow.arguments
    return _reply(
        flow,
        f"I can save {args['name']}: {args['area_ha']:g} ha at "
        f"{args['latitude']:g}, {args['longitude']:g}; {args['soil_texture']} soil; "
        f"irrigation {'available' if args['irrigation_available'] else 'unavailable'}; "
        "no planting history; temperate demo crop settings. "
        "Please confirm: should I create this field?",
    )
