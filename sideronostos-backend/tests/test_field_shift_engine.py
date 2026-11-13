"""Domain contract: feasibility always precedes ranking and unsupported data stays unknown."""

from datetime import UTC, datetime
from importlib import import_module

import pytest
from pydantic import ValidationError


def domain():
    try:
        return tuple(
            import_module(f"sideronostos_backend.modules.field_shift.{name}")
            for name in ("schemas", "profiles", "engine")
        )
    except ModuleNotFoundError as exc:
        pytest.fail(f"The required rotation domain has not been implemented: {exc}")


def setup_case(**overrides):
    s, p, e = domain()
    profile = p.get_profiles()[0]
    field = s.Field(
        id="field-1",
        version=1,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        name="Demo field",
        area_ha=2,
        latitude=41.5,
        longitude=-93.6,
        soil_texture="loam",
        irrigation_available=True,
        profile_id=profile.id,
        history=[],
    )
    environment = s.Environment(
        status="demo",
        source_name="Test synthetic weather",
        source_url=None,
        reference_year=2025,
        fetched_at=None,
        spatial_resolution="synthetic",
        months=[
            dict(
                month=m,
                rainfall_mm=60,
                tmin_c=10,
                tmax_c=24,
                reference_et_mm=100,
                valid_days=30,
                expected_days=30,
            )
            for m in range(1, 13)
        ],
        limitations=["Synthetic test weather"],
        evidence=[],
        fingerprint="synthetic-test",
    )
    values = dict(
        start_year=2027,
        baseline_crop_ids=["maize"] * 3,
        allowed_crop_ids=[c.id for c in profile.crops],
        max_irrigation_mm=1000,
        max_cost_usd_ha=10000,
        max_labor_days_ha=100,
        weights=dict(water=1, cover=1, diversity=1, cost=1),
        scenario=dict(rainfall_change_pct=0, temperature_change_c=0),
        accept_demo_assumptions=True,
    )
    values.update(overrides)
    return s, profile, field, environment, s.PlanningInputs(**values), e


def test_configured_profile_has_traceable_demo_assumptions():
    _, profile, *_ = setup_case()
    assert profile.is_demo and profile.version and len(profile.crops) == 6
    assert profile.assumptions
    source_ids = {source.id for source in profile.sources}
    assert all(c.source_ids and set(c.source_ids) <= source_ids for c in profile.crops)
    assert profile.rules


def test_baseline_is_retained_with_violations_and_only_feasible_alternatives_ranked():
    _, p, f, env, inputs, e = setup_case()
    result = e.generate_options(f, p, env, inputs)
    assert result.baseline.is_baseline and not result.baseline.feasible
    assert result.baseline.violations
    assert len(result.alternatives) == 2
    assert all(o.feasible and not o.is_baseline and not o.violations for o in result.alternatives)
    assert all(
        [s.crop_id for s in o.seasons] != inputs.baseline_crop_ids for o in result.alternatives
    )
    assert result.feasible_count + result.rejected_count == 216
    assert result.rejection_summary


def test_missing_history_is_explicit_and_comparison_units_cover_same_three_years():
    _, p, f, env, inputs, e = setup_case()
    result = e.generate_options(f, p, env, inputs)
    assert any("种植历史" in text for text in result.limitations)
    for option in [result.baseline, *result.alternatives]:
        assert [s.year for s in option.seasons] == [2027, 2028, 2029]
        assert option.metrics.cost_usd_ha == pytest.approx(
            sum(s.cost_usd_ha for s in option.seasons), abs=0.02
        )
        assert option.metrics.cover_days == sum(s.cover_days for s in option.seasons)
        assert option.metrics.diversity == len({s.family for s in option.seasons})
        assert option.evidence and option.reasons
        assert all(s.sow_date <= s.harvest_date for s in option.seasons)


def test_history_excludes_prohibited_first_crop_before_ranking():
    s, p, f, env, inputs, e = setup_case()
    f = f.model_copy(update={"history": [s.HistoryEntry(year=2026, crop_id="maize")]})
    result = e.generate_options(f, p, env, inputs)
    assert all(o.seasons[0].family != "Poaceae" for o in result.alternatives)
    assert any(v.rule_id == "family_gap" for v in result.baseline.violations)


def test_zero_water_and_no_irrigation_are_not_overridden_by_positive_weight_or_budget():
    _, p, f, env, inputs, e = setup_case(max_irrigation_mm=0)
    env = env.model_copy(
        update={"months": [m.model_copy(update={"rainfall_mm": 0}) for m in env.months]}
    )
    result = e.generate_options(f, p, env, inputs)
    assert result.alternatives == [] and result.feasible_count == 0
    assert any(r.rule_id == "water_limit" for r in result.rejection_summary)
    f = f.model_copy(update={"irrigation_available": False})
    inputs = inputs.model_copy(update={"max_irrigation_mm": 1000})
    result = e.generate_options(f, p, env, inputs)
    assert not result.baseline.feasible and not result.alternatives
    assert any(r.rule_id == "water_limit" for r in result.rejection_summary)


def test_budget_and_labor_constraints_filter_before_scoring():
    _, p, f, env, inputs, e = setup_case(max_cost_usd_ha=0, max_labor_days_ha=0)
    result = e.generate_options(f, p, env, inputs)
    assert result.feasible_count == 0 and not result.alternatives
    assert {r.rule_id for r in result.rejection_summary} >= {"cost_limit", "labor_limit"}


def test_unknown_soil_is_missing_evidence_but_known_incompatible_soil_rejects():
    _, p, f, env, inputs, e = setup_case(allowed_crop_ids=["maize", "soybean", "potato"])
    f = f.model_copy(update={"soil_texture": "clay"})
    result = e.generate_options(f, p, env, inputs)
    assert all(s.crop_id != "potato" for o in result.alternatives for s in o.seasons)
    assert any(r.rule_id == "soil_compatibility" for r in result.rejection_summary)
    f = f.model_copy(update={"soil_texture": "unknown"})
    result = e.generate_options(f, p, env, inputs)
    assert any("土壤" in text for text in result.limitations)


def test_scenario_recalculates_temperature_and_rainfall_for_same_baseline():
    s, p, f, env, inputs, e = setup_case()
    normal = e.generate_options(f, p, env, inputs)
    changed = inputs.model_copy(
        update={"scenario": s.Scenario(rainfall_change_pct=-50, temperature_change_c=3)}
    )
    dry = e.generate_options(f, p, env, changed)
    assert dry.baseline.metrics.irrigation_gap_mm > normal.baseline.metrics.irrigation_gap_mm
    assert dry.baseline.metrics.water_demand_mm > normal.baseline.metrics.water_demand_mm
    assert dry.baseline.metrics.cost_usd_ha == normal.baseline.metrics.cost_usd_ha


def test_weights_change_ranking_without_changing_feasibility():
    s, p, f, env, inputs, e = setup_case()
    a = e.generate_options(
        f,
        p,
        env,
        inputs.model_copy(update={"weights": s.Weights(water=0, cover=0, diversity=0, cost=5)}),
    )
    b = e.generate_options(
        f,
        p,
        env,
        inputs.model_copy(update={"weights": s.Weights(water=0, cover=5, diversity=0, cost=0)}),
    )
    assert a.feasible_count == b.feasible_count
    assert a.alternatives[0].metrics.cost_usd_ha <= b.alternatives[0].metrics.cost_usd_ha
    assert b.alternatives[0].metrics.cover_days >= a.alternatives[0].metrics.cover_days
    assert a.alternatives[0].id != b.alternatives[0].id


def test_no_fake_alternatives_when_only_prohibited_monoculture_is_allowed():
    _, p, f, env, inputs, e = setup_case(allowed_crop_ids=["maize"])
    result = e.generate_options(f, p, env, inputs)
    assert result.alternatives == []
    assert result.feasible_count == 0 and result.rejected_count == 1


@pytest.mark.parametrize("location", ["baseline", "allowed", "history"])
def test_unknown_crop_ids_are_rejected_explicitly(location):
    s, p, f, env, inputs, e = setup_case()
    if location == "history":
        f = f.model_copy(update={"history": [s.HistoryEntry(year=2026, crop_id="unknown")]})
    elif location == "baseline":
        inputs = inputs.model_copy(update={"baseline_crop_ids": ["unknown", "maize", "maize"]})
    else:
        inputs = inputs.model_copy(update={"allowed_crop_ids": ["unknown"]})
    with pytest.raises(ValueError):
        e.generate_options(f, p, env, inputs)


def test_history_in_planning_horizon_and_demo_without_acceptance_are_rejected():
    s, p, f, env, inputs, e = setup_case()
    f = f.model_copy(update={"history": [s.HistoryEntry(year=2027, crop_id="maize")]})
    with pytest.raises(ValueError):
        e.generate_options(f, p, env, inputs)
    f = f.model_copy(update={"history": []})
    with pytest.raises(ValueError):
        e.generate_options(f, p, env, inputs.model_copy(update={"accept_demo_assumptions": False}))


def test_missing_weather_does_not_become_zero_or_a_feasible_recommendation():
    _, p, f, env, inputs, e = setup_case()
    env = env.model_copy(
        update={"months": [m.model_copy(update={"rainfall_mm": None}) for m in env.months]}
    )
    with pytest.raises(ValueError):
        e.generate_options(f, p, env, inputs)


@pytest.mark.parametrize(
    "field,value", [("latitude", float("nan")), ("area_ha", 0), ("longitude", 181), ("name", "  ")]
)
def test_field_boundary_rejects_invalid_values(field, value):
    s, _, f, *_ = setup_case()
    values = f.model_dump(exclude={"id", "version", "created_at", "updated_at"})
    values[field] = value
    with pytest.raises(ValidationError):
        s.FieldInput(**values)


def test_planning_input_rejects_empty_crops_bad_horizon_weights_and_extra_fields():
    s, _, _, _, inputs, _ = setup_case()
    for override in (
        {"allowed_crop_ids": []},
        {"baseline_crop_ids": ["maize"]},
        {"weights": dict(water=0, cover=0, diversity=0, cost=0)},
        {"max_irrigation_mm": -1},
        {"secret_score": 5},
    ):
        with pytest.raises(ValidationError):
            s.PlanningInputs(**(inputs.model_dump() | override))


def test_baseline_metrics_use_per_hectare_three_year_totals_not_field_area_scaling():
    _, p, f, env, inputs, e = setup_case()
    result = e.generate_options(f, p, env, inputs)
    assert result.baseline.metrics.cost_usd_ha == 2550
    assert result.baseline.metrics.labor_days_ha == 21
    assert result.baseline.metrics.cover_days == 450
    bigger = e.generate_options(f.model_copy(update={"area_ha": 50}), p, env, inputs)
    assert bigger.baseline.metrics == result.baseline.metrics


def test_calendar_crossing_year_is_a_hard_violation():
    _, p, f, env, inputs, e = setup_case(allowed_crop_ids=["maize"])
    changed = [c.model_copy(update={"sow_month": 12}) if c.id == "maize" else c for c in p.crops]
    p = p.model_copy(update={"crops": changed})
    result = e.generate_options(f, p, env, inputs)
    assert not result.baseline.feasible and not result.alternatives
    assert any(v.rule_id == "annual_calendar" for v in result.baseline.violations)


def test_rule_configuration_changes_feasibility_and_history_is_checked_by_year_gap():
    s, p, f, env, inputs, e = setup_case(allowed_crop_ids=["maize"])
    # Zero intervening years allows annual return; no hidden species/family table overrides it.
    relaxed = [
        r.model_copy(update={"parameters": {"intervening_years": 0}})
        if r.kind in {"crop_gap", "family_gap"}
        else r
        for r in p.rules
    ]
    result = e.generate_options(f, p.model_copy(update={"rules": relaxed}), env, inputs)
    assert result.baseline.feasible and result.feasible_count == 1 and result.alternatives == []
    # A much older historical planting does not trigger a current return-interval violation.
    f = f.model_copy(update={"history": [s.HistoryEntry(year=2020, crop_id="maize")]})
    result = e.generate_options(f, p, env, inputs)
    assert not any(
        v.message.startswith("2027 ") and v.rule_id == "crop_gap"
        for v in result.baseline.violations
    )


def test_invalid_rule_or_profile_or_calendar_fails_explicitly():
    s, p, f, env, inputs, e = setup_case()
    invalid = s.Rule(
        id="bad",
        name="Unsupported",
        description="Not implemented",
        kind="yield_prediction",
        parameters={},
    )
    with pytest.raises(ValueError):
        e.generate_options(f, p.model_copy(update={"rules": [*p.rules, invalid]}), env, inputs)
    with pytest.raises(ValueError):
        e.generate_options(f.model_copy(update={"profile_id": "missing"}), p, env, inputs)
    bad_calendar = [
        c.model_copy(update={"sow_month": 2, "sow_day": 30}) if c.id == "maize" else c
        for c in p.crops
    ]
    with pytest.raises(ValueError):
        e.generate_options(f, p.model_copy(update={"crops": bad_calendar}), env, inputs)


def test_duplicate_history_and_extra_input_values_are_rejected():
    s, _, f, *_ = setup_case()
    data = f.model_dump(exclude={"id", "version", "created_at", "updated_at"})
    with pytest.raises(ValidationError):
        s.FieldInput(**(data | {"history": [{"year": 2026, "crop_id": "maize"}] * 2}))
    with pytest.raises(ValidationError):
        s.FieldInput(**(data | {"trusted": True}))


def test_weather_with_no_valid_days_cannot_drive_a_recommendation():
    _, p, f, env, inputs, e = setup_case()
    env = env.model_copy(
        update={
            "status": "live",
            "months": [m.model_copy(update={"valid_days": 0}) for m in env.months],
        }
    )
    with pytest.raises(ValueError):
        e.generate_options(f, p, env, inputs)


def test_second_alternative_exposes_a_distinct_tradeoff_when_available():
    # Returning the first two sequence permutations hides useful comparison choices.
    _, p, f, env, inputs, e = setup_case()
    result = e.generate_options(f, p, env, inputs)
    assert len(result.alternatives) == 2
    assert result.alternatives[0].metrics != result.alternatives[1].metrics
    assert result.feasible_count == 88 and result.rejected_count == 128
    assert any("取舍" in reason for reason in result.alternatives[1].reasons)


def test_equal_metric_sequences_are_retained_with_an_explicit_tie_explanation():
    # In a deliberately identical-parameter catalogue, inventing metric differences is wrong.
    _, p, f, env, inputs, e = setup_case(allowed_crop_ids=["maize", "soybean", "sunflower"])
    identical = [
        crop.model_copy(
            update={
                "sow_month": 4,
                "sow_day": 1,
                "duration_days": 90,
                "kc": 1,
                "estimated_cost_usd_ha": 100,
                "estimated_labor_days_ha": 5,
            }
        )
        for crop in p.crops
    ]
    result = e.generate_options(f, p.model_copy(update={"crops": identical}), env, inputs)
    assert len(result.alternatives) == 2
    assert result.alternatives[0].id != result.alternatives[1].id
    assert result.alternatives[0].metrics == result.alternatives[1].metrics
    assert result.feasible_count == 6 and result.rejected_count == 21
    assert any("汇总估计相同" in reason for reason in result.alternatives[1].reasons)


def test_representative_comparison_uses_a_different_crop_mix_with_demo_weather():
    from sideronostos_backend.modules.field_shift.environment import demo_environment

    _, p, f, _, inputs, e = setup_case()
    env = demo_environment(f.latitude, f.longitude, 2025, "Offline test")
    result = e.generate_options(f, p, env, inputs)
    first, second = result.alternatives
    assert sorted(s.crop_id for s in first.seasons) != sorted(s.crop_id for s in second.seasons)
    assert first.metrics != second.metrics


def test_different_crop_mix_is_preferred_even_when_its_metrics_tie():
    _, p, f, env, inputs, e = setup_case(
        allowed_crop_ids=["maize", "soybean", "sunflower", "potato"]
    )
    identical = [
        crop.model_copy(
            update={
                "sow_month": 4,
                "sow_day": 1,
                "duration_days": 90,
                "kc": 1,
                "estimated_cost_usd_ha": 100,
                "estimated_labor_days_ha": 5,
            }
        )
        for crop in p.crops
    ]
    result = e.generate_options(f, p.model_copy(update={"crops": identical}), env, inputs)
    first, second = result.alternatives
    assert first.metrics == second.metrics
    assert sorted(s.crop_id for s in first.seasons) != sorted(s.crop_id for s in second.seasons)
    assert any("汇总估计相同" in reason for reason in second.reasons)
