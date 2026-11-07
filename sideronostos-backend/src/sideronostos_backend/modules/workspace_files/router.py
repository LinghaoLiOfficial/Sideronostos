from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.audit import record_audit
from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from ..rbac.models import Organization
from ..rbac.service import AuthorizationError, RoleService
from ..users.models import User
from .models import WorkspaceFile
from .vocabulary import valid_vocabulary_document

router = APIRouter(prefix="/organizations/{organization_id}/workspace-files", tags=["workspace-files"])


class FileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(pattern="^(mindmap|markdown|gantt|vocabulary)$")


class FilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    content: dict[str, Any] | None = None


def _default_mindmap(name: str) -> dict[str, Any]:
    return {"version": 2, "tree": {"rootId": "root", "nodes": {"root": {"id": "root", "parentId": None, "children": [], "kind": "text", "text": name, "collapsed": False}}}}


def _valid_gantt_snapshot(content: dict[str, Any]) -> bool:
    return isinstance(content.get("taskData"), list) and isinstance(content.get("edgeData"), list)


def _valid_file_content(file_type: str, content: dict[str, Any]) -> bool:
    if file_type == "mindmap":
        return content.get("version") == 2 and isinstance(content.get("tree"), dict)
    if file_type == "gantt":
        return _valid_gantt_snapshot(content)
    if file_type == "vocabulary":
        return valid_vocabulary_document(content)
    return False


async def _permission(session: AsyncSession, user: AuthPrincipal, organization_id: str, permission: str) -> None:
    try:
        await RoleService().require(session, user.id, organization_id, permission)
    except AuthorizationError as error:
        raise HTTPException(status_code=403, detail="Permission denied") from error


async def _file(session: AsyncSession, user: AuthPrincipal, organization_id: str, file_id: str, permission: str) -> WorkspaceFile:
    await _permission(session, user, organization_id, permission)
    item = await session.scalar(select(WorkspaceFile).where(WorkspaceFile.id == file_id, WorkspaceFile.organization_id == organization_id, WorkspaceFile.deleted_at.is_(None)))
    if item is None:
        raise HTTPException(status_code=404, detail="File not found")
    return item


def _metadata(item: WorkspaceFile, include_content: bool = False, creator_display_name: str | None = None) -> dict[str, Any]:
    result = {"id": item.id, "name": item.name, "type": item.file_type, "created_at": item.created_at, "updated_at": item.updated_at}
    if creator_display_name is not None:
        result["creator_display_name"] = creator_display_name
    if include_content:
        result["content"] = item.content
    return result


async def _organization_kind(session: AsyncSession, organization_id: str) -> str | None:
    from ..rbac.models import Organization

    return await session.scalar(select(Organization.kind).where(Organization.id == organization_id))


async def _latest_group_gantt(session: AsyncSession, organization_id: str) -> WorkspaceFile | None:
    return await session.scalar(
        select(WorkspaceFile)
        .where(
            WorkspaceFile.organization_id == organization_id,
            WorkspaceFile.file_type == "gantt",
            WorkspaceFile.deleted_at.is_(None),
        )
        .order_by(WorkspaceFile.updated_at.desc(), WorkspaceFile.created_at.desc(), WorkspaceFile.id.desc())
        .limit(1)
    )


async def _lock_group(session: AsyncSession, organization_id: str) -> None:
    await session.scalar(select(Organization.id).where(Organization.id == organization_id, Organization.kind == "group").with_for_update())


@router.get("")
async def list_files(organization_id: str, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)], page: int = Query(1, ge=1), page_size: int = Query(12, ge=1, le=100), query: str = Query("", max_length=255), type: str | None = Query(None, pattern="^(mindmap|markdown|gantt|vocabulary)$")) -> dict[str, Any]:
    await _permission(session, user, organization_id, "workspace_files:read")
    is_group = await _organization_kind(session, organization_id) == "group"
    conditions = [WorkspaceFile.organization_id == organization_id, WorkspaceFile.deleted_at.is_(None)]
    if is_group:
        conditions.append(WorkspaceFile.file_type != "gantt")
    if query:
        conditions.append(WorkspaceFile.name.ilike(f"%{query}%"))
    if type:
        conditions.append(WorkspaceFile.file_type == type)
    total = int(await session.scalar(select(func.count()).select_from(WorkspaceFile).where(*conditions)) or 0)
    if is_group:
        rows = (await session.execute(
            select(WorkspaceFile, User.display_name)
            .outerjoin(User, User.id == WorkspaceFile.created_by)
            .where(*conditions)
            .order_by(WorkspaceFile.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )).all()
        items = [_metadata(item, creator_display_name=display_name or "未知用户") for item, display_name in rows]
    else:
        files = (await session.scalars(select(WorkspaceFile).where(*conditions).order_by(WorkspaceFile.updated_at.desc()).offset((page - 1) * page_size).limit(page_size))).all()
        items = [_metadata(item) for item in files]
    return {"items": items, "page": page, "page_size": page_size, "total": total, "total_pages": max(1, (total + page_size - 1) // page_size)}


@router.post("", status_code=201)
async def create_file(organization_id: str, body: FileCreate, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any]:
    await _permission(session, user, organization_id, "workspace_files:write")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="File name is required")
    if body.type == "gantt" and await _organization_kind(session, organization_id) == "group":
        await _lock_group(session, organization_id)
        existing = await _latest_group_gantt(session, organization_id)
        if existing is not None:
            return _metadata(existing, True)
    content: dict[str, Any] | None = None
    if body.type == "mindmap":
        content = _default_mindmap(name)
    elif body.type == "gantt":
        content = {"taskData": [], "edgeData": []}
    elif body.type == "vocabulary":
        content = {"version": 1, "entries": []}
    item = WorkspaceFile(
        organization_id=organization_id, created_by=user.id,
        name=name, file_type=body.type, content=content,
    )
    session.add(item)
    await record_audit(session, "workspace_file.create", resource_type="workspace_file", resource_id=item.id, details={"name": item.name, "type": item.file_type})
    await session.commit()
    await session.refresh(item)
    return _metadata(item, True)


@router.get("/task-planning")
async def get_task_planning(organization_id: str, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any] | None:
    await _permission(session, user, organization_id, "workspace_files:read")
    if await _organization_kind(session, organization_id) != "group":
        raise HTTPException(status_code=400, detail="Task planning is only available for groups")
    await _lock_group(session, organization_id)
    item = await _latest_group_gantt(session, organization_id)
    return _metadata(item, True) if item is not None else None


@router.post("/task-planning", status_code=200)
async def ensure_task_planning(organization_id: str, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any]:
    await _permission(session, user, organization_id, "workspace_files:write")
    if await _organization_kind(session, organization_id) != "group":
        raise HTTPException(status_code=400, detail="Task planning is only available for groups")
    existing = await _latest_group_gantt(session, organization_id)
    if existing is not None:
        return _metadata(existing, True)
    item = WorkspaceFile(organization_id=organization_id, created_by=user.id, name="任务规划", file_type="gantt", content={"taskData": [], "edgeData": []})
    session.add(item)
    await record_audit(session, "workspace_file.create", resource_type="workspace_file", resource_id=item.id, details={"name": item.name, "type": item.file_type})
    await session.commit()
    await session.refresh(item)
    return _metadata(item, True)


@router.get("/{file_id}")
async def get_file(organization_id: str, file_id: str, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any]:
    return _metadata(await _file(session, user, organization_id, file_id, "workspace_files:read"), True)


@router.patch("/{file_id}")
async def update_file(organization_id: str, file_id: str, body: FilePatch, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any]:
    item = await _file(session, user, organization_id, file_id, "workspace_files:write")
    if body.name is not None:
        item.name = body.name.strip()
        if not item.name:
            raise HTTPException(status_code=422, detail="File name is required")
    if body.content is not None:
        if not _valid_file_content(item.file_type, body.content):
            detail = {
                "vocabulary": "Invalid vocabulary document",
                "mindmap": "Invalid mindmap document",
                "gantt": "Invalid gantt snapshot",
            }.get(item.file_type, "Markdown editing is not supported")
            raise HTTPException(status_code=422, detail=detail)
        item.content = body.content
    item.updated_at = datetime.now(UTC)
    await record_audit(session, "workspace_file.update", resource_type="workspace_file", resource_id=item.id)
    await session.commit()
    await session.refresh(item)
    return _metadata(item, True)


@router.delete("/{file_id}", status_code=204)
async def delete_file(organization_id: str, file_id: str, user: Annotated[AuthPrincipal, Depends(require_verified_user)], session: Annotated[AsyncSession, Depends(get_session)]) -> None:
    item = await _file(session, user, organization_id, file_id, "workspace_files:delete")
    item.deleted_at = datetime.now(UTC)
    await record_audit(session, "workspace_file.delete", resource_type="workspace_file", resource_id=item.id)
    await session.commit()
