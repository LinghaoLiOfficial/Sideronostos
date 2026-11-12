from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from .models import AssistantMessage
from .presets import enabled_presets
from .schemas import ConversationCreate, MessageCreate, PreferenceInput
from .service import AssistantService, message_view, process_message

router = APIRouter(prefix="/farm-assistant", tags=["farm-assistant"])
User = Annotated[AuthPrincipal, Depends(require_verified_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/presets")
async def presets(user: User) -> dict[str, Any]:
    return {"items": enabled_presets()}


@router.get("/preferences")
async def preferences(user: User, session: Session) -> dict[str, str]:
    return await AssistantService().preferences(session, user.id)


@router.put("/preferences")
async def update_preferences(body: PreferenceInput, user: User, session: Session) -> dict[str, str]:
    return await AssistantService().set_preferences(session, user.id, body)


@router.post("/conversations", status_code=201)
async def create(body: ConversationCreate, user: User, session: Session) -> dict[str, Any]:
    return await AssistantService().create_conversation(session, user.id, body)


@router.get("/conversations")
async def conversations(user: User, session: Session) -> dict[str, Any]:
    return {"items": await AssistantService().list_conversations(session, user.id)}


@router.get("/conversations/{conversation_id}")
async def conversation(
    conversation_id: str,
    user: User,
    session: Session,
    before_sequence: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    return await AssistantService().get_conversation(
        session, user.id, conversation_id, before_sequence=before_sequence
    )


@router.put("/conversations/{conversation_id}/preferences")
async def conversation_preferences(
    conversation_id: str, body: PreferenceInput, user: User, session: Session
) -> dict[str, str]:
    return await AssistantService().set_preferences(session, user.id, body, conversation_id)


@router.post("/conversations/{conversation_id}/messages")
async def send(
    conversation_id: str,
    body: MessageCreate,
    user: User,
    session: Session,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    message, work = await AssistantService().start_message(session, user.id, conversation_id, body)
    if work:
        await process_message(request.app.state.session_factory, message.id)
        await session.refresh(message)
    response.status_code = 202 if message.status == "pending" else 200
    return message_view(message)


@router.get("/conversations/{conversation_id}/messages/{message_id}")
async def message(
    conversation_id: str, message_id: str, user: User, session: Session
) -> dict[str, Any]:
    await AssistantService().get_conversation(session, user.id, conversation_id)
    row = await session.scalar(
        select(AssistantMessage).where(
            AssistantMessage.id == message_id,
            AssistantMessage.conversation_id == conversation_id,
            AssistantMessage.owner_user_id == user.id,
        )
    )
    if row is None:
        raise HTTPException(404, "Message not found")
    return message_view(row)


@router.get("/conversations/{conversation_id}/messages/{message_id}/sources/{evidence_id}")
async def source(
    conversation_id: str, message_id: str, evidence_id: str, user: User, session: Session
) -> dict[str, Any]:
    return await AssistantService().source(
        session, user.id, conversation_id, message_id, evidence_id
    )
