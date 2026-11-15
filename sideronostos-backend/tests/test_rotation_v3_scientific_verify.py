"""Independent oracle must catch a corrupted persisted scientific trace."""

import importlib
import importlib.util
from copy import deepcopy
from datetime import date, timedelta

import pytest

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def fixture():
    assert importlib.util.find_spec(ROOT + ".scientific_verify") is not None, (
        "v3 independent science verifier missing"
    )
    c = importlib.import_module(ROOT + ".contracts")
    s = importlib.import_module(ROOT + ".science")
    inputs = dict(
        phenology=c.Phenology(
            base_c=10,
            upper_c=30,
            maturity_gdd=15,
            gdd_recipe="draft_one_sided_v1",
            max_growing_days=10,
            turnaround_days=2,
        ),
        canopy=c.Canopy(
            kc=[1, 1, 1],
            stage_fractions=[0.25] * 4,
            root_initial_m=1,
            root_max_m=1,
            depletion_fraction=[0.5] * 4,
            cover_start_fraction=0.25,
            residue_cover_days=0,
        ),
        soil=c.SoilWater(field_capacity=0.3, wilting_point=0.2, depth_m=1),
        initial=c.InitialWater(
            policy="independent_wilting_point_v1", confirmed=True, evidence_id="dry-fixture"
        ),
        sow=date(2025, 7, 1),
        end=date(2025, 7, 10),
        effective_rain_fraction=0.8,
        weather={
            date(2025, 7, 1) + timedelta(days=i): dict(tmin_c=10, tmax_c=20, et0_mm=5, rain_mm=2)
            for i in range(10)
        },
    )
    result = s.prepare_growth(**inputs)
    return importlib.import_module(ROOT + ".scientific_verify"), inputs, result


def test_declared_candidate_science_is_independently_recomputed():
    verifier, inputs, result = fixture()
    assert result["reason"] is None
    assert result["water_mm"] == pytest.approx([53.4, 3.4, 3.4])
    assert result["cover_mask"] == [False, True, True, False, False]
    check = verifier.verify_growth(**inputs, result=result)
    assert check["valid"]
    assert check["water_mm"] == pytest.approx(60.2)
    assert check["first_maturity"] == "2025-07-03"


@pytest.mark.parametrize(
    "corruption",
    [
        "water",
        "cover",
        "harvest",
        "initial",
        "taw",
        "root",
        "drainage",
        "recipe",
        "gdd_trace",
        "initial_metadata",
        "soil_metadata",
        "rain_metadata",
        "duration",
        "daily_recipe",
    ],
)
def test_corrupt_scientific_snapshot_is_rejected(corruption):
    verifier, inputs, result = fixture()
    result = deepcopy(result)
    if corruption == "water":
        result["water_mm"][0] -= 1
    elif corruption == "cover":
        result["cover_mask"][-1] = True
    elif corruption == "harvest":
        result["harvest_date"] += timedelta(days=1)
    elif corruption == "initial":
        result["trace"]["water_days"][0]["depletion_before_mm"] = 0
    elif corruption == "taw":
        result["trace"]["water_days"][1]["taw_mm"] += 5
    elif corruption == "root":
        result["trace"]["water_days"][1]["root_depth_m"] = 2
    elif corruption == "drainage":
        result["trace"]["water_days"][1]["drainage_mm"] = 10
    elif corruption == "recipe":
        result["trace"]["water_recipe"] = "legacy_daily_rain_gap"
    elif corruption == "gdd_trace":
        result["trace"]["phenology_days"][0]["gdd"] = 0
    elif corruption == "initial_metadata":
        result["trace"]["initial_condition"]["policy"] = "free_initial_water"
    elif corruption == "soil_metadata":
        result["trace"]["soil_water"]["field_capacity"] = 0.9
    elif corruption == "rain_metadata":
        result["trace"]["effective_rain_fraction"] = 1
    elif corruption == "duration":
        result["growing_days"] = 100
    elif corruption == "daily_recipe":
        result["trace"]["water_days"][0]["recipe"] = "fake"
    assert not verifier.verify_growth(**inputs, result=result)["valid"]


def test_missing_water_driver_blocks_preparation_instead_of_zero_filling():
    _, inputs, _ = fixture()
    inputs["weather"][date(2025, 7, 2)]["et0_mm"] = None
    result = importlib.import_module(ROOT + ".science").prepare_growth(**inputs)
    assert result["reason"] == "missing_weather"
    assert result["date"] == date(2025, 7, 2)
    assert "water_mm" not in result
