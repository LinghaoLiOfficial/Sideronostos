"""Agronomy provenance and candidate limits, using labelled synthetic weather."""

from datetime import date, timedelta

import pytest

from sideronostos_backend.modules.rotation_optimizer.prepare import generate_candidates
from sideronostos_backend.modules.rotation_optimizer.profiles import ProfileV2, get_profile
from sideronostos_backend.modules.rotation_optimizer.schemas import PlanningField


def test_benchmark_parameters_are_explicit_and_every_origin_resolves():
    profile = get_profile("iowa-benchmark-20261112-v1")
    assert profile.scope == "benchmark_not_locally_calibrated"
    assert profile.sources["B_PHENOLOGY"].kind == "benchmark_assumption"
    maize = next(c for c in profile.crops if c.id == "maize")
    assert maize.gdd_required == pytest.approx(2670 / 1.8)
    assert maize.parameter_origins["gdd_required"] == "KSTATE_CORN"
    body = profile.model_dump(mode="json")
    del body["sources"]["B_PHENOLOGY"]
    with pytest.raises(ValueError, match="source"):
        ProfileV2.model_validate(body)


def test_candidate_limit_is_explicit_and_unmatured_crops_are_not_fabricated():
    p = get_profile("iowa-benchmark-20261112-v1")
    start = date(2027, 1, 1)
    end = date(2027, 12, 31)
    weather = {
        start + timedelta(days=i): {"tmin_c": 12, "tmax_c": 24, "rain_mm": 2, "et0_mm": 4}
        for i in range(365)
    }
    fields = [PlanningField(id="f", area_ha=2, irrigation_available=True)]
    result = generate_candidates(
        profile=p,
        fields=fields,
        start=start,
        end=end,
        weather=weather,
        allowed_crop_ids=["maize", "pea"],
    )
    assert result["candidates"]
    assert all(c.crop_id in ("maize", "pea") for c in result["candidates"])
    assert result["sampling_step_days"] == 14
    with pytest.raises(ValueError, match="candidate limit"):
        generate_candidates(
            profile=p,
            fields=fields,
            start=start,
            end=end,
            weather=weather,
            allowed_crop_ids=["maize", "pea"],
            max_candidates=1,
        )
    with pytest.raises(ValueError, match="Unknown crop"):
        generate_candidates(
            profile=p,
            fields=fields,
            start=start,
            end=end,
            weather=weather,
            allowed_crop_ids=["invented"],
        )


def test_scientific_verifier_rebuilds_water_and_maturity_independently(monkeypatch):
    from sideronostos_backend.modules.rotation_optimizer import candidates as generator
    from sideronostos_backend.modules.rotation_optimizer.scientific_verify import (
        verify_scientific_candidates,
    )

    p = get_profile("iowa-benchmark-20261112-v1")
    start = date(2027, 1, 1)
    end = date(2027, 12, 31)
    weather = {
        start + timedelta(days=i): {"tmin_c": 12, "tmax_c": 24, "rain_mm": 2, "et0_mm": 4}
        for i in range(365)
    }
    generated = generate_candidates(
        profile=p,
        fields=[PlanningField(id="f", area_ha=2, irrigation_available=True)],
        start=start,
        end=end,
        weather=weather,
        allowed_crop_ids=["pea"],
    )
    candidate = generated["candidates"][0]
    monkeypatch.setattr(
        generator, "make_candidate", lambda **_: pytest.fail("Verifier reused candidate generator")
    )
    monkeypatch.setattr(
        generator, "stage_kc", lambda *_: pytest.fail("Verifier reused coefficient generator")
    )
    good = verify_scientific_candidates(p, [candidate], weather)
    assert good["valid"]
    forged = candidate.model_copy(update={"water_mm": [v + 1 for v in candidate.water_mm]})
    bad = verify_scientific_candidates(p, [forged], weather)
    assert not bad["valid"] and any("water" in v for v in bad["violations"])
    late = candidate.model_copy(
        update={
            "harvest_date": candidate.harvest_date + timedelta(days=1),
            "water_mm": [*candidate.water_mm, 0],
        }
    )
    assert not verify_scientific_candidates(p, [late], weather)["valid"]


def test_execution_keeps_infeasible_user_baseline_separate_from_optimized_options():
    from sideronostos_backend.modules.rotation_optimizer.execution import execute_snapshot

    p = get_profile("iowa-benchmark-20261112-v1")
    start = date(2025, 1, 1)
    source = {
        "latitude": 42,
        "longitude": -93.5,
        "elevation_m": 310,
        "units": {"ALLSKY_SFC_SW_DWN": "MJ/m^2/day"},
        "source_kind": "synthetic_test_only",
        "days": [
            {
                "date": (start + timedelta(days=i)).isoformat(),
                "tmin_c": 12,
                "tmax_c": 24,
                "tdew_c": 10,
                "rain_mm": 2,
                "wind_2m_ms": 2,
                "pressure_kpa": 97,
                "shortwave": 15,
            }
            for i in range(365)
        ],
    }
    request = {
        "idempotency_key": "baseline-test",
        "profile_id": p.id,
        "fields": [{"id": "f", "expected_version": 1, "history_reviewed": True}],
        "start": "2027-01-01",
        "end": "2028-12-31",
        "allowed_crop_ids": ["maize", "pea"],
        "farm_limits": {
            str(y): {"water_m3": 50000, "cost_usd": 10000, "labor_days": 100} for y in (2027, 2028)
        },
        "accept_benchmark_assumptions": True,
        "baseline": [
            {"field_id": "f", "crop_id": "maize", "sow_date": f"{y}-04-20"} for y in (2027, 2028)
        ],
    }
    result = execute_snapshot(
        {
            "request": request,
            "profile": p.model_dump(mode="json"),
            "weather": source,
            "planning_fields": [{"id": "f", "area_ha": 2, "irrigation_available": True}],
        }
    )
    assert result["status"] == "optimal" and result["options"]
    assert result["baseline"]["complete"] and not result["baseline"]["feasible"]
    assert any(
        v.startswith(("family_gap", "sequence"))
        for v in result["baseline"]["verification"]["violations"]
    )
    assert all(o["verification"]["valid"] for o in result["options"])
