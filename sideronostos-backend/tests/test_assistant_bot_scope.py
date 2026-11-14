"""Stable bot identity is an authority boundary for science facts and answers."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from sideronostos_backend.modules.farm_assistant import bot_scope, pipeline
from sideronostos_backend.modules.farm_assistant.schemas import ConversationCreate, ModelAnswer
from sideronostos_backend.modules.farm_assistant.validation import bind_answer


@pytest.mark.parametrize(
    ("preset", "bot_id"),
    [
        ("field_management", "field-guide"),
        ("remote_sensing", "remote-water"),
        ("remote_sensing", "remote-soil"),
        ("remote_sensing", "remote-weather"),
        ("local_agriculture", "local-knowledge-guide"),
        ("rotation", "rotation-guide"),
    ],
)
def test_create_accepts_only_bot_identity_matching_its_preset(preset, bot_id):
    assert ConversationCreate(preset=preset, bot_id=bot_id).bot_id == bot_id
    with pytest.raises(ValidationError):
        ConversationCreate(
            preset="rotation", bot_id=bot_id if preset != "rotation" else "remote-soil"
        )
    with pytest.raises(ValidationError):
        ConversationCreate(preset=preset, bot_id="unknown-bot")


def test_remote_specialties_hide_cross_domain_and_other_science_facts():
    facts = [
        {
            "id": "F1",
            "key": "science.smap:surface_moisture",
            "source": {"product": "SPL3SMP_E", "metric": "surface_soil_moisture"},
        },
        {
            "id": "F0",
            "key": "science.smap:other_metric",
            "source": {"product": "SPL3SMP_E", "metric": "other_metric"},
        },
        {"id": "F2", "key": "science.rainfall_total", "source": {"product": "NASA_POWER_DAILY"}},
        {
            "id": "F3",
            "key": "science.reference_et0_total",
            "source": {"product": "NASA_POWER_DAILY"},
        },
        {"id": "F4", "key": "field.owned.area", "source": {"kind": "farmer_input"}},
    ]
    context = {
        "facts": facts,
        "fields": [{"id": "private-field"}],
        "run": {"id": "private-run"},
        "comparison": None,
        "science": {
            "facts": [
                {"metric": "surface_soil_moisture", "source": {"product": "SPL3SMP_E"}},
                {"metric": "rainfall_total", "source": {"product": "NASA_POWER_DAILY"}},
                {"metric": "reference_et0_total", "source": {"product": "NASA_POWER_DAILY"}},
            ],
            "unavailable": [{"release_id": "soil-only", "reason": "smap_quality_failed"}],
        },
        "warnings": ["smap_quality_failed"],
        "allowed_actions": ["open_planner", "choose_field", "view_sources"],
        "can_claim_optimal": True,
    }
    soil = bot_scope.scope_context(context, "remote-soil")
    weather = bot_scope.scope_context(context, "remote-weather")
    water = bot_scope.scope_context(context, "remote-water")
    assert [f["id"] for f in soil["facts"]] == ["F1"]
    assert [f["id"] for f in weather["facts"]] == ["F2", "F3"]
    assert [f["id"] for f in water["facts"]] == ["F1", "F2", "F3"]
    assert weather["fields"] == [] and weather["run"] is None
    assert weather["allowed_actions"] == ["view_sources"]
    assert weather["can_claim_optimal"] is False
    assert weather["warnings"] == []
    assert [f["metric"] for f in weather["science"]["facts"]] == [
        "rainfall_total",
        "reference_et0_total",
    ]


@pytest.mark.asyncio
async def test_weather_retrieval_uses_only_weather_sources(monkeypatch):
    captured = {}

    class Embedding:
        namespace = "test"

        async def embed(self, queries):
            return [[0.1, 0.2]], 3

        async def close(self):
            pass

    async def search(session, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(pipeline, "EmbeddingProvider", Embedding)
    monkeypatch.setattr(pipeline, "search_release", search)
    context = {"bot_id": "remote-weather", "facts": [], "selection": None}
    release = SimpleNamespace(id="release", embedding_namespace="test", manifest_sha256="a" * 64)
    await pipeline.collect_evidence(None, "Will it rain tomorrow?", context, release)
    assert set(captured["source_ids"]) == {"S01", "S11", "S29", "S36"}
    assert "SMAP006" not in captured["source_ids"]


@pytest.mark.parametrize(
    "claim",
    [
        "Tomorrow will be rainy.",
        "明天会下雨。",
        "Next week will be dry.",
        "It will rain tomorrow.",
        "I can forecast tomorrow's weather.",
        "我可以预测明天的天气。",
        "会在明天下雨。",
    ],
)
def test_weather_bot_rejects_unsupported_forecast_claims(claim):
    answer = ModelAnswer(paragraphs=[{"text": claim, "evidence_ids": []}])
    with pytest.raises(ValueError, match="forecast"):
        bind_answer(
            answer, [], [], allowed_actions=[], can_claim_optimal=False, bot_id="remote-weather"
        )


@pytest.mark.parametrize(
    "limitation",
    ["Tomorrow's rainfall is unavailable.", "明天的降雨情况无法预测。"],
)
def test_weather_bot_can_state_that_future_weather_is_unavailable(limitation):
    answer = ModelAnswer(
        paragraphs=[{"text": limitation, "evidence_ids": []}], needs_clarification=True
    )
    result = bind_answer(
        answer, [], [], allowed_actions=[], can_claim_optimal=False, bot_id="remote-weather"
    )
    assert result["paragraphs"][0]["text"] == limitation


def test_remote_action_scope_rejects_wrong_metric_and_layer_product():
    assert bot_scope.action_allowed("remote-soil", "remote_sensing.fact", "surface_soil_moisture")
    assert not bot_scope.action_allowed("remote-soil", "remote_sensing.fact", "rainfall_total")
    assert not bot_scope.action_allowed(
        "remote-weather", "remote_sensing.fact", "surface_soil_moisture"
    )
    assert bot_scope.layer_allowed("remote-soil", "SPL3SMP_E")
    assert not bot_scope.layer_allowed("remote-weather", "SPL3SMP_E")
    assert bot_scope.layer_allowed("remote-weather", "GPM_3IMERGDF")
    assert not bot_scope.action_allowed("remote-weather", "field.create")
    assert not bot_scope.action_allowed("remote-weather", "remote_sensing.fact", {"bad": "metric"})
