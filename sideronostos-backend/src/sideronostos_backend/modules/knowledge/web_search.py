"""Bounded, query-time web search presets for module specialists.

Search results are never persisted as approved agronomy claims. They are snapshots
with their original URLs and must be cited as external background by the assistant.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlsplit

import httpx

PRESETS: dict[str, tuple[str, ...]] = {
    "field_management": ("fao.org", "extension.umn.edu", "extension.psu.edu"),
    "remote_sensing": ("earthdata.nasa.gov", "nasa.gov", "power.larc.nasa.gov"),
    "local_agriculture": ("fao.org", "extension.umn.edu", "extension.psu.edu"),
    "rotation": ("fao.org", "sare.org", "extension.umn.edu", "extension.psu.edu"),
}


class _Results(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.titles: list[dict[str, str]] = []
        self.snippets: list[str] = []
        self._capture: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if tag == "a" and "result__a" in classes:
            self._finish()
            self._capture = "title"
            self._parts = []
            self.titles.append({"url": values.get("href") or "", "title": ""})
        elif "result__snippet" in classes:
            self._finish()
            self._capture = "snippet"
            self._parts = []

    def handle_endtag(self, tag: str) -> None:
        if self._capture == "title" and tag == "a":
            self._finish()
        elif self._capture == "snippet" and tag in {"a", "div", "td"}:
            self._finish()

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._parts.append(data)

    def _finish(self) -> None:
        if not self._capture:
            return
        value = " ".join(" ".join(self._parts).split())[:800]
        if self._capture == "title" and self.titles:
            self.titles[-1]["title"] = value[:240]
        elif self._capture == "snippet" and value:
            self.snippets.append(value)
        self._capture = None
        self._parts = []

    def close(self) -> None:
        super().close()
        self._finish()


def _allowed(url: str, domains: tuple[str, ...]) -> bool:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    return parsed.scheme == "https" and any(host == d or host.endswith("." + d) for d in domains)


def _public_query(query: str) -> str:
    """Strip direct identifiers and precise location details before external search."""
    value = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", " ", query)
    value = re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b\d{4}-\d{2}-\d{2}\b", " ", value, flags=re.I)
    value = re.sub(r"(?<!\d)[+-]?\d{1,3}\.\d{3,}\s*[,/ ]\s*[+-]?\d{1,3}\.\d{3,}(?!\d)", " ", value)
    value = re.sub(r"(?<!\d)(?:\+?\d[\s().-]?){9,15}(?!\d)", " ", value)
    value = re.sub(r"https?://\S+", " ", value, flags=re.I)
    return " ".join(value.split())[:240]


async def search_web(
    preset: str,
    query: str,
    *,
    client: httpx.AsyncClient | None = None,
    limit: int = 4,
) -> list[dict[str, Any]]:
    """Search public web snippets with a domain preset; failures degrade to no hits."""
    domains = PRESETS.get(preset)
    clean_query = _public_query(query)
    if not domains or not clean_query or not 1 <= limit <= 8:
        return []
    scoped_query = f"{clean_query} " + " OR ".join(f"site:{domain}" for domain in domains)
    owned_client = client is None
    session = client or httpx.AsyncClient(
        timeout=httpx.Timeout(3.0, connect=1.0),
        follow_redirects=False,
        headers={"User-Agent": "SideronostosKnowledgeSearch/1.0"},
    )
    try:
        response = await session.get(
            "https://html.duckduckgo.com/html/", params={"q": scoped_query, "kl": "wt-wt"}
        )
        response.raise_for_status()
        parser = _Results()
        parser.feed(response.text)
        parser.close()
        hits: list[dict[str, Any]] = []
        for i, item in enumerate(parser.titles):
            if not item["title"] or not _allowed(item["url"], domains):
                continue
            hits.append(
                {
                    "id": f"WEB{i + 1}",
                    "preset": preset,
                    "source": {
                        "id": f"web-{preset}-{i + 1}",
                        "title": item["title"],
                        "url": item["url"],
                        "access_scope": "web_snapshot",
                        "locator_type": "section",
                        "regions": ["external"],
                        "limitations": ["External search snippet; verify the linked source."],
                        "sha256": "",
                    },
                    "page": 1,
                    "excerpt": parser.snippets[i] if i < len(parser.snippets) else "",
                    "claims": [],
                    "retrieval_mode": "web_search",
                }
            )
            if len(hits) >= limit:
                break
        return hits
    except (httpx.HTTPError, ValueError):
        return []
    finally:
        if owned_client:
            await session.aclose()
