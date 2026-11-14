"""Typed, allowlisted access to existing business-module HTTP operations."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlencode
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import ASGIApp

from .bot_scope import REMOTE_METRICS
from .models import AssistantAction
from .service import AssistantService

PREFIX_BY_DOMAIN = {
    "field_management": ("/field-shift",),
    "remote_sensing": ("/agri-data",),
    "rotation": ("/rotation-optimizer",),
    # Local agriculture has a knowledge retrieval path, but no operational API.
    "local_agriculture": (),
}


@dataclass(frozen=True)
class ModuleTool:
    operation_id: str
    title: str
    method: str
    path: str
    domain: str
    path_parameters: tuple[str, ...]
    query_parameters: tuple[str, ...]
    required_query_parameters: tuple[str, ...]
    body_schema: dict[str, Any] | None
    body_required: bool
    required_body_parameters: tuple[str, ...]

    def public_schema(self) -> dict[str, Any]:
        return {
            "operation_id": self.operation_id,
            "title": self.title,
            "method": self.method,
            "path": self.path,
            "path_parameters": list(self.path_parameters),
            "query_parameters": list(self.query_parameters),
            "required_query_parameters": list(self.required_query_parameters),
            "body": self.body_schema,
        }


@dataclass(frozen=True)
class ModuleToolResult:
    status_code: int
    data: Any
    content_type: str
    href: str | None

    @property
    def succeeded(self) -> bool:
        return 200 <= self.status_code < 300


class ModuleOperationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(min_length=1, max_length=120)
    path_params: dict[str, Any] = Field(default_factory=dict)
    query_params: dict[str, Any] = Field(default_factory=dict)
    body: Any = None
    idempotency_key: str = Field(min_length=8, max_length=80)


class ModuleOperationOutcome(BaseModel):
    status: str
    operation_id: str
    text: str
    missing_inputs: list[str] = Field(default_factory=list)
    status_code: int | None = None
    result: Any = None
    content_type: str | None = None
    href: str | None = None


def _audit_event(status: str) -> dict[str, str]:
    return {"at": datetime.now(UTC).isoformat(), "status": status}


class ModuleOperationService:
    """Expose module OpenAPI operations through an owner-bound, replay-safe journal."""

    async def history(
        self, session: AsyncSession, owner_user_id: str, conversation_id: str
    ) -> list[dict[str, Any]]:
        await AssistantService()._conversation(session, owner_user_id, conversation_id)
        rows = (
            await session.scalars(
                select(AssistantAction)
                .where(
                    AssistantAction.conversation_id == conversation_id,
                    AssistantAction.owner_user_id == owner_user_id,
                    AssistantAction.action == "module.operation",
                    AssistantAction.outcome.is_not(None),
                )
                .order_by(AssistantAction.updated_at.desc(), AssistantAction.id.desc())
                .limit(20)
            )
        ).all()
        return [
            {"idempotency_key": row.idempotency_key, "outcome": row.outcome}
            for row in rows
        ]

    async def catalog(
        self,
        session: AsyncSession,
        app: FastAPI | ASGIApp,
        owner_user_id: str,
        conversation_id: str,
    ) -> list[dict[str, Any]]:
        conversation = await AssistantService()._conversation(
            session, owner_user_id, conversation_id
        )
        if conversation.bot_id in REMOTE_METRICS and conversation.bot_id != "remote-water":
            return []
        executor = ModuleToolExecutor(app)
        return [
            {
                **tool.public_schema(),
                "required_inputs": executor.required_inputs(tool.operation_id, conversation.preset),
                "body_required": tool.body_required,
                "required_body_parameters": list(tool.required_body_parameters),
            }
            for tool in executor.tools_for(conversation.preset)
        ]

    async def execute(
        self,
        session: AsyncSession,
        app: FastAPI | ASGIApp,
        owner_user_id: str,
        conversation_id: str,
        request: ModuleOperationRequest,
        *,
        headers: dict[str, str],
        cookies: dict[str, str],
    ) -> ModuleOperationOutcome:
        conversation = await AssistantService()._conversation(
            session, owner_user_id, conversation_id, lock=True
        )
        if conversation.bot_id in REMOTE_METRICS and conversation.bot_id != "remote-water":
            raise HTTPException(422, "Use this specialist's scoped guided actions")
        executor = ModuleToolExecutor(app)
        try:
            tool = executor._tool(request.operation_id, conversation.preset)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        missing = executor.missing_inputs(
            tool.operation_id, conversation.preset,
            path_params=request.path_params,
            query_params=request.query_params,
            body=request.body,
        )
        if missing:
            text = (
                "请补充以下信息后继续："
                if conversation.language == "zh"
                else "Please provide these inputs to continue: "
            )
            return ModuleOperationOutcome(
                status="needs_input", operation_id=tool.operation_id,
                text=text + ", ".join(missing), missing_inputs=missing,
            )
        if set(request.path_params) != set(tool.path_parameters):
            raise HTTPException(422, "Path parameters do not match the selected operation")
        if request.query_params.keys() - set(tool.query_parameters):
            raise HTTPException(422, "Query parameters do not match the selected operation")
        if tool.body_schema is None and request.body is not None:
            raise HTTPException(422, "This operation does not accept a request body")

        payload = {
            "operation_id": tool.operation_id,
            "path_params": request.path_params,
            "query_params": request.query_params,
            "body": request.body,
        }
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
        ).hexdigest()
        # The action column is intentionally short; the operation ID is already
        # included in the canonical payload fingerprint and outcome.
        action_name = "module.operation"
        row = await session.scalar(
            select(AssistantAction)
            .where(
                AssistantAction.conversation_id == conversation_id,
                AssistantAction.owner_user_id == owner_user_id,
                AssistantAction.idempotency_key == request.idempotency_key,
            )
            .with_for_update()
        )
        if row is not None:
            if row.action != action_name or row.payload_hash != fingerprint:
                raise HTTPException(
                    409, "Idempotency key already belongs to different operation inputs"
                )
            if row.outcome is not None and row.status in {"succeeded", "failed"}:
                return ModuleOperationOutcome.model_validate(row.outcome)
            raise HTTPException(
                409, "The operation outcome is still being resolved; check it before retrying"
            )

        row = AssistantAction(
            id=str(uuid4()), conversation_id=conversation_id, owner_user_id=owner_user_id,
            idempotency_key=request.idempotency_key, action=action_name,
            payload_hash=fingerprint, arguments=payload, status="pending", outcome=None,
            audit_events=[_audit_event("started")],
        )
        session.add(row)
        await session.commit()
        try:
            result = await executor.execute(
                operation_id=tool.operation_id, domain=conversation.preset,
                path_params=request.path_params, query_params=request.query_params,
                body=request.body, headers=headers, cookies=cookies,
            )
        except Exception:
            outcome = ModuleOperationOutcome(
                status="failed", operation_id=tool.operation_id,
                text=(
                    "操作未能确认完成，请先检查目标模块状态再重试。"
                    if conversation.language == "zh"
                    else "The operation outcome could not be confirmed. "
                    "Check the module state before retrying."
                ),
                status_code=502,
            )
            row.status = "failed"
            row.outcome = outcome.model_dump(mode="json")
            row.audit_events = [*row.audit_events, _audit_event("outcome_unknown")]
            row.updated_at = datetime.now(UTC)
            await session.commit()
            return outcome
        accepted = result.status_code == 202
        succeeded = result.succeeded and not accepted
        empty_list = (
            succeeded and isinstance(result.data, dict)
            and isinstance(result.data.get("items"), list)
            and not result.data["items"]
        )
        created_field = succeeded and tool.operation_id.startswith("create_field_")
        if conversation.language == "zh":
            text = (
                "任务已开始处理。打开进度页面查看最新状态。" if accepted else
                "当前账户还没有相关记录。打开模块可查看现状。" if empty_list else
                "地块已保存。打开页面核对位置、面积和种植记录。" if created_field else
                "结果已准备好。打开页面核对地块、观测或规划结果。" if succeeded else
                "这项操作未能完成，请核对输入或稍后重试。"
            )
        else:
            text = (
                "Your task is underway. Open its progress page for the latest status."
                if accepted else
                "No records are available for this account yet. "
                "Open the module to review its current state."
                if empty_list else
                "Your field is saved. Open it to review its location, area, and planting history."
                if created_field else
                "Your result is ready. Open it to review the field, observation, or plan."
                if succeeded else
                "This task could not be completed. Check the inputs or try again later."
            )
        outcome = ModuleOperationOutcome(
            status="pending" if accepted else "succeeded" if succeeded else "failed",
            operation_id=tool.operation_id,
            text=text, status_code=result.status_code, result=result.data,
            content_type=result.content_type, href=result.href,
        )
        # A 202 response has been delivered once, while the business job remains pending.
        row.status = "succeeded" if accepted else outcome.status
        row.outcome = outcome.model_dump(mode="json")
        row.audit_events = [*row.audit_events, _audit_event(outcome.status)]
        row.updated_at = datetime.now(UTC)
        await session.commit()
        return outcome


class ModuleToolExecutor:
    """Invoke only existing module routes, keeping the caller's auth boundary."""

    def __init__(self, app: FastAPI | ASGIApp) -> None:
        self.app = app
        self._tools: dict[str, ModuleTool] = {}
        if not isinstance(app, FastAPI):
            return
        openapi = app.openapi()
        components = openapi.get("components", {}).get("schemas", {})
        for path, methods in openapi.get("paths", {}).items():
            domain = self._domain_for(path)
            if domain is None:
                continue
            for method, operation in methods.items():
                operation_id = operation.get("operationId")
                if not operation_id or operation_id in self._tools:
                    raise ValueError(f"Module operation IDs must be unique: {operation_id}")
                params = operation.get("parameters", [])
                path_parameters = tuple(
                    parameter["name"] for parameter in params if parameter.get("in") == "path"
                )
                query_parameters = tuple(
                    parameter["name"] for parameter in params if parameter.get("in") == "query"
                )
                required_query_parameters = tuple(
                    parameter["name"]
                    for parameter in params
                    if parameter.get("in") == "query" and parameter.get("required")
                )
                body = operation.get("requestBody") or {}
                body_required = bool(body.get("required"))
                content = body.get("content") or {}
                body_schema = content.get("application/json", {}).get("schema")
                if body_schema and "$ref" in body_schema:
                    schema_name = body_schema["$ref"].rsplit("/", 1)[-1]
                    body_schema = components.get(schema_name, body_schema)
                self._tools[operation_id] = ModuleTool(
                    operation_id=operation_id,
                    title=operation.get("summary") or operation_id.replace("_", " ").title(),
                    method=method.upper(),
                    path=path,
                    domain=domain,
                    path_parameters=path_parameters,
                    query_parameters=query_parameters,
                    required_query_parameters=required_query_parameters,
                    body_schema=body_schema,
                    body_required=body_required,
                    required_body_parameters=tuple((body_schema or {}).get("required", [])),
                )

    @staticmethod
    def _domain_for(path: str) -> str | None:
        for domain, prefixes in PREFIX_BY_DOMAIN.items():
            if any(path == prefix or path.startswith(prefix + "/") for prefix in prefixes):
                return domain
        return None

    def tools_for(self, domain: str) -> list[ModuleTool]:
        if domain not in PREFIX_BY_DOMAIN:
            return []
        return sorted(
            (tool for tool in self._tools.values() if tool.domain == domain),
            key=lambda item: (item.path, item.method),
        )

    def required_inputs(self, operation_id: str, domain: str) -> list[str]:
        tool = self._tool(operation_id, domain)
        required = [*tool.path_parameters, *tool.required_query_parameters]
        required.extend(f"body.{name}" for name in tool.required_body_parameters)
        if tool.body_required and not tool.required_body_parameters:
            required.append("body")
        return required

    def missing_inputs(
        self,
        operation_id: str,
        domain: str,
        *,
        path_params: dict[str, Any],
        query_params: dict[str, Any],
        body: Any,
    ) -> list[str]:
        tool = self._tool(operation_id, domain)
        missing = [
            name for name in tool.path_parameters
            if path_params.get(name) in (None, "")
        ]
        missing.extend(
            name for name in tool.required_query_parameters
            if query_params.get(name) in (None, "")
        )
        if tool.body_required and body is None:
            missing.append("body")
        elif isinstance(body, dict):
            missing.extend(
                f"body.{name}" for name in tool.required_body_parameters
                if body.get(name) in (None, "")
            )
        elif tool.required_body_parameters:
            missing.extend(f"body.{name}" for name in tool.required_body_parameters)
        return missing

    def _tool(self, operation_id: str, domain: str) -> ModuleTool:
        tool = self._tools.get(operation_id)
        if tool is None or tool.domain != domain:
            raise ValueError("Operation is not available for this assistant")
        return tool

    async def execute(
        self,
        *,
        operation_id: str,
        domain: str,
        path_params: dict[str, Any],
        query_params: dict[str, Any],
        body: Any,
        headers: dict[str, str],
        cookies: dict[str, str],
    ) -> ModuleToolResult:
        tool = self._tool(operation_id, domain)
        missing = set(tool.path_parameters) - path_params.keys()
        if missing:
            raise ValueError("Missing path parameters: " + ", ".join(sorted(missing)))
        extra_path = path_params.keys() - set(tool.path_parameters)
        if extra_path:
            raise ValueError("Unexpected path parameters: " + ", ".join(sorted(extra_path)))
        extra_query = query_params.keys() - set(tool.query_parameters)
        if extra_query:
            raise ValueError("Unexpected query parameters: " + ", ".join(sorted(extra_query)))
        if tool.body_schema is None and body is not None:
            raise ValueError("This operation does not accept a request body")
        if tool.body_required and body is None:
            raise ValueError("This operation requires a request body")
        missing_inputs = self.missing_inputs(
            operation_id, domain,
            path_params=path_params, query_params=query_params, body=body,
        )
        if missing_inputs:
            raise ValueError("Missing required inputs: " + ", ".join(missing_inputs))

        path = tool.path
        for name in tool.path_parameters:
            path = path.replace("{" + name + "}", quote(str(path_params[name]), safe=""))
        query = urlencode(query_params, doseq=True)
        target = path + ("?" + query if query else "")
        forwarded = {
            key: value
            for key, value in headers.items()
            if key.casefold() not in {"host", "content-length", "transfer-encoding", "cookie"}
        }
        if cookies:
            forwarded["cookie"] = "; ".join(f"{name}={value}" for name, value in cookies.items())
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, raise_app_exceptions=False),
            base_url="http://sideronostos.internal",
            follow_redirects=False,
        ) as client:
            response = await client.request(tool.method, target, json=body, headers=forwarded)
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            try:
                data: Any = response.json()
            except ValueError:
                data = None
        elif content_type.startswith("text/") or "csv" in content_type:
            data = response.text
        else:
            data = None
        href = self._result_href(tool, path_params, data) if response.is_success else None
        return ModuleToolResult(response.status_code, data, content_type, href)

    @staticmethod
    def _result_href(tool: ModuleTool, path_params: dict[str, Any], data: Any) -> str:
        result = data if isinstance(data, dict) else {}
        identifier = result.get("id") or path_params.get("field_id") or path_params.get("run_id")
        if tool.domain == "field_management":
            query = f"?field={quote(str(identifier), safe='')}&step=field" if identifier else ""
            return "/field-shift" + query
        if tool.domain == "remote_sensing":
            if "selection_id" in path_params or "selection" in tool.path:
                value = path_params.get("selection_id") or identifier
                query = f"?selection={quote(str(value), safe='')}" if value else ""
                return "/field-shift/map" + query
            layer_id = path_params.get("layer_id") or result.get("id")
            query = f"?layer={quote(str(layer_id), safe='')}" if layer_id else ""
            return "/field-shift/map" + query
        if tool.domain == "rotation":
            if "/plans" in tool.path:
                query = f"?plan={quote(str(identifier), safe='')}" if identifier else ""
                return "/field-shift/rotation" + query
            query = f"?run={quote(str(identifier), safe='')}" if identifier else ""
            return "/field-shift/rotation" + query
        return "/si/local-knowledge"
