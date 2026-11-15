"""Readiness distinguishes unknown data from an explicit, sourced zero capacity."""

import importlib
import importlib.util
from datetime import date

import pytest

ROOT = "sideronostos_backend.modules.rotation_optimizer.v3"


def module():
    assert importlib.util.find_spec(ROOT + ".readiness") is not None, "v3 readiness is missing"
    return importlib.import_module(ROOT + ".readiness")


def assess(value=0, **changes):
    m = module()
    source = dict(
        id="farmer",
        kind="farmer_record",
        title="Confirmed pump log",
        locator="farm log #1",
        region_id="trial-region",
        observed_start="2025-01-01",
        observed_end="2025-12-31",
        applicable_start="2027-01-01",
        applicable_end="2027-12-31",
        quality="confirmed",
        confirmed=True,
        limitations=["Net capacity only; no claim of future rainfall."],
    )
    source.update(changes.pop("source", {}))
    record = dict(
        value=value,
        unit="m3/day",
        source_ids=["farmer"],
        missing_reason="No confirmed capacity" if value is None else None,
    )
    record.update(changes.pop("record", {}))
    args = dict(
        requirements=[
            m.Requirement(
                path="farm.water.capacity",
                unit="m3/day",
                value_kind="number",
                minimum=0,
                features=["water_resources"],
                enforce_applicability_dates=True,
            )
        ],
        values={"farm.water.capacity": m.RecordedValue(**record)},
        sources={"farmer": m.EvidenceSource(**source)},
        region_id="trial-region",
        start=date(2027, 1, 1),
        end=date(2027, 12, 31),
        enabled_features={"water_resources"},
        accept_engineering_assumptions=False,
    )
    args.update(changes)
    return m.assess_readiness(**args)


def test_confirmed_zero_is_ready_but_missing_never_becomes_zero():
    ready = assess(0)
    assert ready["ready"] is True
    assert ready["items"][0]["value"] == 0
    missing = assess(None)
    assert missing["ready"] is False
    assert missing["items"][0]["value"] is None
    assert missing["items"][0]["missing_reason"] == "No confirmed capacity"
    assert missing["blocked_features"] == ["water_resources"]


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"record": {"unit": "mm"}}, "unit_mismatch"),
        ({"record": {"source_ids": ["unknown"]}}, "source_missing"),
        ({"source": {"confirmed": False}}, "confirmation_required"),
        ({"source": {"quality": "rejected"}}, "quality_rejected"),
        ({"source": {"region_id": "another-region"}}, "outside_region"),
        ({"source": {"applicable_end": "2027-10-01"}}, "outside_time_scope"),
        ({"source": {"kind": "engineering_assumption"}}, "engineering_assumption_unaccepted"),
        ({"record": {"value": True}}, "invalid_value"),
        ({"record": {"value": -1}}, "invalid_value"),
        ({"record": {"value": "0"}}, "invalid_value"),
    ],
)
def test_unusable_operating_inputs_have_specific_blocking_reasons(change, reason):
    report = assess(**change)
    assert not report["ready"]
    assert reason in report["items"][0]["issues"]


def test_historical_observation_dates_are_not_mislabeled_as_planning_forecasts():
    report = assess(20)
    source = report["items"][0]["sources"][0]
    assert source["observed_end"] == "2025-12-31"
    assert source["applicable_start"] == "2027-01-01"
    assert source["limitations"]


def test_disabled_optional_metric_is_unavailable_not_zero_or_blocking():
    report = assess(None, enabled_features=set())
    assert report["ready"]
    assert report["items"][0]["status"] == "not_enabled"
    assert report["items"][0]["value"] is None
    assert report["items"][0]["missing_reason"]


def test_engineering_source_can_only_pass_with_explicit_assumption_acknowledgement():
    report = assess(source={"kind": "engineering_assumption"}, accept_engineering_assumptions=True)
    assert report["ready"]
    assert report["items"][0]["engineering_assumption"]
    assert "not_field_calibrated" in report["items"][0]["warnings"]


def test_missing_record_and_nonfinite_values_are_never_ready():
    assert not assess(values={})["ready"]
    assert not assess(record={"value": float("inf")})["ready"]
    m = module()
    with pytest.raises(ValueError):
        m.RecordedValue(value=None, unit="m3/day", source_ids=[])
    with pytest.raises(ValueError):
        m.EvidenceSource(
            id="x",
            kind="farmer_record",
            title="Log",
            locator="log",
            region_id="x",
            observed_start="2025-12-31",
            observed_end="2025-01-01",
            quality="confirmed",
            confirmed=True,
            limitations=["test"],
        )
