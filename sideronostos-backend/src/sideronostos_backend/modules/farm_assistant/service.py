"""Durable private conversations with idempotency, bounded work and restart recovery."""

import asyncio
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..ai.provider import StructuredInvocationError
from ..knowledge.models import KBRelease
from ..knowledge.store import active_release
from ..rotation_optimizer.service import digest
from .context import freeze_context
from .models import AssistantMessage, Conversation, FarmerPreference, utcnow
from .pipeline import collect_evidence, generate_answer
from .schemas import ConversationCreate, MessageCreate, PreferenceInput
from .settings import get_assistant_settings


def conversation_view(row: Conversation) -> dict[str, Any]:
    return {
        "id": row.id,
        "preset": row.preset,
        "language": row.language,
        "detail": row.detail,
        "kb_release_id": row.kb_release_id,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def message_view(row: AssistantMessage) -> dict[str, Any]:
    return {
        "id": row.id,
        "sequence": row.sequence,
        "client_message_id": row.client_message_id,
        "status": row.status,
        "text": row.text,
        "context": row.context_snapshot["reference"],
        "context_labels": {
            "fields": [
                {"id": f["id"], "name": f["name"], "version": f["version"]}
                for f in row.context_snapshot["fields"]
            ],
            "selection_kind": (row.context_snapshot.get("selection") or {}).get("kind"),
            "run_id": row.context_snapshot["reference"].get("run_id"),
            "option_id": row.context_snapshot["reference"].get("option_id"),
        },
        "response": row.response,
        "facts": row.context_snapshot["facts"],
        "error_code": row.error_code,
        "created_at": row.created_at.isoformat(),
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


class AssistantService:
    async def _conversation(
        self, session: AsyncSession, owner: str, identifier: str, *, lock: bool = False
    ) -> Conversation:
        query = (
            select(Conversation)
            .where(Conversation.id == identifier, Conversation.owner_user_id == owner)
            .execution_options(populate_existing=True)
        )
        if lock:
            query = query.with_for_update()
        row = await session.scalar(query)
        if row is None:
            raise HTTPException(404, "Conversation not found")
        return row

    async def create_conversation(
        self, session: AsyncSession, owner: str, body: ConversationCreate
    ) -> dict[str, Any]:
        try:
            release = await active_release(session)
        except ValueError as error:
            raise HTTPException(503, "Knowledge release is not ready") from error
        preference = await session.get(FarmerPreference, owner)
        language = (
            body.language
            if "language" in body.model_fields_set or preference is None
            else preference.language
        )
        detail = (
            body.detail
            if "detail" in body.model_fields_set or preference is None
            else preference.detail
        )
        row = Conversation(
            owner_user_id=owner,
            preset=body.preset,
            language=language,
            detail=detail,
            kb_release_id=release.id,
        )
        session.add(row)
        await session.commit()
        return conversation_view(row)

    async def _recover(self, session: AsyncSession, conversation_id: str) -> None:
        pending = (
            await session.scalars(
                select(AssistantMessage)
                .where(
                    AssistantMessage.conversation_id == conversation_id,
                    AssistantMessage.status == "pending",
                    AssistantMessage.deadline_at <= utcnow(),
                )
                .with_for_update()
            )
        ).all()
        for message in pending:
            message.status = "interrupted"
            message.error_code = "request_interrupted"
            message.completed_at = utcnow()

    async def get_conversation(
        self,
        session: AsyncSession,
        owner: str,
        identifier: str,
        *,
        before_sequence: int | None = None,
    ) -> dict[str, Any]:
        row = await self._conversation(session, owner, identifier, lock=True)
        await self._recover(session, identifier)
        query = select(AssistantMessage).where(AssistantMessage.conversation_id == identifier)
        if before_sequence is not None:
            query = query.where(AssistantMessage.sequence < before_sequence)
        messages = list(
            (
                await session.scalars(query.order_by(AssistantMessage.sequence.desc()).limit(31))
            ).all()
        )
        more = len(messages) > 30
        messages = messages[:30]
        await session.commit()
        return {
            **conversation_view(row),
            "messages": [message_view(m) for m in reversed(messages)],
            "next_before_sequence": messages[-1].sequence if more else None,
        }

    async def list_conversations(self, session: AsyncSession, owner: str) -> list[dict[str, Any]]:
        rows = (
            await session.scalars(
                select(Conversation)
                .where(Conversation.owner_user_id == owner)
                .order_by(Conversation.updated_at.desc())
                .limit(50)
            )
        ).all()
        return [conversation_view(r) for r in rows]

    async def preferences(self, session: AsyncSession, owner: str) -> dict[str, str]:
        pref = await session.get(FarmerPreference, owner)
        return {
            "language": pref.language if pref else "zh",
            "detail": pref.detail if pref else "brief",
        }

    async def set_preferences(
        self,
        session: AsyncSession,
        owner: str,
        body: PreferenceInput,
        conversation_id: str | None = None,
    ) -> dict[str, str]:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": "assistant-owner:" + owner},
        )
        if conversation_id:
            conversation = await self._conversation(session, owner, conversation_id, lock=True)
            conversation.language = body.language
            conversation.detail = body.detail
        pref = await session.get(FarmerPreference, owner)
        if pref is None:
            pref = FarmerPreference(owner_user_id=owner)
            session.add(pref)
        pref.language = body.language
        pref.detail = body.detail
        pref.updated_at = utcnow()
        await session.commit()
        return {"language": pref.language, "detail": pref.detail}

    async def start_message(
        self, session: AsyncSession, owner: str, conversation_id: str, body: MessageCreate
    ) -> tuple[AssistantMessage, bool]:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": "assistant-owner:" + owner},
        )
        conversation = await self._conversation(session, owner, conversation_id, lock=True)
        fingerprint = digest(body.model_dump(mode="json", exclude={"client_message_id"}))
        existing = await session.scalar(
            select(AssistantMessage).where(
                AssistantMessage.conversation_id == conversation_id,
                AssistantMessage.client_message_id == body.client_message_id,
            )
        )
        await self._recover(session, conversation_id)
        if existing:
            if existing.payload_hash != fingerprint:
                raise HTTPException(
                    409, "Message key already belongs to different content or context"
                )
            await session.commit()
            return existing, False
        busy = await session.scalar(
            select(func.count())
            .select_from(AssistantMessage)
            .where(
                AssistantMessage.conversation_id == conversation_id,
                AssistantMessage.status == "pending",
            )
        )
        if busy:
            raise HTTPException(409, "A reply is already in progress in this conversation")
        active = await session.scalar(
            select(func.count())
            .select_from(AssistantMessage)
            .where(
                AssistantMessage.owner_user_id == owner,
                AssistantMessage.status == "pending",
                AssistantMessage.deadline_at > utcnow(),
            )
        )
        if (active or 0) >= 2:
            raise HTTPException(429, "Please wait for your current replies to finish")
        context = await freeze_context(session, owner, body.context, conversation.language)
        context["language"] = conversation.language
        context["detail"] = conversation.detail
        context["kb_release_id"] = conversation.kb_release_id
        message = AssistantMessage(
            conversation_id=conversation_id,
            owner_user_id=owner,
            sequence=conversation.next_sequence,
            client_message_id=body.client_message_id,
            payload_hash=fingerprint,
            text=body.text,
            context_snapshot=context,
            deadline_at=utcnow() + timedelta(seconds=get_assistant_settings().deadline_seconds),
        )
        conversation.next_sequence += 1
        conversation.updated_at = utcnow()
        session.add(message)
        await session.commit()
        return message, True

    async def finish_message(
        self,
        session: AsyncSession,
        identifier: str,
        status: str,
        response: dict[str, Any] | None,
        error_code: str | None,
    ) -> bool:
        row = await session.get(
            AssistantMessage, identifier, with_for_update=True, populate_existing=True
        )
        if row is None or row.status != "pending":
            return False
        if row.deadline_at <= utcnow():
            row.status = "interrupted"
            row.error_code = "request_interrupted"
            row.completed_at = utcnow()
            await session.commit()
            return False
        row.status = status
        row.response = response
        row.error_code = error_code
        row.completed_at = utcnow()
        await session.commit()
        return True

    async def source(
        self,
        session: AsyncSession,
        owner: str,
        conversation_id: str,
        message_id: str,
        evidence_id: str,
    ) -> dict[str, Any]:
        await self._conversation(session, owner, conversation_id)
        message = await session.scalar(
            select(AssistantMessage).where(
                AssistantMessage.id == message_id,
                AssistantMessage.conversation_id == conversation_id,
                AssistantMessage.owner_user_id == owner,
            )
        )
        if message is None:
            raise HTTPException(404, "Message not found")
        evidence = message.evidence_snapshot or {}
        item = next(
            (
                k
                for k in evidence.get("knowledge", []) + message.context_snapshot["facts"]
                if k["id"] == evidence_id
            ),
            None,
        )
        if item is None:
            raise HTTPException(404, "Source not present in this message")
        return dict(item)


async def process_message(factory: async_sessionmaker[AsyncSession], identifier: str) -> None:
    service = AssistantService()
    evidence: dict[str, Any] | None = None
    context: dict[str, Any] = {}
    error = None
    response = None
    try:
        async with factory() as session:
            message = await session.get(AssistantMessage, identifier)
            if message is None or message.status != "pending":
                return
            context = message.context_snapshot
            seconds = (message.deadline_at - utcnow()).total_seconds()
            question = message.text
            older = (
                await session.scalars(
                    select(AssistantMessage)
                    .where(
                        AssistantMessage.conversation_id == message.conversation_id,
                        AssistantMessage.sequence < message.sequence,
                        AssistantMessage.status == "complete",
                    )
                    .order_by(AssistantMessage.sequence.desc())
                    .limit(get_assistant_settings().history_messages)
                )
            ).all()
            history = [
                {
                    "question": m.text[:500],
                    "answer": " ".join(p["text"] for p in (m.response or {}).get("paragraphs", []))[
                        :800
                    ],
                    "context_revision": str(m.context_snapshot["reference"]["revision"]),
                }
                for m in reversed(older)
            ]
        async with asyncio.timeout(max(0.01, seconds)):
            async with factory() as session:
                release = await session.get(KBRelease, context["kb_release_id"])
                if release is None or release.status != "published":
                    raise ValueError("Pinned knowledge release unavailable")
                evidence = await collect_evidence(session, question, context, release)
                current = await session.get(AssistantMessage, identifier, with_for_update=True)
                if current is None or current.status != "pending":
                    return
                current.evidence_snapshot = evidence
                await session.commit()
            response = await generate_answer(
                question,
                context,
                evidence,
                language=context["language"],
                detail=context["detail"],
                history=history,
            )
    except asyncio.CancelledError:
        # If the web worker exits, the persisted deadline makes this recoverable.
        raise
    except TimeoutError:
        error = "assistant_deadline_exceeded"
    except StructuredInvocationError:
        error = "model_unavailable"
    except ValueError:
        error = "answer_validation_failed"
    except Exception:
        error = "assistant_unavailable"
    if error:
        zh = context.get("language", "zh") == "zh"
        response = {
            "paragraphs": [
                {
                    "text": "这次回答暂时没能完成。已有数据仍保留在下方，你可以重试。"
                    if zh
                    else (
                        "This reply could not be completed. "
                        "The available facts are still shown below; you can retry."
                    ),
                    "evidence_ids": [],
                }
            ],
            "facts": context.get("facts", []),
            "citations": (evidence or {}).get("knowledge", []),
            "actions": [],
            "needs_clarification": False,
            "retrieval_mode": (evidence or {}).get("retrieval_mode", "unavailable"),
        }
    async with factory() as session:
        await service.finish_message(
            session, identifier, "failed" if error else "complete", response, error
        )
