import pytest

from sideronostos_backend.modules.knowledge.mock_release import (
    MOCK_DIMENSIONS,
    build_mock_bundle,
    mock_embedding,
)


def test_local_mock_bundle_is_bilingual_and_covers_all_product_knowledge_topics():
    bundle = build_mock_bundle()
    assert len(bundle["chunks"]) >= 5
    assert {topic for claim in bundle["claims"] for topic in claim.topics} == {
        "soil_water",
        "crop",
        "rotation",
    }
    assert all(chunk.access_scope == "product_help" for chunk in bundle["chunks"])
    assert any("NASA" in chunk.text for chunk in bundle["chunks"])
    assert bundle["report"]["mock_fixture"] is True
    assert str(bundle["sources"][0].url).startswith("https://github.com/LinghaoLiOfficial/Sideronostos/blob/")


def test_local_mock_embeddings_are_deterministic_and_dimensioned():
    first = mock_embedding("轮作 soil water", MOCK_DIMENSIONS)
    assert first == mock_embedding("轮作 soil water", MOCK_DIMENSIONS)
    assert first != mock_embedding("NASA surface moisture", MOCK_DIMENSIONS)
    assert len(first) == MOCK_DIMENSIONS
    assert sum(value * value for value in first) == pytest.approx(1.0)
