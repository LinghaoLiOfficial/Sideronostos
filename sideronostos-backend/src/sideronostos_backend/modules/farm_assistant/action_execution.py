"""Persistent authenticated action orchestration and atomic field creation."""

from collections.abc import Awaitable, Callable
from typing import Any, Literal
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..field_shift.schemas import FieldInput
from ..field_shift.service import FieldShiftService
from .agent_actions import (
    ActionConflict,
    ActionOutcome,
    ActionRequest,
    AgentActionService,
    PendingAction,
)
from .bot_scope import action_allowed, layer_allowed
from .models import AssistantAction, utcnow
from .service import AssistantService


def _event(status: str) -> dict[str, str]:
    return {"at": utcnow().isoformat(), "status": status}


class _AtomicFieldOperations:
    def __init__(self, conversation_id: str, idempotency_key: str) -> None:
        self.conversation_id = conversation_id
        self.idempotency_key = idempotency_key

    async def create_field(
        self, session: AsyncSession, owner_user_id: str, body: FieldInput
    ) -> Any:
        identifier = str(
            uuid5(
                NAMESPACE_URL,
                f"sideronostos:agent-field:{owner_user_id}:{self.conversation_id}:{self.idempotency_key}",
            )
        )
        return await FieldShiftService().create_field(
            session, owner_user_id, body, field_id=identifier, commit=False
        )


class _DatabaseJournal:
    """The field and outcome commit together in the current database session."""

    def __init__(self, session: AsyncSession, row: AssistantAction) -> None:
        self.session = session
        self.row = row

    async def run_once(
        self,
        owner_user_id: str,
        conversation_id: str,
        idempotency_key: str,
        fingerprint: str,
        operation: Callable[[], Awaitable[ActionOutcome]],
    ) -> ActionOutcome:
        if (
            self.row.owner_user_id != owner_user_id
            or self.row.conversation_id != conversation_id
            or self.row.idempotency_key != idempotency_key
        ):
            raise ActionConflict("Action journal scope mismatch")
        if self.row.status == "succeeded":
            if self.row.payload_hash != fingerprint or self.row.outcome is None:
                raise ActionConflict("Idempotency key was reused with different inputs")
            return ActionOutcome.model_validate(self.row.outcome)
        outcome = await operation()
        self.row.status = outcome.status
        self.row.payload_hash = fingerprint
        self.row.outcome = outcome.model_dump(mode="json")
        self.row.audit_events = [*self.row.audit_events, _event(outcome.status)]
        self.row.updated_at = utcnow()
        await self.session.commit()
        return outcome


class AssistantActionService:
    async def list(
        self, session: AsyncSession, owner_user_id: str, conversation_id: str
    ) -> list[dict[str, Any]]:
        await AssistantService()._conversation(session, owner_user_id, conversation_id)
        rows = (
            await session.scalars(
                select(AssistantAction)
                .where(
                    AssistantAction.conversation_id == conversation_id,
                    AssistantAction.owner_user_id == owner_user_id,
                )
                .order_by(AssistantAction.updated_at.desc(), AssistantAction.id.desc())
                .limit(50)
            )
        ).all()
        return [
            {
                "idempotency_key": row.idempotency_key,
                "action": row.action,
                "status": row.status,
                "outcome": row.outcome,
                "created_at": row.created_at.isoformat(),
                "updated_at": row.updated_at.isoformat(),
            }
            for row in rows
        ]

    async def advance(
        self,
        session: AsyncSession,
        owner_user_id: str,
        conversation_id: str,
        request: ActionRequest,
    ) -> ActionOutcome:
        if request.idempotency_key is None:
            raise HTTPException(422, "Action idempotency key is required")
        conversation = await AssistantService()._conversation(
            session, owner_user_id, conversation_id, lock=True
        )
        metric = (
            request.arguments.get("metric") if request.action == "remote_sensing.fact" else None
        )
        if not action_allowed(conversation.bot_id, request.action, metric):
            raise HTTPException(422, "Action is outside this bot's specialty")
        row = await session.scalar(
            select(AssistantAction)
            .where(
                AssistantAction.conversation_id == conversation_id,
                AssistantAction.owner_user_id == owner_user_id,
                AssistantAction.idempotency_key == request.idempotency_key,
            )
            .with_for_update()
        )
        if row is None:
            row = AssistantAction(
                conversation_id=conversation_id,
                owner_user_id=owner_user_id,
                idempotency_key=request.idempotency_key,
                action=request.action,
                arguments={},
                status="pending",
                outcome=None,
                audit_events=[_event("started")],
            )
            session.add(row)
            await session.flush()
        elif row.action != request.action:
            raise HTTPException(409, "Action key already belongs to a different action")
        elif row.status == "succeeded":
            if any(
                key not in row.arguments or row.arguments[key] != value
                for key, value in request.arguments.items()
            ):
                raise HTTPException(409, "Action key already belongs to different inputs")
            if row.outcome is None:
                raise HTTPException(409, "Action result is unavailable")
            row.audit_events = [*row.audit_events, _event("replayed")]
            row.updated_at = utcnow()
            await session.commit()
            return ActionOutcome.model_validate(row.outcome)

        pending = PendingAction(
            owner_user_id=owner_user_id,
            conversation_id=conversation_id,
            action=request.action,
            arguments=row.arguments,
            idempotency_key=request.idempotency_key,
        )
        row.arguments = {**row.arguments, **request.arguments}
        core = AgentActionService(
            field_service=_AtomicFieldOperations(conversation_id, request.idempotency_key),
            journal=_DatabaseJournal(session, row),
        )
        language: Literal["en", "zh"] = "zh" if conversation.language == "zh" else "en"
        try:
            outcome = await core.advance(
                session,
                owner_user_id,
                conversation_id,
                request,
                pending=pending,
                language=language,
            )
        except ActionConflict as error:
            raise HTTPException(409, str(error)) from error
        if (
            request.action == "remote_sensing.layer"
            and outcome.status == "succeeded"
            and not layer_allowed(
                conversation.bot_id, ((outcome.result or {}).get("source") or {}).get("product")
            )
        ):
            await session.rollback()
            raise HTTPException(422, "Layer is outside this bot's specialty")
        if request.action == "field.create" and outcome.status == "succeeded":
            return outcome  # Journal committed field, action result, and audit together.
        row.status = outcome.status
        row.outcome = outcome.model_dump(mode="json")
        row.audit_events = [*row.audit_events, _event(outcome.status)]
        row.updated_at = utcnow()
        await session.commit()
        return outcome

    async def get(
        self,
        session: AsyncSession,
        owner_user_id: str,
        conversation_id: str,
        idempotency_key: str,
    ) -> ActionOutcome:
        await AssistantService()._conversation(session, owner_user_id, conversation_id)
        row = await session.scalar(
            select(AssistantAction).where(
                AssistantAction.conversation_id == conversation_id,
                AssistantAction.owner_user_id == owner_user_id,
                AssistantAction.idempotency_key == idempotency_key,
            )
        )
        if row is None or row.outcome is None:
            raise HTTPException(404, "Action not found")
        return ActionOutcome.model_validate(row.outcome)
