"""Resolve every object through ownership checks before freezing a message context."""

from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agri_data.service import AgriDataService
from ..field_shift.models import AnalysisRecord, FieldRecord
from ..rotation_optimizer.models import OptimizationRun
from ..rotation_optimizer.service import ACTIVE, run_view
from .schemas import ContextRef

METRICS = {
    "water_m3": ("估算补水量 / estimated supplemental water", "m³"),
    "cost_usd": ("估算投入 / estimated cost", "USD"),
    "labor_days": ("估算劳力 / estimated labour", "person-days"),
    "cover_ha_days": ("面积加权生长期覆盖 / growing coverage", "ha-days"),
    "diversity_ha_families": ("面积加权科数 / family diversity", "ha-families"),
}


def add_fact(
    facts: list[dict[str, Any]],
    key: str,
    label: str,
    value: Any,
    unit: str,
    source: dict[str, Any],
    *,
    language: str = "zh",
    limitations: list[str] | None = None,
) -> None:
    if value is None:
        display = "缺测 / unavailable" if language == "zh" else "unavailable"
    elif isinstance(value, (float, int)) and not isinstance(value, bool):
        display = f"{value:,.2f} {unit}".strip()
    else:
        display = f"{value} {unit}".strip()
    facts.append(
        {
            "id": f"F{len(facts) + 1}",
            "key": key,
            "label": label,
            "value": value,
            "unit": unit,
            "display": display,
            "source": source,
            "limitations": limitations or [],
        }
    )


async def owned_run(session: AsyncSession, owner: str, identifier: str) -> OptimizationRun:
    row = await session.scalar(
        select(OptimizationRun).where(
            OptimizationRun.id == identifier, OptimizationRun.owner_user_id == owner
        )
    )
    if row is None:
        raise HTTPException(404, "Context run not found")
    return row


def append_run_facts(
    facts: list[dict[str, Any]], run: dict[str, Any], prefix: str, language: str
) -> None:
    source = {
        "kind": "optimization",
        "run_id": run["id"],
        "profile_id": run["provenance"]["profile_id"],
        "weather_release_id": run["provenance"]["weather_release_id"],
        "optimality_scope": "generated_candidate_set",
    }
    add_fact(
        facts,
        f"{prefix}.status",
        f"{prefix}: calculation status",
        run["status"],
        "",
        source,
        language=language,
    )
    for name in ("start", "end"):
        add_fact(
            facts,
            f"{prefix}.{name}",
            f"{prefix}: planning {name}",
            run["request"][name],
            "",
            source,
            language=language,
        )
    result = run["result"] or {}
    for option in [*result.get("options", []), result.get("baseline")]:
        if not option:
            continue
        option_source = {
            **source,
            "option_id": option["id"],
            "feasible": option["feasible"],
            "complete": option.get("complete", True),
            "solver_status": (option.get("solver") or {}).get("status"),
        }
        for metric, value in option.get("verification", {}).get("totals", {}).items():
            label, unit = METRICS[metric]
            add_fact(
                facts,
                f"{prefix}.{option['id']}.{metric}",
                f"{prefix} / {option['label']}: {label}",
                value if option.get("complete", True) else None,
                unit,
                option_source,
                language=language,
                limitations=run["provenance"]["limitations"],
            )
        if option["id"] == run.get("selected_option_id"):
            years = range(
                date.fromisoformat(run["request"]["start"]).year,
                date.fromisoformat(run["request"]["end"]).year + 1,
            )
            yearly = option.get("verification", {}).get("farm_years", {})
            for year in years:
                add_fact(
                    facts,
                    f"{prefix}.year.{year}",
                    f"{prefix}: calendar year",
                    str(year),
                    "",
                    option_source,
                    language=language,
                )
                for metric in ("water_m3", "cost_usd", "labor_days", "cover_ha_days"):
                    label, unit = METRICS[metric]
                    value = yearly.get(str(year), {}).get(metric, 0)
                    add_fact(
                        facts,
                        f"{prefix}.{option['id']}.{year}.{metric}",
                        f"{prefix} / {year}: {label}",
                        value if option.get("complete", True) else None,
                        unit,
                        {**option_source, "year": year},
                        language=language,
                    )
            for i, season in enumerate(option.get("seasons", [])):
                season_source = {
                    **option_source,
                    "field_id": season["field_id"],
                    "crop_id": season["crop_id"],
                    "calendar_kind": "modeled_maturity",
                }
                for key in ("sow_date", "harvest_date", "occupied_until", "growing_days"):
                    add_fact(
                        facts,
                        f"{prefix}.{option['id']}.season.{i}.{key}",
                        f"{prefix} / {season['field_id']} / {season['crop_id']}: {key}",
                        season[key],
                        "days" if key == "growing_days" else "",
                        season_source,
                        language=language,
                        limitations=[
                            "Modeled from benchmark crop parameters and historical weather replay; "
                            "not observed harvest."
                        ],
                    )


async def freeze_context(
    session: AsyncSession,
    owner: str,
    reference: ContextRef,
    language: str,
    *,
    preset: str = "rotation",
) -> dict[str, Any]:
    facts: list[dict[str, Any]] = []
    fields = []
    owned_fields = (
        (
            await session.scalars(
                select(FieldRecord)
                .where(FieldRecord.owner_user_id == owner)
                .order_by(FieldRecord.updated_at.desc(), FieldRecord.id)
                .limit(11)
            )
        ).all()
        if preset == "field_management" and not reference.fields
        else []
    )
    field_list_truncated = len(owned_fields) > 10
    for ref in reference.fields or owned_fields[:10]:
        row = (
            ref
            if isinstance(ref, FieldRecord)
            else await session.scalar(
                select(FieldRecord).where(
                    FieldRecord.id == ref.id, FieldRecord.owner_user_id == owner
                )
            )
        )
        if row is None:
            raise HTTPException(404, "Context field not found")
        if not isinstance(ref, FieldRecord) and row.version != ref.expected_version:
            raise HTTPException(409, "Context field version changed")
        field = {**row.data, "id": row.id, "version": row.version}
        fields.append(field)
        add_fact(
            facts,
            f"field.{row.id}.area",
            f"{field['name']}: 经营面积 / farm area",
            row.data["area_ha"],
            "ha",
            {"kind": "farmer_input", "field_id": row.id, "version": row.version},
            language=language,
        )
    selected_ids = {f["id"] for f in fields}
    context: dict[str, Any] = {
        "reference": reference.model_dump(mode="json"),
        "fields": fields,
        "selection": None,
        "science": None,
        "run": None,
        "comparison": None,
        "v1_analysis": None,
        "facts": facts,
        "warnings": ["field_list_truncated"] if field_list_truncated else [],
        "allowed_actions": ["open_planner", "choose_field", "view_sources"],
        "can_claim_optimal": False,
    }
    if reference.dates:
        for name in ("start", "end"):
            add_fact(
                facts,
                f"selection.{name}",
                f"Selected date window: {name}",
                getattr(reference.dates, name).isoformat(),
                "",
                {"kind": "user_date_filter"},
                language=language,
            )
    if reference.selection:
        science = await AgriDataService().facts(
            session,
            owner,
            reference.selection.id,
            start=reference.dates.start if reference.dates else None,
            end=reference.dates.end if reference.dates else None,
            expected_revision=reference.selection.revision,
        )
        context["selection"] = science["selection"]
        context["science"] = science
        for item in science["facts"]:
            add_fact(
                facts,
                "science." + item["id"],
                item["metric"] + " " + item.get("pass", ""),
                item.get("value"),
                item.get("unit", "m3/m3"),
                {
                    "kind": item["data_kind"],
                    **item["source"],
                    "period": item["period"],
                    "status": item.get("status"),
                    "retrieval_qual_flag": item.get("retrieval_qual_flag"),
                    "surface_flag": item.get("surface_flag"),
                    "acquired_at": item.get("acquired_at"),
                    "pass": item.get("pass"),
                },
                language=language,
                limitations=item["limitations"],
            )
        context["warnings"].extend(item["reason"] for item in science["unavailable"])
    if reference.run_id:
        run_record = await owned_run(session, owner, reference.run_id)
        run = run_view(run_record)
        run_fields = {f["id"] for f in run["field_snapshots"]}
        if selected_ids and selected_ids != run_fields:
            raise HTTPException(409, "Selected fields do not match the bound run")
        run["selected_option_id"] = reference.option_id
        options = [*(run["result"] or {}).get("options", []), (run["result"] or {}).get("baseline")]
        selected = next((o for o in options if o and o["id"] == reference.option_id), None)
        if reference.option_id and selected is None:
            raise HTTPException(404, "Option does not belong to this run")
        context["can_claim_optimal"] = bool(
            selected
            and (selected.get("solver") or {}).get("status") == "optimal"
            and run_record.status not in (*ACTIVE, "cancelled", "failed")
        )
        context["run"] = run
        if not fields:
            # A run-only link binds its immutable field snapshots, never today's edited fields.
            fields.extend(run["field_snapshots"])
            for field in fields:
                add_fact(
                    facts,
                    f"field.{field['id']}.area",
                    f"{field['name']}: 经营面积 / farm area",
                    field["area_ha"],
                    "ha",
                    {
                        "kind": "run_field_snapshot",
                        "run_id": run["id"],
                        "field_id": field["id"],
                        "version": field["version"],
                    },
                    language=language,
                )
        context["allowed_actions"].append("edit_conditions")
        append_run_facts(facts, run, "current", language)
        if fields and any(
            f["version"]
            != next(old["version"] for old in run["field_snapshots"] if old["id"] == f["id"])
            for f in fields
        ):
            context["warnings"].append("field_changed_since_run")
        if reference.compare_run_id:
            other = run_view(await owned_run(session, owner, reference.compare_run_id))
            if other["id"] == run["id"]:
                raise HTTPException(422, "Comparison needs two different runs")
            old_fields = sorted((f["id"], f["version"]) for f in run["field_snapshots"])
            new_fields = sorted((f["id"], f["version"]) for f in other["field_snapshots"])
            if (
                old_fields != new_fields
                or any(
                    run["request"][k] != other["request"][k] for k in ("start", "end", "profile_id")
                )
                or run["provenance"]["weather_sha256"] != other["provenance"]["weather_sha256"]
            ):
                raise HTTPException(422, "Run snapshots are not comparable")
            other["selected_option_id"] = reference.compare_option_id
            other_options = [
                *(other["result"] or {}).get("options", []),
                (other["result"] or {}).get("baseline"),
            ]
            second = next(
                (o for o in other_options if o and o["id"] == reference.compare_option_id), None
            )
            if selected is None or second is None:
                raise HTTPException(404, "Comparison option does not belong to the selected run")
            if (
                not selected.get("complete", True)
                or not second.get("complete", True)
                or any(
                    r["status"] in (*ACTIVE, "failed", "cancelled", "timeout_no_solution")
                    for r in (run, other)
                )
            ):
                raise HTTPException(422, "Comparison requires two complete calculated options")
            append_run_facts(facts, other, "comparison", language)
            delta = {
                k: second["verification"]["totals"][k] - v
                for k, v in selected["verification"]["totals"].items()
            }
            for metric, value in delta.items():
                label, unit = METRICS[metric]
                add_fact(
                    facts,
                    "comparison.delta." + metric,
                    "变化（第二次减第一次） / delta: " + label,
                    value,
                    unit,
                    {
                        "kind": "comparison",
                        "first_run_id": run["id"],
                        "second_run_id": other["id"],
                        "first_option_id": selected["id"],
                        "second_option_id": second["id"],
                    },
                    language=language,
                )
            changes = {
                k: {"before": run["request"][k], "after": other["request"][k]}
                for k in run["request"]
                if k != "idempotency_key" and run["request"][k] != other["request"][k]
            }
            context["comparison"] = {
                "run": other,
                "delta": delta,
                "input_changes": changes,
                "score_comparable": run["request"]["weights"] == other["request"]["weights"],
            }
    if reference.analysis_id:
        analysis = await session.scalar(
            select(AnalysisRecord).where(
                AnalysisRecord.id == reference.analysis_id, AnalysisRecord.owner_user_id == owner
            )
        )
        if analysis is None:
            raise HTTPException(404, "Context analysis not found")
        if selected_ids and selected_ids != {analysis.field_id}:
            raise HTTPException(409, "Selected field does not match this analysis")
        options = [analysis.data["baseline"], *analysis.data["alternatives"]]
        chosen = next((o for o in options if o["id"] == reference.option_id), None)
        if reference.option_id and chosen is None:
            raise HTTPException(404, "Option does not belong to this analysis")
        context["v1_analysis"] = {
            "analysis": analysis.data,
            "field_snapshot": analysis.field_snapshot,
            "selected_option": chosen,
            "model_version": "v1-enumeration-not-MILP",
        }
        if chosen:
            units = {
                "irrigation_gap_mm": "mm",
                "water_demand_mm": "mm",
                "cost_usd_ha": "USD/ha",
                "labor_days_ha": "person-days/ha",
                "cover_days": "days",
                "diversity": "families",
            }
            for key, value in chosen["metrics"].items():
                add_fact(
                    facts,
                    "v1." + key,
                    key,
                    value,
                    units[key],
                    {
                        "kind": "v1_analysis",
                        "analysis_id": analysis.id,
                        "option_id": chosen["id"],
                        "field_id": analysis.field_id,
                    },
                    language=language,
                )
    if reference.draft.dirty:
        context["warnings"].append("draft_not_calculated")
    return context
