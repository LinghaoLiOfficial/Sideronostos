"""Small, explicitly labelled local KB fixture sourced from bundled product help."""

import hashlib
import math
from pathlib import Path

from .ingest import chunk_pages, extract_pages
from .retrieval import tokenize
from .schemas import ClaimSpec, SourceSpec

MOCK_RELEASE_ID = "local-mock-product-help-v3"
MOCK_MODEL = "local-hash-token-v1"
MOCK_DIMENSIONS = 1536
MOCK_READER = Path(__file__).parent / "data" / "readers" / "product-help-v2.md"


def mock_embedding(text: str, dimensions: int = MOCK_DIMENSIONS) -> list[float]:
    """Deterministic token-hash vectors for local search rehearsal, not semantic embeddings."""
    if dimensions < 8:
        raise ValueError("Mock embedding dimensions must be at least eight")
    vector = [0.0] * dimensions
    for token in tokenize(text):
        digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        vector[index] += 1.0 if digest[4] & 1 else -1.0
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        vector[0] = 1.0
        return vector
    return [value / norm for value in vector]


def build_mock_bundle() -> dict[str, object]:
    content = MOCK_READER.read_bytes()
    source = SourceSpec(
        id="HELPV2",
        title="Field Shift v2 product help (local mock fixture)",
        url=(
            "https://github.com/LinghaoLiOfficial/Sideronostos/blob/"
            "feat/agent-bot-catalog-integration/sideronostos-backend/src/"
            "sideronostos_backend/modules/knowledge/data/readers/product-help-v2.md"
        ),
        reader_file=MOCK_READER.name,
        sha256=hashlib.sha256(content).hexdigest(),
        access_scope="product_help",
        locator_type="section",
        topics=["soil_water", "crop", "rotation"],
        regions=["product documentation"],
        limitations=[
            "Local mock product help only; it is not agronomic evidence or live user data."
        ],
        product="Field Shift",
        product_version="v2",
    )
    chunks = chunk_pages(source, extract_pages(MOCK_READER))
    claims = [
        ClaimSpec(
            id=f"MOCK-{topic.upper()}",
            source_id=source.id,
            statement=(
                f"The local mock product-help release contains workflow guidance tagged {topic}; "
                "it is not evidence about a farmer's field or an agronomic outcome."
            ),
            evidence_chunk_ids=[chunk.id for chunk in chunks],
            applicability=["local assistant workflow rehearsal"],
            limitations=[
                "Synthetic release metadata; consult linked product documentation in a real "
                "deployment."
            ],
            topics=[topic],
        )
        for topic in ("soil_water", "crop", "rotation")
    ]
    return {
        "sources": [source],
        "chunks": chunks,
        "claims": claims,
        "report": {
            "scope_reviewed": True,
            "mock_fixture": True,
            "source_review_date": "2026-11-14",
            "source_audit": [
                {
                    "id": source.id,
                    "sha256": source.sha256,
                    "chunks": len(chunks),
                    "disposition": "include",
                    "access_scope": source.access_scope,
                }
            ],
        },
    }
