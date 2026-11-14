"""Typed, owner-bound actions for the farmer assistant.

The caller persists ``pending`` in the owned conversation and supplies a durable
``ActionJournal`` for writes. This module never accepts a model-generated URL.
"""

import hashlib
import json
from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any, Literal, Protocol
from urllib.parse import urlencode
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..agri_data.service import AgriDataService
from ..field_shift.schemas import FieldInput
from ..field_shift.service import FieldShiftService

ActionName = Literal["field.create", "remote_sensing.layer", "remote_sensing.fact"]
ActionStatus = Literal["needs_input", "succeeded", "unavailable", "failed"]
Metric = Literal["surface_soil_moisture", "rainfall_total", "reference_et0_total"]


class ActionConflict(ValueError):
    """An action continuation or idempotency key crosses a trust boundary."""


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: ActionName
    arguments: dict[str, Any]
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=80)


class PendingAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    owner_user_id: str
    conversation_id: str
    action: ActionName
    arguments: dict[str, Any]
    idempotency_key: str | None = None


class ActionOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: ActionStatus
    action: ActionName
    text: str
    missing_fields: list[str] = Field(default_factory=list)
    pending: PendingAction | None = None
    result: dict[str, Any] | None = None
    href: str | None = None


class LayerArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    layer_id: str = Field(min_length=1, max_length=180)


class FactArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selection_id: str = Field(min_length=1, max_length=100)
    metric: Metric
    start: date | None = None
    end: date | None = None
    expected_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def valid_window(self) -> "FactArguments":
        if (self.start is None) != (self.end is None):
            raise ValueError("Provide both start and end dates")
        if (
            self.start
            and self.end
            and (self.end < self.start or (self.end - self.start).days > 1095)
        ):
            raise ValueError("Date window must be ordered and at most three years")
        return self


class ActionJournal(Protocol):
    """Integration must serialize, audit, and durably deduplicate one write."""

    async def run_once(
        self,
        owner_user_id: str,
        conversation_id: str,
        idempotency_key: str,
        fingerprint: str,
        operation: Callable[[], Awaitable[ActionOutcome]],
    ) -> ActionOutcome: ...


class FieldOperations(Protocol):
    async def create_field(
        self, session: AsyncSession, owner_user_id: str, body: FieldInput
    ) -> Any: ...


class AgriOperations(Protocol):
    async def layer_manifest(
        self, session: AsyncSession, owner_user_id: str, layer_id: str
    ) -> dict[str, Any]: ...

    async def facts(
        self,
        session: AsyncSession,
        owner_user_id: str,
        selection_id: str,
        *,
        start: date | None,
        end: date | None,
        expected_revision: int | None,
    ) -> dict[str, Any]: ...


SCHEMAS: dict[ActionName, type[BaseModel]] = {
    "field.create": FieldInput,
    "remote_sensing.layer": LayerArguments,
    "remote_sensing.fact": FactArguments,
}


def _field_href(identifier: str) -> str:
    UUID(identifier)  # The field service uses UUID identifiers; reject invented routes.
    return "/field-shift?" + urlencode({"field": identifier, "step": "field"})


def _map_href(key: str, identifier: str) -> str:
    return "/field-shift/map?" + urlencode({key: identifier})


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return value
    raise ValueError("Action service returned an invalid result")


class AgentActionService:
    def __init__(
        self,
        *,
        field_service: FieldOperations | None = None,
        agri_service: AgriOperations | None = None,
        journal: ActionJournal | None = None,
    ) -> None:
        self.fields = field_service or FieldShiftService()
        self.agri = agri_service or AgriDataService()
        self.journal = journal

    async def advance(
        self,
        session: AsyncSession,
        owner_user_id: str,
        conversation_id: str,
        request: ActionRequest,
        *,
        pending: PendingAction | None = None,
        language: Literal["en", "zh"] = "en",
    ) -> ActionOutcome:
        if pending is not None and (
            pending.owner_user_id != owner_user_id
            or pending.conversation_id != conversation_id
            or pending.action != request.action
            or pending.idempotency_key != request.idempotency_key
        ):
            raise ActionConflict("Pending action does not belong to this conversation")
        arguments = {**(pending.arguments if pending else {}), **request.arguments}
        state = PendingAction(
            owner_user_id=owner_user_id,
            conversation_id=conversation_id,
            action=request.action,
            arguments=arguments,
            idempotency_key=request.idempotency_key,
        )
        schema = SCHEMAS[request.action]
        missing = [
            name
            for name, field in schema.model_fields.items()
            if field.is_required()
            and (name not in arguments or arguments[name] is None or arguments[name] == "")
        ]
        if missing:
            label = ", ".join(missing)
            prompt = (
                f"请提供以下信息：{label}。" if language == "zh" else f"Please provide: {label}."
            )
            return ActionOutcome(
                status="needs_input",
                action=request.action,
                text=prompt,
                missing_fields=missing,
                pending=state,
            )
        try:
            body = schema.model_validate(arguments)
        except ValidationError as error:
            return ActionOutcome(
                status="failed",
                action=request.action,
                text="请更正输入后重试。"
                if language == "zh"
                else "Please correct the inputs and try again.",
                pending=state,
                result={
                    "validation_errors": error.errors(include_url=False, include_context=False)
                },
            )

        try:
            if request.action == "field.create":
                if request.idempotency_key is None or self.journal is None:
                    raise ActionConflict("Field creation requires a durable idempotency journal")
                assert isinstance(body, FieldInput)
                fingerprint = hashlib.sha256(
                    json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()
                ).hexdigest()

                async def create() -> ActionOutcome:
                    result = _as_dict(await self.fields.create_field(session, owner_user_id, body))
                    return ActionOutcome(
                        status="succeeded",
                        action=request.action,
                        text="地块已创建。" if language == "zh" else "Field created.",
                        result=result,
                        href=_field_href(result["id"]),
                    )

                return await self.journal.run_once(
                    owner_user_id, conversation_id, request.idempotency_key, fingerprint, create
                )
            if request.action == "remote_sensing.layer":
                assert isinstance(body, LayerArguments)
                result = await self.agri.layer_manifest(session, owner_user_id, body.layer_id)
                if result.get("id") != body.layer_id or not result.get("source"):
                    raise ValueError("Layer service did not confirm the requested layer")
                return ActionOutcome(
                    status="succeeded",
                    action=request.action,
                    text="图层已打开。" if language == "zh" else "Layer ready to open.",
                    result=result,
                    href=_map_href("layer", body.layer_id),
                )
            assert isinstance(body, FactArguments)
            data = await self.agri.facts(
                session,
                owner_user_id,
                body.selection_id,
                start=body.start,
                end=body.end,
                expected_revision=body.expected_revision,
            )
            fact = next(
                (
                    item
                    for item in data["facts"]
                    if item.get("metric") == body.metric
                    and item.get("value") is not None
                    and item.get("source")
                ),
                None,
            )
            if fact is None:
                return ActionOutcome(
                    status="unavailable",
                    action=request.action,
                    text="没有可用的已发布数据。"
                    if language == "zh"
                    else "No published fact is available for this selection.",
                    result={"unavailable": data.get("unavailable", [])},
                )
            query = {"selection": body.selection_id}
            if body.start and body.end:
                query.update(obsStart=body.start.isoformat(), obsEnd=body.end.isoformat())
            return ActionOutcome(
                status="succeeded",
                action=request.action,
                text="已找到观测资料。" if language == "zh" else "Published observation found.",
                result=fact,
                href="/field-shift/map?" + urlencode(query),
            )
        except HTTPException as error:
            return ActionOutcome(
                status="failed",
                action=request.action,
                text=str(error.detail),
            )
        except (KeyError, TypeError, ValueError) as error:
            if isinstance(error, ActionConflict):
                raise
            return ActionOutcome(
                status="failed",
                action=request.action,
                text="Action could not be completed." if language == "en" else "操作未能完成。",
            )
