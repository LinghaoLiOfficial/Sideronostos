"""Project verified daily results into citable facts, without doing agronomic calculations."""

from datetime import date
from typing import Any

from .facts import add_fact

DAILY_METRICS = {
    "profit": ("收益估计 / estimated profit", "USD"),
    "water": ("净灌溉量 / net irrigation estimate", "m³"),
    "rotation": ("轮作衔接 / rotation transition score", "score"),
    "soil": ("土壤贡献 / soil contribution proxy", "score·ha"),
    "risk": ("气象与灌溉暴露 / weather and irrigation exposure proxy", "score·ha"),
    "bare": ("裸地面积天数 / bare area days", "ha-days"),
}
UNFINISHED = {"pending", "running", "cancelled", "failed", "timeout_no_solution"}
GAP_DETAIL_LIMIT = 12


def is_daily_run(run: dict[str, Any]) -> bool:
    return bool(run.get("request", {}).get("model_version") == "rotation-milp-v3.0")


def daily_verified(run: dict[str, Any], option: dict[str, Any]) -> bool:
    return bool(
        run["status"] not in UNFINISHED
        and option.get("complete")
        and option.get("scientific_verification", {}).get("valid")
    )


def daily_option_state(run: dict[str, Any], option: dict[str, Any]) -> dict[str, Any]:
    verified = daily_verified(run, option)
    verification = option.get("verification", {})
    hard_valid = bool(verified and verification.get("valid") and option.get("feasible"))
    diagnostic = bool(
        verified and (verification.get("diagnostic") or verification.get("gap_cost", 0) > 1e-6)
    )
    return {
        "scientifically_verified": verified,
        "hard_constraints_satisfied": hard_valid,
        "resource_feasible": bool(
            hard_valid and verification.get("resource_feasible") and not diagnostic
        ),
        "diagnostic": diagnostic,
        # A scenario cannot verify actual bookings, water rights or farm implementation.
        "implementation_ready": False,
        "execution_status": "unverified"
        if not verified
        else "hard_constraint_failure"
        if not hard_valid
        else "diagnostic_requires_remedies"
        if diagnostic
        else "zero_gap_modeled_scenario",
        "metric_availability": {
            key: verified and verification.get("metrics", {}).get(key) is not None
            for key in DAILY_METRICS
        },
        "disabled_metrics": option.get("objective_definition", {}).get("disabled_metrics", {}),
    }


def append_daily_options(
    facts: list[dict[str, Any]],
    run: dict[str, Any],
    prefix: str,
    language: str,
    source: dict[str, Any],
) -> None:
    result = run.get("result") or {}
    provenance = run["provenance"]
    source = {
        **source,
        "model_version": run["request"]["model_version"],
        "profile_sha256": provenance["profile_sha256"],
        "weather_sha256": provenance["weather_sha256"],
        "benchmark_scope": provenance["benchmark_scope"],
        "implementation_ready": False,
        "initial_water_policy": "independent_wilting_point_v1",
        "weather_basis": result.get("weather_basis"),
    }
    for option in [*result.get("options", []), result.get("baseline")]:
        if not option:
            continue
        state = daily_option_state(run, option)
        option_source = {
            **source,
            **state,
            "option_id": option["id"],
            "solver_status": (option.get("solver") or {}).get("status"),
            "complete": option.get("complete", False),
            "feasible": option.get("feasible", False),
        }
        key = f"{prefix}.{option['id']}"
        label = f"{prefix} / {option['label']}"
        add_fact(
            facts,
            key + ".execution_status",
            label + ": implementation status",
            state["execution_status"],
            "",
            option_source,
            language=language,
            limitations=[
                "Optimizer status does not establish actual farm implementation readiness."
            ],
        )
        for metric, (name, unit) in DAILY_METRICS.items():
            limitations = [
                *provenance["limitations"],
                "Model estimate or proxy, not measured farm outcomes.",
            ]
            if metric in state["disabled_metrics"]:
                limitations.append(state["disabled_metrics"][metric])
            add_fact(
                facts,
                key + "." + metric,
                label + ": " + name,
                option.get("verification", {}).get("metrics", {}).get(metric)
                if state["scientifically_verified"]
                else None,
                unit,
                option_source,
                language=language,
                limitations=limitations,
            )
        if not state["scientifically_verified"]:
            continue
        verification = option["verification"]
        gaps = [r for r in verification.get("resources", []) if r["gap"] > 1e-6]
        add_fact(
            facts,
            key + ".gap_cost",
            label + ": weighted resource gap cost",
            verification["gap_cost"],
            "USD",
            option_source,
            language=language,
            limitations=[
                "Resource remedy cost estimate; separate first-priority objective, "
                "not a deduction from crop profit."
            ],
        )
        add_fact(
            facts,
            key + ".gap_count",
            label + ": resource constraints with a gap",
            len(gaps),
            "",
            option_source,
            language=language,
        )
        if option["id"] != run.get("selected_option_id"):
            continue
        add_fact(
            facts,
            key + ".gap_details_count",
            label + ": gap rows available in this explanation",
            min(len(gaps), GAP_DETAIL_LIMIT),
            "",
            option_source,
            language=language,
            limitations=[
                "Only the first stored resource rows are expanded here; "
                "all gaps remain in the result page and export."
            ]
            if len(gaps) > GAP_DETAIL_LIMIT
            else [],
        )
        for index, gap in enumerate(gaps[:GAP_DETAIL_LIMIT]):
            evidence = [
                run["request"]["sources"][eid.removeprefix("input:")]
                for eid in gap.get("evidence_ids", [])
                if eid.startswith("input:")
                and eid.removeprefix("input:") in run["request"].get("sources", {})
            ]
            resource_source = {
                **option_source,
                "resource_id": gap["id"],
                "resource_kind": gap["kind"],
                "evidence_ids": gap.get("evidence_ids", []),
                "input_sources": evidence,
            }
            for name, unit in (
                ("used", gap["unit"]),
                ("capacity", gap["unit"]),
                ("gap", gap["unit"]),
                ("gap_cost", "USD"),
                ("remedy", ""),
            ):
                add_fact(
                    facts,
                    f"{key}.resource.{index}.{name}",
                    f"{label} / {gap['kind']}: {name}",
                    gap.get(name),
                    unit,
                    resource_source,
                    language=language,
                )
            try:
                day = date.fromisoformat(gap["id"].rsplit(":", 1)[-1])
            except ValueError:
                pass  # Period and bare-soil constraints have no single-day identity.
            else:
                add_fact(
                    facts,
                    f"{key}.resource.{index}.date",
                    label + ": resource date",
                    day.isoformat(),
                    "",
                    resource_source,
                    language=language,
                )
        for index, season in enumerate(option.get("seasons", [])):
            season_source = {
                **option_source,
                "field_id": season["field_id"],
                "crop_id": season["crop_id"],
                "calendar_kind": "modeled_maturity",
            }
            for name in ("sow_date", "harvest_date", "occupied_until", "growing_days"):
                add_fact(
                    facts,
                    f"{key}.season.{index}.{name}",
                    f"{label} / {season['crop_id']}: {name}",
                    season[name],
                    "days" if name == "growing_days" else "",
                    season_source,
                    language=language,
                    limitations=[
                        "Historical-weather replay and sourced crop parameters; "
                        "not a forecast or observed harvest."
                    ],
                )
