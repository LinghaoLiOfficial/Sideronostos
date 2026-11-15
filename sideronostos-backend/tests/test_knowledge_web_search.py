import httpx
import pytest

from sideronostos_backend.modules.knowledge.web_search import PRESETS, search_web


@pytest.mark.asyncio
async def test_each_bot_preset_searches_only_its_reviewed_domains_and_returns_links():
    requested_urls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        assert request.url.host == "html.duckduckgo.com"
        assert "site:" in request.url.params["q"]
        assert "example.com" not in request.url.params["q"]
        assert "42.1234" not in request.url.params["q"]
        domain = request.url.params["q"].split("site:", 1)[1].split()[0]
        return httpx.Response(
            200,
            text=(
                '<div class="result">'
                f'<a class="result__a" href="https://www.{domain}/soil/water">Domain result</a>'
                '<a class="result__snippet">Guidance is background information.</a>'
                "</div>"
            ),
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        for preset in PRESETS:
            hits = await search_web(
                preset,
                "soil water for farmer@example.com at 42.1234, -93.1234",
                client=client,
            )
            assert hits[0]["source"]["title"] == "Domain result"
            assert hits[0]["source"]["url"].endswith("/soil/water")
            assert preset in hits[0]["preset"]
        assert len(requested_urls) == len(PRESETS)
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_search_discards_results_outside_preset_allowlist():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text="""<a class="result__a" href="https://evil.example/claim">wrong</a>
                     <a class="result__snippet">Not trusted.</a>""",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await search_web("rotation", "crop rotation", client=client) == []


@pytest.mark.asyncio
async def test_network_failures_are_safe_and_non_fatal():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await search_web("field_management", "field", client=client)
    assert result == []
