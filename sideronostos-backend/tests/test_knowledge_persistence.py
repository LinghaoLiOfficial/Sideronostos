"""Real PostgreSQL lifecycle checks; synthetic vectors test orchestration, not RAG quality."""

import os

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.core import installed_models  # noqa: F401
from sideronostos_backend.modules.database.base import Base
from sideronostos_backend.modules.knowledge.ingest import chunk_pages
from sideronostos_backend.modules.knowledge.models import KBActivation, KBRelease, KnowledgeChunk
from sideronostos_backend.modules.knowledge.schemas import ClaimSpec, SourceSpec
from sideronostos_backend.modules.knowledge.store import (
    activate_release,
    search_release,
    stage_release,
)

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def session():
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL test database required")
    if "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("Tests cannot use the application database")
    engine = create_async_engine(url)
    tables = [
        t for t in Base.metadata.sorted_tables if t.name.startswith(("knowledge_", "assistant_"))
    ]
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(lambda sync: Base.metadata.drop_all(sync, tables=tables))
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    async with async_sessionmaker(engine, expire_on_commit=False)() as value:
        yield value
    await engine.dispose()


def bundle():
    sources, chunks, claims = [], [], []
    for index, version in enumerate(("V2", "V3")):
        source = SourceSpec(
            id=f"S{index}",
            title="Versioned soil product",
            url=f"https://example.org/product/{version}",
            reader_file="unused.pdf",
            sha256=str(index) * 64,
            access_scope="full_text",
            topics=["rotation", "soil_water", "crop"],
            regions=["global"],
            limitations=["Not field calibration"],
            product="ECOSTRESS",
            product_version=version,
        )
        parts = chunk_pages(source, [(1, f"{version} surface water knowledge. 土壤 水分 数据。")])
        sources.append(source)
        chunks.extend(parts)
        claims.append(
            ClaimSpec(
                id=f"C{index}",
                source_id=source.id,
                statement="土壤水分是土壤所含的水，不能直接替代田间灌溉测量。",
                evidence_chunk_ids=[parts[0].id],
                applicability=["background"],
                limitations=["Not field calibration"],
                topics=["rotation", "soil_water", "crop"],
            )
        )
    return sources, chunks, claims


async def stage(session, name="test-r1"):
    return await stage_release(
        session,
        release_id=name,
        sources=bundle()[0],
        chunks=bundle()[1],
        claims=bundle()[2],
        embedding_model="synthetic-test-only",
        dimensions=2,
        namespace="test",
        report={"scope_reviewed": True},
    )


async def test_incomplete_release_cannot_be_activated_and_publish_is_immutable(session):
    await stage(session)
    await session.commit()
    with pytest.raises(ValueError, match="embedding"):
        await activate_release(session, "test-r1")
    for row in (await session.scalars(select(KnowledgeChunk))).all():
        row.embedding = [0.7, 0.3]
    await session.commit()
    await activate_release(session, "test-r1")
    await session.commit()
    pointer = await session.get(KBActivation, "default")
    assert pointer.release_id == "test-r1"
    assert (await session.get(KBRelease, "test-r1")).status == "published"
    with pytest.raises(ValueError, match="immutable"):
        await stage(session)


async def test_filter_applies_to_both_search_branches_and_rollback_is_explicit(session):
    await stage(session)
    for row in (await session.scalars(select(KnowledgeChunk))).all():
        row.embedding = [0.7, 0.3]
    await session.commit()
    await activate_release(session, "test-r1")
    await session.commit()
    results = await search_release(
        session,
        release_id="test-r1",
        query="土壤水分",
        vector=[0.7, 0.3],
        namespace="test",
        product="ECOSTRESS",
        product_version="V3",
    )
    assert len(results) == 1 and results[0]["source"]["product_version"] == "V3"
    assert "reader_file" not in results[0]["source"]
    with pytest.raises(ValueError, match="identity"):
        await search_release(
            session, release_id="test-r1", query="soil", vector=[0.7, 0.3], namespace="wrong"
        )
    await stage(session, "test-r2")
    with pytest.raises(ValueError):
        await activate_release(session, "test-r2")
    assert (await session.get(KBActivation, "default")).release_id == "test-r1"


async def test_lexical_degradation_retrieves_partial_query_terms_instead_of_requiring_every_word(
    session,
):
    await stage(session)
    for row in (await session.scalars(select(KnowledgeChunk))).all():
        row.embedding = [0.7, 0.3]
    await activate_release(session, "test-r1")
    await session.commit()
    hits = await search_release(
        session, release_id="test-r1", query="soil unheardtermxyz", vector=None, namespace="test"
    )
    assert hits and all("surface water" in h["excerpt"] for h in hits)


async def test_explicit_single_source_help_search_can_retrieve_more_than_two_sections(session):
    sources, _, claims = bundle()
    parts = chunk_pages(
        sources[0], [(i, f"Section {i}: surface water guidance.") for i in range(1, 5)]
    )
    claims[0].evidence_chunk_ids = [parts[0].id]
    await stage_release(
        session,
        release_id="help-test",
        sources=[sources[0]],
        chunks=parts,
        claims=[claims[0]],
        embedding_model="synthetic-test-only",
        dimensions=2,
        namespace="test",
        report={"scope_reviewed": True},
    )
    for row in (await session.scalars(select(KnowledgeChunk))).all():
        row.embedding = [0.7, 0.3]
    await activate_release(session, "help-test")
    await session.commit()
    hits = await search_release(
        session,
        release_id="help-test",
        query="water",
        vector=[0.7, 0.3],
        namespace="test",
        source_ids=["S0"],
        limit=8,
    )
    assert len(hits) == 4


async def test_source_exclusion_applies_to_both_rankings_before_fusion(session):
    await stage(session)
    for row in (await session.scalars(select(KnowledgeChunk))).all():
        row.embedding = [0.7, 0.3]
    await activate_release(session, "test-r1")
    await session.commit()
    hits = await search_release(
        session,
        release_id="test-r1",
        query="soil",
        vector=[0.7, 0.3],
        namespace="test",
        excluded_source_ids=["S0"],
    )
    assert not any(hit["source"]["id"] == "S0" for hit in hits)
