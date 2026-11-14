"""Freeze the offline farmer questions as a bot-scope and validation regression."""

import json
from pathlib import Path

import pytest
from test_assistant_pipeline import context_and_evidence

from sideronostos_backend.modules.farm_assistant.dialogue import product_evidence, route_message
from sideronostos_backend.modules.farm_assistant.pipeline import _mock_answer
from sideronostos_backend.modules.farm_assistant.schemas import ModelAnswer, Paragraph
from sideronostos_backend.modules.farm_assistant.validation import bind_answer

SUITE = json.loads((Path(__file__).parent / "fixtures" / "farmer_dialogue_v1.json").read_text())


@pytest.mark.parametrize("case", SUITE["cases"], ids=lambda case: case["id"])
def test_farmer_question_has_a_valid_scoped_offline_reply(case):
    route = route_message(
        case["question"],
        {
            "bot_id": case["bot_id"],
            "preset": case["preset"],
            "language": case["language"],
        },
    )
    assert route.kind == case.get("expected_route", "product_help")
    if route.kind == "evidence":
        return
    assert route.paragraphs
    source = product_evidence(route)
    answer = ModelAnswer(
        paragraphs=[Paragraph(text=text, evidence_ids=["K1"]) for text in route.paragraphs],
        needs_clarification=route.needs_clarification,
    )
    rendered = bind_answer(
        answer,
        [],
        [source],
        allowed_actions=[],
        can_claim_optimal=False,
        bot_id=case["bot_id"],
    )
    assert rendered["paragraphs"]
    assert all(paragraph["evidence_ids"] == ["K1"] for paragraph in rendered["paragraphs"])
    assert not rendered["actions"]


def test_old_rotation_mock_excerpt_cannot_answer_an_unrelated_field_question():
    context, evidence = context_and_evidence()
    context.update(bot_id="field-guide", preset="field_management", language="en")
    evidence["knowledge"] = [
        {
            "id": "K1",
            "source": {"id": "HELPV2"},
            "excerpt": "Recalculate the rotation plan to compare water gaps.",
        }
    ]
    result = _mock_answer(
        "Tell me about my back field",
        context,
        evidence,
        {"facts": [], "context": {"allowed_actions": []}},
        bot_id="field-guide",
    )
    assert "Which saved field" in result["paragraphs"][0]["text"]
    assert result["citations"] == []
    assert result["needs_clarification"] is True
