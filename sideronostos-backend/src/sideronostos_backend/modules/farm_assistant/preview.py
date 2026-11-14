"""Capture only confirmed, owned result pages with a short-lived browser context."""

from __future__ import annotations

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
    if (
        set(query) != {"field", "step"}
        or query["step"] != ["field"]
        or len(query["field"]) != 1
    ):
        raise ValueError("Preview target is not a field result")
    UUID(query["field"][0])
    return href


async def capture_result_page(href: str, authorization: str | None) -> bytes:
    """Use the caller's access token in memory only, for the configured API origin."""
    from playwright.async_api import Route, async_playwright

    settings = get_assistant_settings()
    path = field_result_path(href)
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
            image = await page.screenshot(full_page=True, type="png")
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
        or flow.action != "chat.field.create"
        or flow.status != "completed"
    ):
        raise HTTPException(404, "Result preview not found")
    outcome = flow.outcome or {}
    href = outcome.get("href")
    if not isinstance(href, str):
        raise HTTPException(404, "Result preview not found")
    try:
        field_result_path(href)
    except (ValueError, KeyError, IndexError) as error:
        raise HTTPException(404, "Result preview not found") from error
    existing = await session.get(AssistantPreview, workflow_id)
    if existing is not None:
        return existing.png
    try:
        png = await capture_result_page(href, authorization)
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
