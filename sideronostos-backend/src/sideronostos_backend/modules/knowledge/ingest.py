"""Pure ingestion steps. Original files are never changed; hashes fail closed."""

import hashlib
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pymupdf

from .schemas import ChunkSpec, ClaimSpec, SourceSpec

CHUNK_RECIPE = "native-pages-control-glyph-marked-char1200-v4"


def canonical_key(source: SourceSpec) -> str:
    if source.doi:
        doi = source.doi.strip().casefold()
        doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi)
        return "doi:" + doi.removeprefix("doi:").strip()
    parsed = urlsplit(str(source.url))
    query = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if not k.casefold().startswith("utm_") and k.casefold() not in ("fbclid", "gclid")
    ]
    return "url:" + urlunsplit(
        (
            parsed.scheme.casefold(),
            parsed.netloc.casefold(),
            parsed.path.rstrip("/") or "/",
            urlencode(sorted(query)),
            "",
        )
    )


def verified_path(root: Path, relative: str, expected_sha256: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Source path escapes the configured library root")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected_sha256:
        raise ValueError("Source hash mismatch; review new content before publishing")
    return path


def extract_pages(path: Path) -> list[tuple[int, str]]:
    if path.suffix.lower() == ".md":
        return [
            (i + 1, section) for i, section in enumerate(path.read_text().split("<!-- section -->"))
        ]
    with pymupdf.open(path) as document:  # type: ignore[no-untyped-call]
        return [(i + 1, page.get_text(sort=False)) for i, page in enumerate(document)]


def chunk_pages(
    source: SourceSpec, pages: list[tuple[int, str]], *, max_chars: int = 1200
) -> list[ChunkSpec]:
    if not 100 <= max_chars <= 2400:
        raise ValueError("Chunk size must be 100–2400 characters")
    if source.disposition == "excluded":
        return []
    chunks: list[ChunkSpec] = []
    for page, raw in pages:
        if source.allowed_pages and page not in source.allowed_pages:
            continue
        raw = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "�", raw)
        text = re.sub(r"\s+", " ", raw).strip()
        ordinal = 0
        while text:
            end = min(len(text), max_chars)
            if end < len(text):
                boundaries = [
                    m.end()
                    for m in re.finditer(r"[。！？.!?;；]\s*|\s+", text[:end])
                    if m.end() >= end // 2
                ]
                if boundaries:
                    end = boundaries[-1]
            part = text[:end].strip()
            text = text[end:].lstrip()
            if not part:
                continue
            digest = hashlib.sha256(part.encode()).hexdigest()
            identifier = hashlib.sha256(
                f"{source.id}:{page}:{ordinal}:{digest}".encode()
            ).hexdigest()[:40]
            chunks.append(
                ChunkSpec(
                    id=identifier,
                    source_id=source.id,
                    page=page,
                    ordinal=ordinal,
                    text=part,
                    text_sha256=digest,
                    access_scope=source.access_scope,
                )
            )
            ordinal += 1
    return chunks


def validate_claim(claim: ClaimSpec, source: SourceSpec, chunks: list[ChunkSpec]) -> None:
    if claim.source_id != source.id or source.disposition == "excluded":
        raise ValueError("Claim source is not available")
    available = {chunk.id for chunk in chunks if chunk.source_id == source.id}
    if not set(claim.evidence_chunk_ids) <= available:
        raise ValueError("Claim evidence is outside the reviewed source scope")
