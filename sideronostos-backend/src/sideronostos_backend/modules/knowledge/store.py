"""Transactional releases and exact, prefiltered hybrid retrieval."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, literal_column, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from .embeddings import validate_vector
from .ingest import CHUNK_RECIPE, canonical_key, validate_claim
from .models import KBActivation, KBRelease, KnowledgeChunk, KnowledgeClaim, KnowledgeSource
from .retrieval import fuse_rankings, tokenize
from .schemas import ChunkSpec, ClaimSpec, SourceSpec


async def stage_release(
    session: AsyncSession,
    *,
    release_id: str,
    sources: list[SourceSpec],
    chunks: list[ChunkSpec],
    claims: list[ClaimSpec],
    embedding_model: str,
    dimensions: int,
    namespace: str,
    report: dict[str, Any],
) -> KBRelease:
    if not release_id or len(release_id) > 80 or not 1 <= dimensions <= 3072:
        raise ValueError("Invalid release identity or dimensions")
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": "knowledge:" + release_id}
    )
    if await session.get(KBRelease, release_id):
        raise ValueError(
            "Release identity is immutable; resume its missing embeddings or use a new ID"
        )
    by_source = {source.id: source for source in sources}
    if (
        len(by_source) != len(sources)
        or len({c.id for c in chunks}) != len(chunks)
        or len({c.id for c in claims}) != len(claims)
    ):
        raise ValueError("Duplicate source, chunk or claim ID")
    canonical = [canonical_key(s) for s in sources if s.disposition == "include"]
    if len(canonical) != len(set(canonical)):
        raise ValueError("Canonical sources must be deduplicated before staging")
    for chunk in chunks:
        source = by_source.get(chunk.source_id)
        if source is None or source.disposition != "include":
            raise ValueError("Chunk has no included source")
        if source.allowed_pages and chunk.page not in source.allowed_pages:
            raise ValueError("Chunk exceeds source access scope")
        if (
            chunk.access_scope != source.access_scope
            or chunk.text_sha256 != hashlib.sha256(chunk.text.encode()).hexdigest()
        ):
            raise ValueError("Chunk integrity or scope mismatch")
    for claim in claims:
        if claim.source_id not in by_source:
            raise ValueError("Claim has no source")
        validate_claim(claim, by_source[claim.source_id], chunks)
    if not chunks or not claims:
        raise ValueError("A release needs evidence chunks and reviewed claims")
    payload = {
        "sources": [s.model_dump(mode="json") for s in sources],
        "chunks": [c.model_dump(mode="json") for c in chunks],
        "claims": [c.model_dump(mode="json") for c in claims],
        "model": embedding_model,
        "dimensions": dimensions,
        "namespace": namespace,
        "recipe": CHUNK_RECIPE,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    release = KBRelease(
        id=release_id,
        manifest_sha256=digest,
        embedding_model=embedding_model,
        embedding_dimensions=dimensions,
        embedding_namespace=namespace,
        recipe=CHUNK_RECIPE,
        report={
            **report,
            "source_count": len(sources),
            "chunk_count": len(chunks),
            "claim_count": len(claims),
        },
    )
    session.add(release)
    await session.flush()
    for source in sources:
        session.add(
            KnowledgeSource(
                release_id=release_id,
                id=source.id,
                canonical_key=canonical_key(source),
                data=source.model_dump(mode="json"),
            )
        )
    await session.flush()
    by_chunk: dict[str, list[str]] = {}
    for claim in claims:
        session.add(
            KnowledgeClaim(
                release_id=release_id,
                id=claim.id,
                source_id=claim.source_id,
                data=claim.model_dump(mode="json"),
            )
        )
        for chunk_id in claim.evidence_chunk_ids:
            by_chunk.setdefault(chunk_id, []).append(claim.statement)
    for chunk in chunks:
        source = by_source[chunk.source_id]
        enriched = " ".join([source.title, chunk.text, *by_chunk.get(chunk.id, [])])
        session.add(
            KnowledgeChunk(
                release_id=release_id,
                id=chunk.id,
                source_id=chunk.source_id,
                page=chunk.page,
                ordinal=chunk.ordinal,
                text=chunk.text,
                text_sha256=chunk.text_sha256,
                lexical_terms=" ".join(tokenize(enriched)),
                topics=source.topics,
                product=source.product,
                product_version=source.product_version,
            )
        )
    await session.flush()
    return release


async def activate_release(session: AsyncSession, release_id: str) -> KBRelease:
    # Serializes publication and rollback; readers see one complete committed release.
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext('knowledge:activation'))"))
    release = await session.get(KBRelease, release_id, with_for_update=True)
    if release is None:
        raise ValueError("Release does not exist")
    rows = (
        await session.scalars(select(KnowledgeChunk).where(KnowledgeChunk.release_id == release_id))
    ).all()
    if not rows or any(row.embedding is None for row in rows):
        raise ValueError("Release embeddings are incomplete")
    for row in rows:
        value = row.embedding
        if value is None:
            raise ValueError("Release embeddings are incomplete")
        validate_vector(
            value.tolist() if hasattr(value, "tolist") else value, release.embedding_dimensions
        )
    claims = (
        await session.scalars(select(KnowledgeClaim).where(KnowledgeClaim.release_id == release_id))
    ).all()
    topics = {topic for claim in claims for topic in claim.data["topics"]}
    if not release.report.get("scope_reviewed") or topics != {"soil_water", "crop", "rotation"}:
        raise ValueError("Source scope or shared topic coverage has not been reviewed")
    previous = await session.get(KBActivation, "default")
    old_id = previous.release_id if previous else None
    if release.status == "staging":
        release.status = "published"
        release.published_at = datetime.now(UTC)
        release.report = {
            **release.report,
            "previous_release_id": old_id,
            "embedding_count": len(rows),
        }
    elif release.status != "published":
        raise ValueError("Only complete releases can be activated")
    now = datetime.now(UTC)
    await session.execute(
        insert(KBActivation)
        .values(name="default", release_id=release_id, updated_at=now)
        .on_conflict_do_update(
            index_elements=["name"], set_={"release_id": release_id, "updated_at": now}
        )
    )
    await session.flush()
    if previous is not None:
        await session.refresh(previous)
    return release


async def active_release(session: AsyncSession) -> KBRelease:
    pointer = await session.get(KBActivation, "default")
    if pointer is None:
        raise ValueError("No knowledge release is published")
    release = await session.get(KBRelease, pointer.release_id)
    if release is None or release.status != "published":
        raise ValueError("Knowledge release is unavailable")
    return release


def public_source(source: KnowledgeSource) -> dict[str, Any]:
    return {key: value for key, value in source.data.items() if key != "reader_file"}


async def search_release(
    session: AsyncSession,
    *,
    release_id: str,
    query: str,
    vector: list[float] | None,
    namespace: str,
    product: str | None = None,
    product_version: str | None = None,
    topic: str | None = None,
    source_ids: list[str] | None = None,
    excluded_source_ids: list[str] | None = None,
    limit: int = 8,
    candidate_limit: int = 40,
) -> list[dict[str, Any]]:
    release = await session.get(KBRelease, release_id)
    if release is None or release.status != "published":
        raise ValueError("Only published knowledge may be retrieved")
    if release.embedding_namespace != namespace:
        raise ValueError("Embedding identity does not match the release")
    conditions = [KnowledgeChunk.release_id == release_id]
    if product:
        conditions.append(or_(KnowledgeChunk.product.is_(None), KnowledgeChunk.product == product))
    if product_version:
        if not product:
            raise ValueError("A product version requires its product identity")
        conditions.append(
            or_(KnowledgeChunk.product.is_(None), KnowledgeChunk.product_version == product_version)
        )
    if source_ids is not None:
        conditions.append(KnowledgeChunk.source_id.in_(source_ids))
    if excluded_source_ids:
        conditions.append(KnowledgeChunk.source_id.not_in(excluded_source_ids))
    if topic:
        conditions.append(KnowledgeChunk.topics.contains([topic]))
    terms = " OR ".join(dict.fromkeys(tokenize(query)[:256]))
    # The literal text-search configuration matches the migration's GIN expression.
    document = func.to_tsvector(literal_column("'simple'::regconfig"), KnowledgeChunk.lexical_terms)
    tsquery = func.websearch_to_tsquery(literal_column("'simple'::regconfig"), terms)
    lexical = list(
        (
            await session.scalars(
                select(KnowledgeChunk.id)
                .where(*conditions, document.op("@@")(tsquery))
                .order_by(func.ts_rank_cd(document, tsquery).desc(), KnowledgeChunk.id)
                .limit(candidate_limit)
            )
        ).all()
    )
    semantic: list[str] = []
    if vector is not None:
        checked = validate_vector(vector, release.embedding_dimensions)
        # Exact cosine search after version/product filters; no approximate postfilter recall loss.
        semantic = list(
            (
                await session.scalars(
                    select(KnowledgeChunk.id)
                    .where(*conditions, KnowledgeChunk.embedding.is_not(None))
                    .order_by(KnowledgeChunk.embedding.cosine_distance(checked), KnowledgeChunk.id)
                    .limit(candidate_limit)
                )
            ).all()
        )
    ranking = fuse_rankings(lexical, semantic, limit=candidate_limit * 2)
    if not ranking:
        return []
    rows = (
        await session.scalars(
            select(KnowledgeChunk).where(
                KnowledgeChunk.release_id == release_id, KnowledgeChunk.id.in_(ranking)
            )
        )
    ).all()
    by_id = {row.id: row for row in rows}
    matched_source_ids = {row.source_id for row in rows}
    sources = {
        row.id: row
        for row in (
            await session.scalars(
                select(KnowledgeSource).where(
                    KnowledgeSource.release_id == release_id,
                    KnowledgeSource.id.in_(matched_source_ids),
                )
            )
        ).all()
    }
    claims = (
        await session.scalars(
            select(KnowledgeClaim).where(
                KnowledgeClaim.release_id == release_id,
                KnowledgeClaim.source_id.in_(matched_source_ids),
            )
        )
    ).all()
    result: list[dict[str, Any]] = []
    source_counts: dict[str, int] = {}
    per_source_limit = limit if source_ids is not None and len(source_ids) == 1 else 2
    for identifier in ranking:
        row = by_id[identifier]
        if source_counts.get(row.source_id, 0) >= per_source_limit:
            continue
        source_counts[row.source_id] = source_counts.get(row.source_id, 0) + 1
        result.append(
            {
                "id": row.id,
                "release_id": release_id,
                "source": public_source(sources[row.source_id]),
                "page": row.page,
                "excerpt": row.text,
                "claims": [
                    claim.data for claim in claims if row.id in claim.data["evidence_chunk_ids"]
                ],
                "retrieval_mode": "hybrid" if vector is not None else "lexical_degraded",
            }
        )
        if len(result) >= limit:
            break
    return result
