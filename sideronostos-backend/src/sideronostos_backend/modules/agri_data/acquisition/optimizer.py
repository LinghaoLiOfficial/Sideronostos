"""Historical 1/2/3-year benchmark using actual POWER/GPM/SRTM inputs."""

from __future__ import annotations

import csv
import json
from datetime import date
from pathlib import Path
from typing import Any

from ...rotation_optimizer.prepare import generate_candidates
from ...rotation_optimizer.profiles import get_profile, profile_hash
from ...rotation_optimizer.schemas import PlanningField, Problem
from ...rotation_optimizer.scientific_verify import verify_scientific_candidates
from ...rotation_optimizer.settings import get_rotation_settings
from ...rotation_optimizer.solver import solve
from ...rotation_optimizer.verify import verify_selection
from .config import PipelineConfig
from .manifest import RunManifest, atomic_json, sha256_file


def load_weather(config: PipelineConfig) -> dict[date, dict[str, Any]]:
    power_path = config.root / "processed" / "power-daily.csv"
    gpm_path = config.root / "processed" / "gpm-daily-aoi.csv"
    if not power_path.exists() or not gpm_path.exists():
        raise RuntimeError("Run prepare after fetching complete POWER and GPM data")
    rain: dict[date, list[float]] = {}
    for row in csv.DictReader(gpm_path.open()):
        if row["rain_mm"]:
            rain.setdefault(date.fromisoformat(row["date"]), []).append(float(row["rain_mm"]))
    weather: dict[date, dict[str, Any]] = {}
    numeric = ("tmin_c", "tmax_c", "tdew_c", "wind_2m_ms", "pressure_kpa", "shortwave", "et0_mm")
    for row in csv.DictReader(power_path.open()):
        day = date.fromisoformat(row["date"])
        values = rain.get(day, [])
        parsed: dict[str, Any] = {
            name: float(row[name]) if row.get(name) else None for name in numeric
        }
        parsed.update(
            date=day.isoformat(),
            rain_mm=sum(values) / len(values) if values else None,
            weather_basis="observed_historical",
            temperature_source="NASA POWER Temporal Daily Point",
            rainfall_source="GPM_3IMERGDF.07 AOI mean",
            et0_recipe="fao56-daily-dewpoint-v1 with SRTM mean elevation",
        )
        weather[day] = parsed
    expected = {
        (config.start.fromordinal(config.start.toordinal() + offset))
        for offset in range(config.expected_days)
    }
    missing = sorted(
        day.isoformat()
        for day in expected
        if day not in weather
        or any(weather[day].get(name) is None for name in ("tmin_c", "tmax_c", "rain_mm", "et0_mm"))
    )
    if missing:
        raise RuntimeError(
            f"Core daily weather is incomplete ({len(missing)} days); first={missing[0]}"
        )
    return weather


def _fields(config: PipelineConfig) -> list[PlanningField]:
    payload = json.loads((config.root / "aoi" / "fields.geojson").read_text())
    return [
        PlanningField(
            id=feature["properties"]["field_id"],
            area_ha=feature["properties"]["area_ha"],
            irrigation_available=True,
            require_crop=True,
            history=[],
        )
        for feature in payload["features"]
    ]


def optimize(config: PipelineConfig, *, time_limit: float = 30) -> dict[str, Any]:
    settings = get_rotation_settings()
    profile = get_profile(settings.default_profile_id)
    weather = load_weather(config)
    fields = _fields(config)
    summaries = []
    for years in (1, 2, 3):
        end = date(config.start.year + years - 1, 12, 31)
        prepared = generate_candidates(
            profile=profile,
            fields=fields,
            start=config.start,
            end=end,
            weather={day: row for day, row in weather.items() if day <= end},
            allowed_crop_ids=[crop.id for crop in profile.crops],
            max_candidates=settings.max_candidates,
        )
        problem = Problem(
            start=config.start,
            end=end,
            fields=fields,
            candidates=prepared["candidates"],
            family_gaps=profile.family_gaps,
            weights=profile.default_weights,
            references=profile.references,
        )
        solver_result = solve(
            problem,
            time_limit=time_limit,
            max_transition_edges=settings.max_transition_edges,
        )
        selected_ids = solver_result.get("selected_ids", [])
        verification = verify_selection(problem, selected_ids)
        selected = [candidate for candidate in problem.candidates if candidate.id in selected_ids]
        scientific = verify_scientific_candidates(
            profile, selected, {day: row for day, row in weather.items() if day <= end}
        )
        if solver_result["solution_count"] and (
            not verification["valid"] or not scientific["valid"]
        ):
            raise RuntimeError(f"Independent verification failed for the {years}-year result")
        output = {
            "schema": "sideronostos-nasa-historical-optimization-v1",
            "label": f"{years}-year historical engineering benchmark",
            "start": config.start.isoformat(),
            "end": end.isoformat(),
            "candidate_count": len(problem.candidates),
            "rejected_by_reason": prepared["rejected_by_reason"],
            "solver": solver_result,
            "verification": verification,
            "scientific_verification": scientific,
            "selected_sequences": [
                candidate.model_dump(mode="json", exclude={"water_mm"}) for candidate in selected
            ],
            "weather": {
                "temperature_humidity_wind_pressure_radiation": "NASA POWER",
                "rainfall": "GPM IMERG Final Daily V07 AOI mean",
                "elevation": "SRTMGL1.003 AOI mean",
                "actual_historical_dates": True,
                "forecast": False,
                "year_replay": False,
            },
            "evidence_only": ["SMAP", "HLS", "ECOSTRESS", "GRACE/GRACE-FO"],
            "warning": "Historical engineering benchmark, not a future planting recommendation.",
            "profile": {"id": profile.id, "sha256": profile_hash(profile), "scope": profile.scope},
            "limitations": [
                *profile.limitations,
                (
                    "SMAP, HLS, ECOSTRESS and GRACE are validation evidence only; "
                    "no unvalidated risk coefficient changes the objective."
                ),
                "Four synthetic fields are benchmark geometries, not legal farm boundaries.",
            ],
        }
        path = config.root / "optimization" / f"{years}y.json"
        atomic_json(path, output)
        summaries.append(
            {
                "years": years,
                "path": str(path),
                "status": solver_result["status"],
                "candidate_count": len(problem.candidates),
                "objective": solver_result.get("objective"),
                "selected_count": len(selected),
                "metrics": verification.get("totals"),
            }
        )
    result = {"schema": "sideronostos-nasa-optimization-comparison-v1", "runs": summaries}
    comparison_path = config.root / "optimization" / "comparison.json"
    atomic_json(comparison_path, result)
    manifest = RunManifest(
        config.root / "run-manifest.json",
        config={"credentials": "Earthdata .netrc; never persisted"},
    )
    for summary in summaries:
        output_path = Path(str(summary["path"]))
        manifest.add(
            {
                "key": f"optimization:{summary['years']}y",
                "provider": "local Gurobi historical benchmark",
                "path": str(output_path),
                "size": output_path.stat().st_size,
                "sha256": sha256_file(output_path),
                "recipe": summary,
            }
        )
    manifest.add(
        {
            "key": "optimization:comparison",
            "provider": "local Gurobi historical benchmark",
            "path": str(comparison_path),
            "size": comparison_path.stat().st_size,
            "sha256": sha256_file(comparison_path),
        }
    )
    return result
