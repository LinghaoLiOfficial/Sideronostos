"""Explicit synthetic operating records; never used by the product as defaults."""

from datetime import UTC, datetime

PROFILE = "iowa-engineering-v3-20261114"


def record(value, unit="1"):
    return {"value": value, "unit": unit, "source_ids": ["farmer"]}


def capacity(value, unit):
    return {
        "amount": record(value, unit),
        "remediable": False,
        "gap_unit_cost": None,
        "remedy": None,
    }


def field():
    from sideronostos_backend.modules.field_shift.schemas import Field

    return Field(
        id="field-1",
        farm_id="farm-1",
        partition_revision="partition-1",
        local_id="local-1",
        version=1,
        name="Synthetic field",
        area_ha=2,
        latitude=42,
        longitude=-93.5,
        soil_texture="loam",
        irrigation_available=True,
        profile_id="temperate-demo",
        history=[],
        history_events=[],
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def draft():
    return {
        "profile_id": PROFILE,
        "fields": [{"id": "field-1", "expected_version": 1}],
        "start": "2027-01-01",
        "end": "2027-12-31",
        "allowed_crop_ids": ["maize", "pea"],
        "accept_engineering_assumptions": True,
        "sources": {
            "farmer": {
                "id": "farmer",
                "kind": "farmer_record",
                "title": "Synthetic test-only farm ledger",
                "locator": "test:ledger",
                "region_id": "iowa-engineering",
                "quality": "confirmed",
                "confirmed": True,
                "applicable_start": "2027-01-01",
                "applicable_end": "2027-12-31",
                "limitations": ["Synthetic unit test, not field measurements"],
            }
        },
        "field_conditions": {
            "field-1": {
                "values": {
                    "field_capacity": record(0.3, "m3/m3"),
                    "wilting_point": record(0.12, "m3/m3"),
                    "depth_m": record(1.0, "m"),
                    "ph": record(6.5, "pH"),
                    "salinity_ds_m": record(0.5, "dS/m"),
                    "drainage": record("well", "category"),
                    "slope_deg": record(2.0, "degree"),
                    "aspect": record("flat", "category"),
                    "terrain_position": record("level", "category"),
                    "mechanical_access": record(True),
                    "effective_rain_fraction": record(0.8),
                    "history_reviewed": record(True),
                    "history_state": record("no_prior_crop", "category"),
                    "history_absence_reason": record(
                        "Newly established field; prior uncropped status confirmed", "text"
                    ),
                    "initial_water_policy": record("independent_wilting_point_v1", "category"),
                    "management_reviewed": record(True),
                    "baseline_confirmed": record(True),
                },
                "water_system_id": "water-1",
                "forbidden_crop_ids": [],
                "bare_limit_disabled": "No statutory bare-day cap in this synthetic case",
            }
        },
        "periods": [{"id": "p1", "start": "2027-01-01", "end": "2027-12-31"}],
        "farm_resources": {
            "farm-1": {
                "daily": {
                    "water-1": {
                        "kind": "water",
                        "field_ids": ["field-1"],
                        "water_basis": "net",
                        "default": capacity(1000.0, "m3/day"),
                    },
                    "tractor-1": {
                        "kind": "machine",
                        "machine_type": "tractor",
                        "field_ids": ["field-1"],
                        "default": capacity(16.0, "h/day"),
                    },
                    "harvester-1": {
                        "kind": "machine",
                        "machine_type": "harvester",
                        "field_ids": ["field-1"],
                        "default": capacity(16.0, "h/day"),
                    },
                },
                "period_limits": [
                    {
                        "kind": kind,
                        "crop_id": crop,
                        "period_id": "p1",
                        "limit": capacity(100000.0, "kg"),
                    }
                    for kind in ["seed", "market"]
                    for crop in ["maize", "pea"]
                ],
            }
        },
        "baseline": [{"field_id": "field-1", "crop_id": "maize", "sow_date": "2027-04-20"}],
    }


def weather():
    from datetime import date, timedelta

    from sideronostos_backend.modules.agri_data.adapters.power import PARAMETERS

    start = date(2025, 1, 1)
    return {
        "release_id": "power-iowa-2025-v1",
        "manifest_sha256": "a" * 64,
        "latitude": 42.0,
        "longitude": -93.5,
        "elevation_m": 310.0,
        "start": "2025-01-01",
        "end": "2025-12-31",
        "time_standard": "UTC",
        "recipe": "fao56-daily-dewpoint-v1",
        "content_sha256": "b" * 64,
        "data_kind": "observed_historical",
        "source_kind": "synthetic_test_only",
        "units": {k: v[1] for k, v in PARAMETERS.items()},
        "days": [
            {
                "date": (start + timedelta(days=i)).isoformat(),
                "tmin_c": 12.0,
                "tmax_c": 24.0,
                "tdew_c": 10.0,
                "rain_mm": 2.0,
                "wind_2m_ms": 2.0,
                "pressure_kpa": 97.0,
                "shortwave": 15.0,
                "missing": [],
            }
            for i in range(365)
        ],
    }
