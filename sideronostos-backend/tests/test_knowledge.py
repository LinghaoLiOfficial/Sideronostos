from pathlib import Path

import pytest

from sideronostos_backend.modules.knowledge.ingest import (
    canonical_key,
    chunk_pages,
    validate_claim,
    verified_path,
)
from sideronostos_backend.modules.knowledge.retrieval import fuse_rankings, tokenize
from sideronostos_backend.modules.knowledge.schemas import ClaimSpec, SourceSpec


def source(**changes):
    return SourceSpec.model_validate(
        {
            "id": "S01",
            "title": "Soil water manual",
            "url": "https://example.org/soil",
            "reader_file": "soil.pdf",
            "sha256": "a" * 64,
            "access_scope": "full_text",
            "topics": ["soil_water"],
            "regions": ["global"],
            "crops": [],
            "limitations": ["Regional background, not a field measurement."],
            **changes,
        }
    )


def test_canonical_identity_ignores_tracking_but_preserves_product_query():
    assert canonical_key(source(doi="https://doi.org/10.1234/AbC")) == "doi:10.1234/abc"
    assert (
        canonical_key(source(url="https://example.org/soil?utm_source=x&version=6#abc"))
        == "url:https://example.org/soil?version=6"
    )
    assert canonical_key(source(url="https://example.org/soil?version=5")) != canonical_key(
        source(url="https://example.org/soil?version=6")
    )


def test_chunks_preserve_page_identity_and_access_scope():
    chunks = chunk_pages(
        source(access_scope="abstract_only", allowed_pages=[2]),
        [(1, "Private full text."), (2, "An available abstract. " * 90)],
        max_chars=300,
    )
    assert chunks and all(c.page == 2 and len(c.text) <= 300 for c in chunks)
    assert all(c.access_scope == "abstract_only" for c in chunks)
    assert "".join(c.text.replace(" ", "") for c in chunks) == (
        "An available abstract." * 90
    ).replace(" ", "")
    assert len({c.id for c in chunks}) == len(chunks)
    assert [c.id for c in chunks] == [
        c.id
        for c in chunk_pages(
            source(access_scope="abstract_only", allowed_pages=[2]),
            [(2, "An available abstract. " * 90)],
            max_chars=300,
        )
    ]


def test_unicode_chunks_keep_every_character():
    text = "轮作能够调整作物顺序，但不能保证每个地块都增产。" * 30
    chunks = chunk_pages(source(), [(4, text)], max_chars=150)
    assert "".join(c.text for c in chunks) == text
    assert all(c.page == 4 for c in chunks)


def test_source_scope_and_claim_cannot_invent_full_text():
    with pytest.raises(ValueError):
        source(access_scope="abstract_only")
    restricted = source(access_scope="abstract_only", allowed_pages=[2])
    chunks = chunk_pages(restricted, [(2, "Rotations may improve soil properties.")])
    claim = ClaimSpec(
        id="C1",
        source_id="S01",
        statement="轮作效果因环境而异。",
        evidence_chunk_ids=[chunks[0].id],
        applicability=["background"],
        limitations=["not a field prediction"],
        topics=["rotation"],
    )
    validate_claim(claim, restricted, chunks)
    with pytest.raises(ValueError, match="evidence"):
        validate_claim(
            claim.model_copy(update={"evidence_chunk_ids": ["missing"]}), restricted, chunks
        )
    with pytest.raises(ValueError, match="source"):
        validate_claim(claim.model_copy(update={"source_id": "S02"}), restricted, chunks)


def test_manifest_paths_cannot_escape_root(tmp_path: Path):
    with pytest.raises(ValueError, match="root"):
        verified_path(tmp_path, "../private.pdf", "a" * 64)
    (tmp_path / "soil.pdf").write_bytes(b"soil")
    with pytest.raises(ValueError, match="hash"):
        verified_path(tmp_path, "soil.pdf", "a" * 64)


def test_bilingual_tokenization_and_rrf_diversity():
    terms = tokenize("轮作 soil-water 玉米 crop rotation")
    assert "轮作" in terms and "soil" in terms and "rotation" in terms
    assert not any(c in terms for c in ("&", "|", ":"))
    assert fuse_rankings(["a", "b", "c"], ["c", "a", "d"], limit=3) == ["a", "c", "b"]
    assert fuse_rankings([], ["x"], limit=8) == ["x"]


def test_embedding_validation_rejects_wrong_dimensions_and_nonfinite():
    from sideronostos_backend.modules.knowledge.embeddings import validate_vector

    assert validate_vector([0.1, 0.2], 2) == [0.1, 0.2]
    for value in ([0.1], [0.0, float("nan")], [True, 1.0], [0.0, 0.0]):
        with pytest.raises(ValueError):
            validate_vector(value, 2)


def test_pdf_extraction_keeps_columns_in_native_reading_order(tmp_path):
    import pymupdf
    from sideronostos_backend.modules.knowledge.ingest import extract_pages

    path = tmp_path / "two-columns.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (40, 50),
        "Gross revenue cannot establish profit\nwhen input cost data are missing.",
        fontsize=10,
    )
    page.insert_text((350, 50), "Crops on another column.\nThis is another argument.", fontsize=10)
    doc.save(path)
    doc.close()
    text = " ".join(extract_pages(path)[0][1].split())
    assert "profit when input cost data are missing" in text


def test_prepared_text_has_explicit_section_locators_and_separate_root(tmp_path):
    import hashlib
    import json
    from sideronostos_backend.modules.knowledge.cli import prepare

    library = tmp_path / "original"
    library.mkdir()
    supplements = tmp_path / "prepared"
    supplements.mkdir()
    content = "# Plan help\nDrafts need explicit recomputation.\n<!-- section -->\n# Metric help\nEstimated water is not measured irrigation."
    (supplements / "help.md").write_text(content)
    item = source(
        id="HELP",
        reader_file="help.md",
        sha256=hashlib.sha256(content.encode()).hexdigest(),
        asset_group="prepared",
        locator_type="section",
        access_scope="product_help",
        topics=["rotation"],
    )
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "source_review_date": "2026-11-12",
                "sources": [item.model_dump(mode="json")],
                "claims": [
                    {
                        "id": "HELP1",
                        "source_id": "HELP",
                        "statement": "草稿条件修改之后需要明确重算才会生成新结果。",
                        "anchors": [{"page": 1, "contains": "Drafts need explicit recomputation."}],
                        "applicability": ["Field Shift v2"],
                        "limitations": ["Product semantics only"],
                        "topics": ["rotation"],
                    }
                ],
            }
        )
    )
    with pytest.raises(ValueError, match="prepared"):
        prepare(manifest, library)
    bundle = prepare(manifest, library, prepared_root=supplements)
    assert [c["page"] for c in bundle["chunks"]] == [1, 2]
    assert bundle["sources"][0]["locator_type"] == "section"
    assert len(bundle["claims"]) == 1


def test_pdf_control_glyphs_are_marked_without_joining_words():
    parts = chunk_pages(source(), [(1, "soil\x00moisture reading\x07 ends")])
    assert parts[0].text == "soil�moisture reading� ends"
    assert "\x00" not in parts[0].text
