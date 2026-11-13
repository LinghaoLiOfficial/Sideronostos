"""Offline preparation, resumable embedding, and atomic publication.

Run `python -m sideronostos_backend.modules.knowledge.cli --help`.
No HTTP route calls this module; ingestion may never be triggered by a chat.
"""

import argparse
import asyncio
import hashlib
import json
import re
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from ...core.config import get_settings
from ..database.session import create_engine, create_session_factory
from .embeddings import EmbeddingProvider, validate_vector
from .ingest import canonical_key, chunk_pages, extract_pages, validate_claim, verified_path
from .models import KBRelease, KnowledgeChunk, KnowledgeClaim, KnowledgeSource
from .schemas import ChunkSpec, ClaimSpec, SourceSpec
from .settings import get_knowledge_settings
from .store import activate_release, stage_release

DEFAULT_MANIFEST = Path(__file__).parent / "data" / "library-manifest.json"


def prepare(
    manifest: Path, library_root: Path, *, prepared_root: Path | None = None
) -> dict[str, Any]:
    content = json.loads(manifest.read_text())
    sources = [SourceSpec.model_validate(item) for item in content["sources"]]
    chunks: list[ChunkSpec] = []
    canonical: dict[str, str] = {}
    hashes: dict[str, str] = {}
    audit: list[dict[str, Any]] = []
    for source in sources:
        root = library_root if source.asset_group == "library" else prepared_root
        if root is None:
            raise ValueError("A prepared source requires --prepared-root")
        path = verified_path(root, source.reader_file, source.sha256)
        if (path.suffix.lower() == ".md") != (source.locator_type == "section"):
            raise ValueError("Source locator type does not match its file format")
        key = canonical_key(source)
        duplicate_of = canonical.get(key) or hashes.get(source.sha256)
        if duplicate_of and source.disposition == "include":
            source.disposition = "excluded"
            source.exclusion_reason = f"Canonical duplicate of {duplicate_of}"
        canonical.setdefault(key, source.id)
        hashes.setdefault(source.sha256, source.id)
        pages = extract_pages(path)
        control_count = sum(
            len(re.findall(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", text)) for _, text in pages
        )
        if control_count:
            source.limitations.append(
                "PDF extraction contains unreadable glyphs marked �; "
                "do not use damaged formulas or numbers as executable parameters."
            )
        if source.allowed_pages and max(source.allowed_pages) > len(pages):
            raise ValueError(f"{source.id}: reviewed page lies outside the reader")
        parts = chunk_pages(source, pages)
        if source.disposition == "include" and not parts:
            raise ValueError(f"{source.id}: no extractable text; manual/OCR review required")
        chunks.extend(parts)
        audit.append(
            {
                "id": source.id,
                "sha256": source.sha256,
                "pages": len(pages),
                "chunks": len(parts),
                "unreadable_control_glyphs": control_count,
                "access_scope": source.access_scope,
                "disposition": source.disposition,
                "reason": source.exclusion_reason,
            }
        )
    by_source = {source.id: source for source in sources}
    claims: list[ClaimSpec] = []
    for raw in content["claims"]:
        data = dict(raw)
        anchors = data.pop("anchors")
        evidence: list[str] = []
        for anchor in anchors:
            needle = " ".join(anchor["contains"].split()).casefold()
            found = [
                chunk.id
                for chunk in chunks
                if chunk.source_id == data["source_id"]
                and chunk.page == anchor["page"]
                and needle in chunk.text.casefold()
            ]
            if not found:
                raise ValueError(
                    f"Claim {data['id']}: anchor not found within one chunk; review exact page"
                )
            evidence.extend(found)
        claim = ClaimSpec.model_validate(
            {**data, "evidence_chunk_ids": list(dict.fromkeys(evidence))}
        )
        validate_claim(claim, by_source[claim.source_id], chunks)
        claims.append(claim)
    return {
        "sources": [source.model_dump(mode="json") for source in sources],
        "chunks": [chunk.model_dump(mode="json") for chunk in chunks],
        "claims": [claim.model_dump(mode="json") for claim in claims],
        "report": {
            "scope_reviewed": True,
            "source_audit": audit,
            "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
            "source_review_date": content["source_review_date"],
        },
    }


async def embed_staging(release_id: str, provider: EmbeddingProvider) -> dict[str, int]:
    engine = create_engine(get_settings())
    factory = create_session_factory(engine)
    cache = get_knowledge_settings().asset_root / "embedding-cache" / provider.namespace
    cache.mkdir(parents=True, exist_ok=True)
    total_tokens = 0
    embedded = 0
    try:
        async with factory() as session:
            release = await session.get(KBRelease, release_id)
            if release is None or release.status != "staging":
                raise ValueError("Embedding updates are only allowed on staging releases")
            if (
                release.embedding_namespace != provider.namespace
                or release.embedding_model != provider.settings.embedding_model
                or release.embedding_dimensions != provider.settings.embedding_dimensions
            ):
                raise ValueError("Embedding provider changed; create a new release identity")
            sources = {
                row.id: row.data
                for row in (
                    await session.scalars(
                        select(KnowledgeSource).where(KnowledgeSource.release_id == release_id)
                    )
                ).all()
            }
            claims = (
                await session.scalars(
                    select(KnowledgeClaim).where(KnowledgeClaim.release_id == release_id)
                )
            ).all()
            rows = (
                await session.scalars(
                    select(KnowledgeChunk)
                    .where(
                        KnowledgeChunk.release_id == release_id, KnowledgeChunk.embedding.is_(None)
                    )
                    .order_by(KnowledgeChunk.source_id, KnowledgeChunk.page, KnowledgeChunk.ordinal)
                )
            ).all()
            # Cache contains public source text embeddings only, never farmer conversations.
            for offset in range(0, len(rows), provider.settings.batch_size):
                locked = await session.get(
                    KBRelease, release_id, with_for_update=True, populate_existing=True
                )
                if locked is None or locked.status != "staging":
                    raise ValueError("Release became immutable during embedding")
                release = locked
                batch = rows[offset : offset + provider.settings.batch_size]
                inputs: list[str] = []
                paths: list[Path] = []
                missing: list[KnowledgeChunk] = []
                for row in batch:
                    statements = [
                        claim.data["statement"]
                        for claim in claims
                        if row.id in claim.data["evidence_chunk_ids"]
                    ][:2]
                    value = "\n".join([sources[row.source_id]["title"], *statements, row.text])
                    if len(value) > 5000:
                        raise ValueError("Enriched evidence exceeds embedding budget; review chunk")
                    digest = hashlib.sha256(value.encode()).hexdigest()
                    path = cache / f"{digest}.json"
                    if path.exists():
                        entry = json.loads(path.read_text())
                        if (
                            entry["input_sha256"] != digest
                            or entry["namespace"] != provider.namespace
                        ):
                            raise ValueError("Embedding cache identity mismatch")
                        row.embedding = validate_vector(
                            entry["vector"], release.embedding_dimensions
                        )
                    else:
                        inputs.append(value)
                        paths.append(path)
                        missing.append(row)
                if inputs:
                    vectors, tokens = await provider.embed(inputs)
                    total_tokens += tokens
                    for row, vector, path in zip(missing, vectors, paths, strict=True):
                        row.embedding = vector
                        temporary = path.with_suffix(f".{uuid4().hex}.tmp")
                        temporary.write_text(
                            json.dumps(
                                {
                                    "namespace": provider.namespace,
                                    "input_sha256": path.stem,
                                    "vector": vector,
                                }
                            )
                        )
                        temporary.replace(path)
                embedded += len(batch)
                release.report = {
                    **release.report,
                    "embedding_usage_tokens": release.report.get("embedding_usage_tokens", 0)
                    + (tokens if inputs else 0),
                }
                await session.commit()
        return {"embedded": embedded, "new_tokens": total_tokens}
    finally:
        await engine.dispose()


async def main_async(args: argparse.Namespace) -> None:
    if args.command == "prepare":
        if not args.library_root:
            raise ValueError("--library-root is required for source preparation")
        bundle = prepare(args.manifest, args.library_root, prepared_root=args.prepared_root)
        args.bundle.parent.mkdir(parents=True, exist_ok=True)
        args.bundle.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "status": "prepared_not_published",
                    "sources": len(bundle["sources"]),
                    "chunks": len(bundle["chunks"]),
                    "claims": len(bundle["claims"]),
                }
            )
        )
        return
    if args.command == "embed":
        provider = EmbeddingProvider()
        try:
            print(json.dumps(await embed_staging(args.release, provider)))
        finally:
            await provider.close()
        return
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session:
            if args.command == "stage":
                bundle = json.loads(args.bundle.read_text())
                provider = EmbeddingProvider()
                try:
                    release = await stage_release(
                        session,
                        release_id=args.release,
                        sources=[SourceSpec.model_validate(item) for item in bundle["sources"]],
                        chunks=[ChunkSpec.model_validate(item) for item in bundle["chunks"]],
                        claims=[ClaimSpec.model_validate(item) for item in bundle["claims"]],
                        embedding_model=provider.settings.embedding_model,
                        dimensions=provider.settings.embedding_dimensions,
                        namespace=provider.namespace,
                        report=bundle["report"],
                    )
                finally:
                    await provider.close()
            else:
                release = await activate_release(session, args.release)
            await session.commit()
            print(
                json.dumps(
                    {
                        "id": release.id,
                        "status": release.status,
                        "manifest_sha256": release.manifest_sha256,
                    }
                )
            )
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "stage", "embed", "activate"])
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--library-root", type=Path, default=get_knowledge_settings().library_root)
    parser.add_argument(
        "--bundle", type=Path, default=get_knowledge_settings().asset_root / "prepared.json"
    )
    parser.add_argument(
        "--prepared-root", type=Path, default=get_knowledge_settings().asset_root / "sources"
    )
    parser.add_argument("--release", default="field-shift-knowledge-20261112-v1")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
