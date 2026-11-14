"""Resolve every object through ownership checks before freezing a message context."""

from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agri_data.service import AgriDataService
from ..field_shift.models import AnalysisRecord, FieldRecord
from ..rotation_optimizer.comparison import compare_run_views
from ..rotation_optimizer.models import OptimizationRun, SavedOptimizationPlan
from ..rotation_optimizer.service import ACTIVE, run_view
from .daily_evidence import DAILY_METRICS, append_daily_options, daily_verified, is_daily_run
from .facts import add_fact
from .schemas import ContextRef

METRICS = {
    "water_m3": ("估算补水量 / estimated supplemental water", "m³"),
    "cost_usd": ("估算投入 / estimated cost", "USD"),
    "labor_days": ("估算劳力 / estimated labour", "person-days"),
    "cover_ha_days": ("面积加权生长期覆盖 / growing coverage", "ha-days"),
    "diversity_ha_families": ("面积加权科数 / family diversity", "ha-families"),
}


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
    if is_daily_run(run):
        append_daily_options(facts, run, prefix, language, source)
        return
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
    session: AsyncSession, owner: str, reference: ContextRef, language: str
) -> dict[str, Any]:
    saved_plan = None
    if reference.plan_id:
        saved_plan = await session.scalar(
            select(SavedOptimizationPlan).where(
                SavedOptimizationPlan.id == reference.plan_id,
                SavedOptimizationPlan.owner_user_id == owner,
            )
        )
        if saved_plan is None:
            raise HTTPException(404, "Context saved plan not found")
        if (reference.run_id and reference.run_id != saved_plan.run_id) or (
            reference.option_id and reference.option_id != saved_plan.option_id
        ):
            raise HTTPException(409, "Saved plan does not match the requested run and option")
        reference = reference.model_copy(update={
            "run_id": saved_plan.run_id, "option_id": saved_plan.option_id,
        })
    facts: list[dict[str, Any]] = []
    fields = []
    for ref in reference.fields:
        row = await session.scalar(
            select(FieldRecord).where(FieldRecord.id == ref.id, FieldRecord.owner_user_id == owner)
        )
        if row is None:
            raise HTTPException(404, "Context field not found")
        if row.version != ref.expected_version:
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
        "saved_plan": None,
        "comparison": None,
        "v1_analysis": None,
        "facts": facts,
        "warnings": [],
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
        if saved_plan is not None:
            # Completed runs cannot retry. Detect a broken persistence contract rather
            # than silently substituting a changed run for the immutable saved artifact.
            if saved_plan.data["input_snapshot"] != run_record.input_snapshot or (
                saved_plan.data["option"] != selected
            ):
                raise HTTPException(409, "Saved plan snapshot no longer matches its run")
            context["saved_plan"] = {
                "id": saved_plan.id, "run_id": saved_plan.run_id,
                "option_id": saved_plan.option_id, "title": saved_plan.title,
                "created_at": saved_plan.created_at.isoformat(),
                "schema": saved_plan.data["schema"],
            }
            for key in ("title", "created_at"):
                add_fact(
                    facts, "saved_plan." + key, "Saved plan: " + key,
                    context["saved_plan"][key], "",
                    {"kind": "saved_plan", "plan_id": saved_plan.id,
                     "run_id": saved_plan.run_id, "option_id": saved_plan.option_id},
                    language=language,
                    limitations=["A saved engineering scenario is not implementation approval."],
                )
        context["can_claim_optimal"] = bool(
            selected
            and (selected.get("solver") or {}).get("status") == "optimal"
            and run_record.status not in (*ACTIVE, "cancelled", "failed")
            and (
                not is_daily_run(run)
                or (
                    daily_verified(run, selected)
                    and selected.get("feasible")
                    and selected.get("verification", {}).get("valid")
                    and selected["solver"].get("gap_optimality_proven")
                    and selected["solver"].get("score_optimality_proven")
                )
            )
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
            comparison = compare_run_views(
                run, other, reference.option_id or "", reference.compare_option_id or ""
            )
            other["selected_option_id"] = reference.compare_option_id
            append_run_facts(facts, other, "comparison", language)
            delta = comparison["delta"]
            for metric, value in delta.items():
                label, unit = (DAILY_METRICS if is_daily_run(run) else METRICS)[metric]
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
                        "first_option_id": reference.option_id,
                        "second_option_id": reference.compare_option_id,
                        "model_version": comparison["model_version"],
                        "implementation_ready": False,
                    },
                    language=language,
                )
            context["comparison"] = {**comparison, "run": other}
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
