"""Capture only confirmed, owned result pages with a short-lived browser context."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AssistantAction, AssistantPreview
from .settings import get_assistant_settings


def field_result_path(href: str) -> str:
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or parsed.fragment or parsed.path != "/field-shift":
        raise ValueError("Preview target is not an internal field result")
    query = parse_qs(parsed.query, strict_parsing=True)
    if set(query) != {"field", "step"} or query["step"] != ["field"] or len(query["field"]) != 1:
        raise ValueError("Preview target is not a field result")
    UUID(query["field"][0])
    return href


def generic_result_path(conversation_id: str, workflow_id: str) -> str:
    UUID(conversation_id)
    UUID(workflow_id)
    return f"/si/multi-agent/results/{workflow_id}?conversation={conversation_id}"


def rotation_result_path(href: str) -> str:
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or parsed.fragment or parsed.path != "/field-shift/rotation":
        raise ValueError("Preview target is not an internal rotation result")
    query = parse_qs(parsed.query, strict_parsing=True)
    if set(query) not in ({"run"}, {"plan"}, {"run", "option"}):
        raise ValueError("Preview target is not a single rotation result")
    identifier = query.get("run") or query.get("plan") or []
    if len(identifier) != 1:
        raise ValueError("Preview target is not a single rotation result")
    UUID(identifier[0])
    if "option" in query and (
        len(query["option"]) != 1
        or re.fullmatch(r"[A-Za-z0-9_-]{1,80}", query["option"][0]) is None
    ):
        raise ValueError("Preview target has an invalid rotation option")
    return href


def _capture_path(href: str) -> str:
    if href.startswith("/field-shift?"):
        return field_result_path(href)
    if href.startswith("/field-shift/rotation?"):
        return rotation_result_path(href)
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or parsed.fragment:
        raise ValueError("Preview target must be an internal result page")
    match = re.fullmatch(r"/si/multi-agent/results/([0-9a-f-]{36})", parsed.path)
    query = parse_qs(parsed.query, strict_parsing=True)
    if match is None or set(query) != {"conversation"} or len(query["conversation"]) != 1:
        raise ValueError("Preview target must be a result page")
    UUID(match.group(1))
    UUID(query["conversation"][0])
    return href


async def capture_result_page(href: str, authorization: str | None) -> bytes:
    """Use the caller's access token in memory only, for the configured API origin."""
    from playwright.async_api import Route, async_playwright

    settings = get_assistant_settings()
    path = _capture_path(href)
    if authorization is not None and not authorization.startswith("Bearer "):
        raise ValueError("Invalid access token for result capture")
    app_origin = settings.result_frontend_origin.rstrip("/")
    api_origin = settings.result_api_origin.rstrip("/")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True, channel=settings.result_browser_channel
        )
        try:
            page = await browser.new_page(
                viewport={"width": 1440, "height": 900}, device_scale_factor=1
            )

            async def route_request(route: Route) -> None:
                url = route.request.url
                origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
                if origin == api_origin:
                    headers = dict(route.request.headers)
                    if authorization:
                        headers["authorization"] = authorization
                    await route.continue_(headers=headers)
                elif origin == app_origin:
                    await route.continue_()
                else:
                    await route.abort()

            await page.route("**/*", route_request)
            await page.goto(app_origin + path, wait_until="domcontentloaded", timeout=20_000)
            await page.locator('[data-testid="result-ready"]').wait_for(timeout=20_000)
            image = (
                await page.locator('[data-testid="result-ready"]').screenshot(type="png")
                if path.startswith(("/si/multi-agent/results/", "/field-shift/rotation?"))
                else await page.screenshot(full_page=True, type="png")
            )
            if len(image) > 4 * 1024 * 1024:
                raise ValueError("Result screenshot is too large")
            return image
        finally:
            await browser.close()


async def owned_preview(
    session: AsyncSession,
    owner: str,
    conversation_id: str,
    workflow_id: str,
    authorization: str | None,
) -> bytes:
    flow = await session.get(AssistantAction, workflow_id)
    if (
        flow is None
        or flow.owner_user_id != owner
        or flow.conversation_id != conversation_id
        or flow.action not in {"chat.field.create", "chat.module.operation"}
        or flow.status != "completed"
    ):
        raise HTTPException(404, "Result preview not found")
    outcome = flow.outcome or {}
    href = outcome.get("href")
    if flow.action == "chat.field.create":
        if not isinstance(href, str):
            raise HTTPException(404, "Result preview not found")
        try:
            target = field_result_path(href)
        except (ValueError, KeyError, IndexError) as error:
            raise HTTPException(404, "Result preview not found") from error
    else:
        tool_id = flow.arguments.get("operation_id", "")
        if (
            isinstance(href, str)
            and href.startswith("/field-shift?field=")
            and tool_id.startswith(("create_field_", "get_field_", "update_field_"))
        ):
            try:
                target = field_result_path(href)
            except (ValueError, KeyError, IndexError) as error:
                raise HTTPException(404, "Result preview not found") from error
        elif (
            isinstance(href, str)
            and href.startswith("/field-shift/rotation?")
            and tool_id.startswith((
                "create_rotation_optimizer_runs_post",
                "create_daily_rotation_optimizer_v3_runs_post",
                "get_rotation_optimizer_runs__",
                "cancel_rotation_optimizer_runs__",
                "retry_rotation_optimizer_runs__",
                "export_rotation_optimizer_runs__",
                "export_csv_rotation_optimizer_runs__",
                "save_rotation_optimizer_plans_post",
                "plan_rotation_optimizer_plans__",
            ))
        ):
            try:
                target = rotation_result_path(href)
            except ValueError as error:
                raise HTTPException(404, "Result preview not found") from error
        else:
            target = generic_result_path(conversation_id, workflow_id)
    existing = await session.get(AssistantPreview, workflow_id)
    if existing is not None:
        return existing.png
    try:
        png = await capture_result_page(target, authorization)
    except Exception as error:
        raise HTTPException(
            503, "Result is saved, but its preview is temporarily unavailable"
        ) from error
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > 4 * 1024 * 1024:
        raise HTTPException(503, "Result preview is invalid")
    session.add(
        AssistantPreview(
            workflow_id=workflow_id,
            conversation_id=conversation_id,
            owner_user_id=owner,
            png=png,
        )
    )
    await session.commit()
    return png


async def owned_result(
    session: AsyncSession, owner: str, conversation_id: str, workflow_id: str
) -> dict[str, object]:
    flow = await session.get(AssistantAction, workflow_id)
    if (
        flow is None
        or flow.owner_user_id != owner
        or flow.conversation_id != conversation_id
        or flow.action != "chat.module.operation"
        or flow.status not in {"completed", "pending", "failed"}
        or flow.outcome is None
    ):
        raise HTTPException(404, "Result not found")
    return {
        "id": flow.id,
        "operation_id": flow.arguments["operation_id"],
        "title": flow.arguments.get("title", flow.arguments["operation_id"]),
        "status": flow.status,
        "href": flow.outcome.get("href"),
        "content_type": flow.outcome.get("content_type"),
        "result": flow.outcome.get("result"),
    }
