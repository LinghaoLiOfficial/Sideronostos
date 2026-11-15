"""Hand-calculated fixtures, not field-calibrated agronomic recommendations."""

import importlib
import importlib.util
from datetime import date, timedelta

import pytest

ROOT = "sideronostos_backend.modules.rotation_optimizer"


def modules():
    assert importlib.util.find_spec(ROOT + ".v3") is not None, "versioned v3 computation is missing"
    return importlib.import_module(ROOT + ".v3.science"), importlib.import_module(
        ROOT + ".v3.contracts"
    )


def balance(**changes):
    science, contracts = modules()
    inputs = dict(
        soil=contracts.SoilWater(field_capacity=0.30, wilting_point=0.20, depth_m=1),
        initial=contracts.InitialWater(
            policy="independent_wilting_point_v1",
            confirmed=True,
            evidence_id="benchmark-dry-initial",
        ),
        et0_mm=[10, 10, 10],
        rain_mm=[0, 0, 30],
        kc=[1, 1, 1],
        root_depth_m=[1, 1, 1],
        depletion_fraction=[0.5, 0.5, 0.5],
        effective_rain_fraction=[1, 1, 1],
    )
    inputs.update(changes)
    return science.root_water_balance(**inputs)


def test_wilting_initial_state_is_charged_and_rain_is_stored():
    days = balance()
    assert [d["taw_mm"] for d in days] == pytest.approx([100, 100, 100])
    assert [d["raw_mm"] for d in days] == pytest.approx([50, 50, 50])
    assert [d["nir_mm"] for d in days] == pytest.approx([60, 10, 0])
    assert [d["depletion_after_mm"] for d in days] == pytest.approx([50, 50, 30])
    assert days[0]["depletion_before_mm"] == pytest.approx(100)


def test_new_root_volume_has_explicit_dry_depletion_no_free_water():
    days = balance(et0_mm=[0, 0, 0], rain_mm=[0, 0, 0], root_depth_m=[0.5, 1, 2])
    assert [d["root_depth_m"] for d in days] == [0.5, 1, 1]  # cap at measured soil depth
    assert [d["root_expansion_depletion_mm"] for d in days] == pytest.approx([0, 50, 0])
    assert [d["nir_mm"] for d in days] == pytest.approx([25, 25, 0])
    assert sum(d["nir_mm"] for d in days) == pytest.approx(50)


def test_heavy_rain_cannot_create_negative_depletion_or_future_unlimited_credit():
    days = balance(et0_mm=[10, 10, 10], rain_mm=[1000, 0, 0])
    assert [d["depletion_after_mm"] for d in days] == pytest.approx([0, 10, 20])
    assert days[0]["drainage_mm"] == pytest.approx(890)
    assert sum(d["nir_mm"] for d in days) == 0


def test_each_independent_candidate_recharges_its_initial_condition():
    first = balance(rain_mm=[0, 0, 0])
    second = balance(rain_mm=[0, 0, 0])
    assert sum(d["nir_mm"] for d in first + second) == pytest.approx(160)
    assert all(d["initial_policy"] == "independent_wilting_point_v1" for d in first + second)


@pytest.mark.parametrize(
    "change",
    [
        {"rain_mm": [0, None, 0]},
        {"rain_mm": [0, -1, 0]},
        {"et0_mm": [float("nan"), 0, 0]},
        {"et0_mm": [True, 0, 0]},
        {"root_depth_m": [1, 0.5, 1]},
        {"kc": [1]},
        {"effective_rain_fraction": [1.1, 1, 1]},
        {"depletion_fraction": [0.5, 0, 0.5]},
    ],
)
def test_missing_or_invalid_inputs_never_become_zero(change):
    with pytest.raises(ValueError):
        balance(**change)


def test_soil_and_initial_assumptions_must_be_valid_and_explicit():
    _, c = modules()
    for args in [
        dict(field_capacity=0.2, wilting_point=0.3, depth_m=1),
        dict(field_capacity=0.3, wilting_point=0.2, depth_m=0),
    ]:
        with pytest.raises(ValueError):
            c.SoilWater(**args)
    for args in [
        dict(policy="independent_wilting_point_v1", confirmed=False, evidence_id="dry"),
        dict(policy="full_storage_each_crop", confirmed=True, evidence_id="dry"),
    ]:
        with pytest.raises(ValueError):
            c.InitialWater(**args)


def test_phenology_uses_paired_recipe_first_threshold_day_and_inclusive_turnaround():
    s, c = modules()
    p = c.Phenology(
        base_c=10,
        upper_c=30,
        maturity_gdd=15,
        gdd_recipe="draft_one_sided_v1",
        max_growing_days=10,
        turnaround_days=2,
    )
    start = date(2025, 7, 1)
    weather = {start + timedelta(days=i): {"tmin_c": 10, "tmax_c": 20} for i in range(10)}
    result = s.maturity(p, start, date(2025, 7, 5), weather)
    assert result["harvest_date"] == date(2025, 7, 3)
    assert result["occupied_until"] == date(2025, 7, 5)
    assert result["gdd_total"] == 15
    assert result["growing_days"] == 3
    assert s.maturity(p, start, date(2025, 7, 4), weather)["reason"] == "turnaround_outside_horizon"
    del weather[start + timedelta(days=1)]
    assert s.maturity(p, start, date(2025, 7, 5), weather)["reason"] == "missing_weather"


def test_gdd_recipe_cannot_silently_switch_when_temperature_exceeds_bounds():
    s, c = modules()
    args = dict(base_c=10, upper_c=30, maturity_gdd=23, max_growing_days=1, turnaround_days=0)
    day = date(2025, 7, 1)
    weather = {day: {"tmin_c": 40, "tmax_c": 50}}
    one_sided = s.maturity(c.Phenology(**args, gdd_recipe="draft_one_sided_v1"), day, day, weather)
    bounded = s.maturity(c.Phenology(**args, gdd_recipe="bounded_both_v1"), day, day, weather)
    assert one_sided["harvest_date"] == day
    assert bounded["reason"] == "maturity_unreached"


def test_stage_kc_root_growth_and_cover_are_separate_from_occupancy():
    s, c = modules()
    canopy = c.Canopy(
        kc=[0.4, 1.2, 0.6],
        stage_fractions=[0.25] * 4,
        root_initial_m=0.2,
        root_max_m=1,
        depletion_fraction=[0.5] * 4,
        cover_start_fraction=0.25,
        residue_cover_days=1,
    )
    stages = s.growth_stages(canopy, growing_days=8, turnaround_days=2)
    assert [d["kc"] for d in stages] == pytest.approx([0.4, 0.4, 0.6, 1, 1.2, 1.2, 1.05, 0.75])
    assert stages[0]["root_depth_m"] == 0.2
    assert stages[5]["root_depth_m"] == 1
    assert s.cover_days(canopy, growing_days=8, turnaround_days=2) == [
        False,
        False,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        False,
    ]


def test_six_objectives_require_positive_water_and_unit_sum():
    _, c = modules()
    good = dict(profit=0.2, water=0.2, rotation=0.1, soil=0.1, risk=0.2, bare=0.2)
    assert c.ObjectiveWeights(**good).water == 0.2
    for bad in [
        dict(good, water=0),
        dict(good, profit=-0.1),
        dict(good, profit=1),
        dict(good, soil=float("nan")),
    ]:
        with pytest.raises(ValueError):
            c.ObjectiveWeights(**bad)
