import json
from datetime import date
from pathlib import Path

import pytest

from sideronostos_backend.modules.agri_data.models import ScienceRelease
from sideronostos_backend.modules.agri_data.nasa_release import build_nasa_release
from sideronostos_backend.modules.rotation_optimizer.candidates import historical_weather
from sideronostos_backend.modules.rotation_optimizer.requests import RunRequest


def request_body(**changes: object) -> dict[str, object]:
    body: dict[str, object] = {
        "idempotency_key": "nasa-test-key",
        "profile_id": "iowa-benchmark-20261112-v1",
        "fields": [
            {
                "id": "field-1",
                "expected_version": 1,
                "require_crop": True,
                "history_reviewed": True,
            }
        ],
        "start": "2022-01-01",
        "end": "2024-12-31",
        "allowed_crop_ids": ["maize"],
        "sow_windows": {},
        "farm_limits": {
            year: {"water_m3": 1, "cost_usd": 1, "labor_days": 1} for year in (2022, 2023, 2024)
        },
        "field_limits": {},
        "weights": None,
        "scenario": {"temperature_change_c": 0, "rainfall_change_pct": 0},
        "baseline": [],
        "accept_benchmark_assumptions": True,
        "data_release_id": "iowa-nasa-2022-2024-v1",
        "horizon_mode": "3y",
        "max_options": 3,
        "solver_time_limit_seconds": 30,
    }
    body.update(changes)
    return body


def test_nasa_request_requires_complete_calendar_horizon() -> None:
    assert RunRequest.model_validate(request_body()).horizon_mode == "3y"
    with pytest.raises(ValueError, match="complete calendar years"):
        RunRequest.model_validate(request_body(end="2024-11-30"))
    with pytest.raises(ValueError, match="selected together"):
        RunRequest.model_validate(request_body(data_release_id=None))


def test_historical_weather_selects_dates_without_replay() -> None:
    source = {
        "latitude": 42,
        "elevation_m": 300,
        "units": {"ALLSKY_SFC_SW_DWN": "MJ/m^2/day"},
        "days": [
            {
                "date": "2022-01-01",
                "tmin_c": 0,
                "tmax_c": 10,
                "tdew_c": -1,
                "wind_2m_ms": 2,
                "pressure_kpa": 98,
                "shortwave": 8,
                "rain_mm": 4,
            }
        ],
    }
    result = historical_weather(
        source,
        date(2022, 1, 1),
        date(2022, 1, 1),
        temperature_change_c=1,
        rainfall_change_pct=-25,
    )
    assert result[date(2022, 1, 1)]["tmax_c"] == 11
    assert result[date(2022, 1, 1)]["rain_mm"] == 3
    assert result[date(2022, 1, 1)]["scenario_recipe"].startswith("add-temperature")


def test_release_builder_rejects_missing_core_inputs(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_text(
        json.dumps(
            {
                "start": "2022-01-01",
                "end": "2022-12-31",
                "bbox": [-94, 41, -93, 42],
                "longitude": -93.5,
                "latitude": 42,
            }
        )
    )
    (tmp_path / "layers").mkdir()
    (tmp_path / "layers/layer-manifest.json").write_text(json.dumps({"layers": []}))
    with pytest.raises(ValueError, match="POWER, GPM and SRTM"):
        build_nasa_release(tmp_path)


@pytest.mark.asyncio
async def test_bundle_layer_manifest_accepts_non_smap_layer_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pytest.importorskip("PIL")
    from sideronostos_backend.modules.agri_data.service import AgriDataService

    release = ScienceRelease(
        id="iowa-nasa-2022-2024-v1",
        product="NASA_ROTATION_BUNDLE",
        status="published",
        manifest_sha256="a" * 64,
        data={
            "start": "2022-01-01",
            "end": "2024-12-31",
            "recipe": "test-recipe",
            "limitations": ["Historical benchmark only."],
            "layers": [
                {
                    "id": "gpm-2022-precipitation-mm",
                    "product": "gpm",
                    "bounds": [-93.56, 41.97, -93.44, 42.05],
                    "unit": "mm",
                    "sha256": "b" * 64,
                    "asset": "layers/gpm.tif",
                    "display_min": 700,
                    "display_max": 1100,
                }
            ],
        },
    )

    async def get_release(*_args: object, **_kwargs: object) -> ScienceRelease:
        return release

    service = AgriDataService()
    monkeypatch.setattr(service, "get_release", get_release)
    manifest = await service.layer_manifest(
        object(), "user-1", "iowa-nasa-2022-2024-v1:gpm-2022-precipitation-mm"  # type: ignore[arg-type]
    )
    assert manifest["unit"] == "mm"
    assert manifest["source"]["product"] == "gpm"
