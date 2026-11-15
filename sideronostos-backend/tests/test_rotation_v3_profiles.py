"""Published v3 profiles must be auditable, bounded and region-specific."""

import importlib
import importlib.util
from copy import deepcopy

import pytest

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3.profiles"
PROFILE = "iowa-engineering-v3-20261114"


def module():
    assert importlib.util.find_spec(ROOT) is not None, "v3 application profiles are missing"
    return importlib.import_module(ROOT)


def test_published_profile_is_explicit_benchmark_with_units_and_sources():
    m = module()
    profile = m.get_profile(PROFILE)
    assert profile.scope == "benchmark_not_locally_calibrated"
    assert profile.timezone == "America/Chicago"
    assert set(profile.crops) == {"maize", "oat", "pea"}
    rows = m.parameter_records(profile)
    assert rows["crops.maize.canopy.root_max_m"].unit == "m"
    assert rows["crops.pea.seed_kg_ha"].unit == "kg/ha"
    assert rows["crops.maize.climate.heat_c"].unit == "degC"
    assert rows["crops.maize.economics.price_usd_kg"].unit == "USD/kg"
    assert all(row.source_ids for row in rows.values())
    assert any(s.kind == "engineering_assumption" for s in profile.sources.values())
    assert m.list_profiles()[0]["sha256"] == m.profile_hash(profile)


@pytest.mark.parametrize(
    "change",
    [
        lambda p: p["sources"].clear(),
        lambda p: p["parameter_origins"].pop("crops.maize"),
        lambda p: p["parameter_origins"].update({"crops.no-such-crop": ["engineering"]}),
        lambda p: p["crops"]["maize"]["phenology"].update({"gdd_recipe": "unknown"}),
        lambda p: p["crops"]["maize"].update({"sow_windows": [["11-01", "02-01"]]}),
        lambda p: p["crops"]["maize"].update({"sow_windows": [["02-29", "03-01"]]}),
        lambda p: p["crops"]["maize"]["soil"].update({"ph_min": 8, "ph_max": 6}),
        lambda p: p["crops"]["maize"]["risk_weights"].update({"heat": 0.9}),
        lambda p: p["history_catalogue"]["maize"].update({"species_id": "other"}),
        lambda p: p["family_gaps"].pop("Poaceae"),
        lambda p: p["transition_scores"]["maize"].pop("pea"),
        lambda p: p.update({"scope": "locally_calibrated"}),
        lambda p: p.update({"timezone": "made/up"}),
    ],
)
def test_invalid_or_unsourced_profile_cannot_publish(change):
    m = module()
    payload = deepcopy(m.get_profile(PROFILE).model_dump(mode="json"))
    change(payload)
    with pytest.raises(ValueError):
        m.ProfileV3.model_validate(payload)


def test_profile_hash_includes_sources_and_thresholds():
    m = module()
    profile = m.get_profile(PROFILE)
    changed = profile.model_dump(mode="json")
    changed["sources"]["engineering"]["limitations"].append("New limitation")
    assert m.profile_hash(profile) != m.profile_hash(m.ProfileV3.model_validate(changed))
    with pytest.raises(ValueError, match="Unknown"):
        m.get_profile("../../something")


def test_history_compatibility_is_declared_not_guessed():
    p = module().get_profile(PROFILE)
    assert "iowa-benchmark-20261112-v1" in p.compatible_history_profile_ids
    assert p.history_catalogue["maize"].species_id == "zea-mays"
    assert p.history_catalogue["wheat"].family == "Poaceae"
