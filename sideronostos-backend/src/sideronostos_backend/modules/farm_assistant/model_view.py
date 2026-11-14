"""Minimal model evidence; full values and provenance remain in the frozen server snapshot.

Verified displays help the model interpret evidence; output values are still bound by the
server. The model selects labelled facts, not arithmetic.
Only relevant options/metrics are exposed, preventing accidental cross-option comparisons.
"""

import re
from typing import Any

from .daily_evidence import daily_option_state, daily_verified, is_daily_run
from .intents import compares_current_alternatives, excluded_product_sources
from .schemas import fact_is_renderable

METRIC_WORDS = {
    "profit": r"收益|利润|profit|revenue",
    "water": r"水|灌溉|water|irrigat",
    "rotation": r"衔接|轮作评分|rotation score|transition",
    "soil": r"土壤|soil",
    "risk": r"风险|暴露|risk|exposure",
    "bare": r"裸地|bare|fallow",
    "water_m3": r"水|灌溉|water|irrigat",
    "cost_usd": r"投入|成本|预算|cost|budget",
    "labor_days": r"劳力|劳动|labou?r",
    "cover_ha_days": r"覆盖|cover",
    "diversity_ha_families": r"多样|科数|diversity|families",
}


def redact_quantities(text: str) -> str:
    text = re.sub(r"\bET0\b", "reference evapotranspiration", text, flags=re.I)
    return re.sub(r"[0-9０-９]+(?:[.,][0-9０-９]+)*", "[numeric detail omitted]", text)


def model_view(question: str, context: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    text = question.casefold()
    requested = {key for key, pattern in METRIC_WORDS.items() if re.search(pattern, text)}
    yearly = bool(
        re.search(r"各年|分年|按年|每年|年度|逐年|by year|each year|every year|annual|yearly", text)
    )
    calendar = bool(re.search(r"日期|日历|收获|播种|calendar|harvest|sow", text))
    compare = context.get("comparison")
    both_options = compares_current_alternatives(question, context)
    compare_request = bool(
        compare
        or (
            not both_options
            and re.search(r"两次|两个 run|两份|compare.*(?:run|calculation)|between.*runs", text)
        )
    )
    run = context.get("run")
    option_roles = (
        {
            option["id"]: "alternative " + chr(65 + index)
            for index, option in enumerate(((run or {}).get("result") or {}).get("options", []))
        }
        if both_options and not compare
        else {}
    )
    summary: dict[str, Any] = {
        "page": context["reference"]["page"],
        "draft_not_calculated": bool(context["reference"].get("draft", {}).get("dirty")),
        "warnings": [
            warning
            for warning in context["warnings"]
            if warning
            not in {
                item["reason"] for item in (context.get("science") or {}).get("unavailable", [])
            }
        ],
        "allowed_actions": context["allowed_actions"],
        "has_map_selection": bool(context.get("selection")),
        "has_saved_plan": bool(context.get("saved_plan")),
        "owned_fields": [
            {
                "name": f["name"],
                "irrigation_available": f.get("irrigation_available"),
                "history_precision": [
                    e.get("precision", "year") for e in f.get("history_events", [])
                ]
                or (["year"] if f.get("history") else []),
            }
            for f in context["fields"]
        ],
    }
    if context.get("science"):
        missing = context["science"]["unavailable"]
        # A moisture-only question must not receive an unrelated weather failure
        # as a possible explanation. Mixed/general questions keep both products.
        moisture_question = re.search(r"smap|moisture|surface|root.zone|土壤|水分|表层|根区", text)
        weather_question = re.search(r"power|weather|rain|temperature|天气|气象|降雨|气温", text)
        if moisture_question and not weather_question:
            moisture_releases = {
                fact["source"].get("release_id")
                for fact in evidence["facts"]
                if re.search(r"SMAP|SPL[234].*SM", fact["source"].get("product", ""), re.I)
            }
            missing = [item for item in missing if item.get("release_id") in moisture_releases]
        summary["science_missing"] = missing
    requirement = None
    unsupported_yield = (
        re.search(r"保证|预测|guarantee|predict", text)
        and re.search(r"方案|模型|系统|plan|model|system", text)
        and re.search(r"增产|产量|收益|利润|yield|profit", text)
    )
    if unsupported_yield:
        requirement = (
            "estimates_are_not_guaranteed_yield_profit_or_measured_savings"
            if run and is_daily_run(run)
            else "yield_and_profit_are_not_computed_even_after_recalculation"
        )
        summary["allowed_actions"] = []
    elif compare_request and not compare:
        requirement = "ask_for_other_completed_calculation_before_comparing"
    elif run and run["status"] in (
        "infeasible",
        "failed",
        "cancelled",
        "pending",
        "running",
        "timeout_no_solution",
    ):
        requirement = "explain_run_status_without_requesting_an_option"
    elif (
        run
        and not run.get("selected_option_id")
        and not both_options
        and re.search(r"方案|plan|最好|best|这个|this", text)
    ):
        requirement = "ask_to_select_specific_option"
    if requirement:
        summary["answer_requirement"] = requirement
    summaries = []
    for _prefix, entry, role in [
        ("current", run, "reference calculation" if compare else "selected calculation"),
        ("comparison", compare.get("run") if compare else None, "comparison calculation"),
    ]:
        if not entry:
            continue
        result = entry.get("result") or {}
        options = [*result.get("options", []), result.get("baseline")]
        selected = [
            o
            for o in options
            if o
            and (
                o["id"] == entry.get("selected_option_id") or both_options and o["id"] != "baseline"
            )
        ]
        summaries.append(
            {
                "role": role,
                "status": None
                if requirement == "ask_to_select_specific_option"
                else entry["status"],
                "specific_option_selected": bool(entry.get("selected_option_id")),
                "model_version": entry.get("request", {}).get(
                    "model_version", "rotation-milp-v2.0"
                ),
                "daily_metrics": is_daily_run(entry),
                "parameter_applicability": entry["provenance"]["benchmark_scope"],
                "result_basis": "model estimates, not measured farm outcomes",
                "limitations": entry["provenance"]["limitations"],
                "weather_basis": result.get("weather_basis"),
                "error_code": result.get("error_code"),
                "options": []
                if requirement
                else [
                    {
                        "role": "baseline"
                        if o["id"] == "baseline"
                        else option_roles.get(o["id"], "selected plan"),
                        **(daily_option_state(entry, o) if is_daily_run(entry) else {}),
                        "feasible": o["feasible"],
                        "violations": sorted(
                            {v.split(":")[0] for v in o["verification"]["violations"]}
                        ),
                        "solver_status": (o.get("solver") or {}).get("status"),
                        "crops_by_field": {
                            f["name"]: list(
                                dict.fromkeys(
                                    s["crop_id"]
                                    for s in o.get("seasons", [])
                                    if s["field_id"] == f["id"]
                                )
                            )
                            for f in context["fields"]
                        },
                    }
                    for o in selected
                ],
            }
        )
    summary["calculations"] = summaries
    if option_roles and run:
        alternatives = (run.get("result") or {}).get("options", [])
        if len(alternatives) >= 2:
            metric_key = "metrics" if is_daily_run(run) else "totals"
            comparisons = []
            first_option = alternatives[0]
            for second_option in alternatives[1:]:
                pair = [first_option, second_option]
                first, second = (o["verification"][metric_key] for o in pair)
                trustworthy = not is_daily_run(run) or all(daily_verified(run, o) for o in pair)
                definitions = [o.get("objective_definition", {}) for o in pair]
                comparisons.append(
                    {
                        "first": option_roles[first_option["id"]],
                        "second": option_roles[second_option["id"]],
                        "score_comparable": all(
                            definitions[0].get(k) == definitions[1].get(k)
                            for k in ("weights", "scales", "references")
                        ),
                        "direction_second_minus_first": {
                            metric: "unavailable"
                            if not trustworthy or first[metric] is None or second[metric] is None
                            else "unchanged"
                            if abs(second[metric] - first[metric]) < 1e-6
                            else "lower"
                            if second[metric] < first[metric]
                            else "higher"
                            for metric in METRIC_WORDS
                            if metric in first and metric in second
                        },
                    }
                )
            summary["within_run_comparisons"] = comparisons
            if len(alternatives) == 2:
                summary["within_run_comparison"] = {
                    "basis": "alternative B minus alternative A from the same calculation",
                    "score_comparable": comparisons[0]["score_comparable"],
                    "direction_B_minus_A": comparisons[0]["direction_second_minus_first"],
                }
    if compare:
        summary["score_comparable"] = compare["score_comparable"]
        summary["changed_input_categories"] = list(compare["input_changes"])
        caps = compare["input_changes"].get("farm_limits")
        if caps:
            summary["changed_farm_limits"] = [
                {"metric": metric, "direction": "lower" if after < before else "higher"}
                for year, values in caps["before"].items()
                for metric, before in values.items()
                if (after := caps["after"].get(year, {}).get(metric, before)) != before
            ]
    year_references = {
        fact["key"]: "{{" + fact["id"] + "}}"
        for fact in evidence["facts"]
        if ".year." in fact["key"]
    }
    resource_dates = {
        f["key"].removesuffix(".date"): "{{" + f["id"] + "}}"
        for f in evidence["facts"]
        if ".resource." in f["key"] and f["key"].endswith(".date")
    }
    facts = []
    for fact in evidence["facts"]:
        key = fact["key"]
        source = fact["source"]
        if requirement == "ask_to_select_specific_option" and key.endswith(".status"):
            continue
        prefix = key.split(".")[0]
        entry = (
            run
            if prefix == "current"
            else compare.get("run")
            if compare and prefix == "comparison"
            else None
        )
        role = (
            "reference calculation"
            if prefix == "current" and compare
            else "comparison calculation"
            if prefix == "comparison"
            else "selected calculation"
            if prefix == "current"
            else "selected data"
        )
        if requirement and source.get("option_id"):
            continue
        if source.get("option_id") and entry:
            if both_options and source["option_id"] not in option_roles:
                continue
            if not entry.get("selected_option_id") and not both_options:
                continue
            if source["option_id"] != entry["selected_option_id"] and not both_options:
                continue
        metric = next((name for name in METRIC_WORDS if key.endswith("." + name)), None)
        if metric and requested and metric not in requested:
            continue
        if source.get("year") and not yearly:
            continue
        if ".year." in key and not yearly:
            continue
        if ".season." in key and not calendar:
            continue
        if ".delta." in key:
            role = "change: comparison minus reference"
        label = fact["label"]
        label = re.sub(r"Option\s+\d+|option-\d+", "selected plan", label, flags=re.I)
        if prefix in ("current", "comparison"):
            label = label.replace(prefix, role)
        year_reference = year_references.get(f"{prefix}.year.{source.get('year')}")
        if year_reference:
            label = label.replace(str(source["year"]), year_reference)
        value = fact.get("value")
        numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
        facts.append(
            {
                "id": fact["id"],
                "label": label,
                "year_reference": year_reference,
                "role": role,
                "option_role": option_roles.get(source.get("option_id", "")),
                "metric": metric,
                "availability": "unavailable" if value is None else "available",
                "direction": ("lower" if value < 0 else "higher" if value > 0 else "unchanged")
                if numeric and ".delta." in key
                else None,
                "value_kind": "number rendered by server"
                if numeric
                else "date or text rendered by server",
                "render_reference": "{{" + fact["id"] + "}}" if fact_is_renderable(fact) else None,
                "verified_display": fact.get("display") if value is not None else None,
                "origin": "model_result_not_measured"
                if prefix in ("current", "comparison")
                else source.get("kind", "provided_evidence"),
                "limitations": fact.get("limitations", []),
                "quality_status": source.get("status"),
                "resource_kind": source.get("resource_kind"),
                # Resource rows are individual daily/period constraints, not horizon totals.
                # Link the already-bound date instead of exposing IDs or inventing a sum.
                **(
                    {
                        "scope": "single_resource_constraint_not_plan_total",
                        "resource_group": key.rsplit(".", 1)[0],
                        "quantity_kind": key.rsplit(".", 1)[1],
                        "date_reference": resource_dates.get(key.rsplit(".", 1)[0]),
                    }
                    if ".resource." in key
                    else {}
                ),
                "input_sources": source.get("input_sources", []),
                "data_release": source.get("release_id"),
                "data_product": source.get("product"),
            }
        )
    fact_lookup = {f["key"]: f for f in evidence["facts"]}
    visible_ids = {f["id"] for f in facts}
    overviews = []
    for key, count in fact_lookup.items():
        if not key.endswith(".gap_count") or count["id"] not in visible_ids:
            continue
        shown = fact_lookup.get(key.removesuffix(".gap_count") + ".gap_details_count")
        if shown is None or shown["id"] not in visible_ids:
            continue
        overviews.append(
            {
                "option_role": option_roles.get(count["source"].get("option_id"), "selected plan"),
                "count_reference": "{{" + count["id"] + "}}",
                "shown_count_reference": "{{" + shown["id"] + "}}",
                "details_truncated": count["value"] > shown["value"],
                "gap_total_reference": None,
                "scope": (
                    "counts_of_constraints_not_water_volume; amounts_belong_to_individual_rows"
                ),
                "remaining_details": "result page and export",
            }
        )
    if overviews:
        summary["resource_gap_overviews"] = overviews
    # Compare annual estimates server-side; the model only sees bound references.
    # Group at the same precision as add_fact's displayed values, preserving ties.
    originals = {fact["id"]: fact for fact in evidence["facts"]}
    annual: dict[tuple[str, str | None, str], dict[float, list[str]]] = {}
    for fact in facts:
        value = originals[fact["id"]].get("value")
        if fact["year_reference"] and fact["metric"] and isinstance(value, (int, float)):
            key = (fact["role"], fact["option_role"], fact["metric"])
            annual.setdefault(key, {}).setdefault(round(float(value), 2), []).append(
                fact["render_reference"]
            )
    if annual:
        summary["annual_metric_orderings"] = [
            {
                "role": role,
                "option_role": option_role,
                "metric": metric,
                "ascending_equal_value_groups": [groups[value] for value in sorted(groups)],
            }
            for (role, option_role, metric), groups in annual.items()
        ]
    knowledge = [
        {
            "id": item["id"],
            "title": redact_quantities(item["source"]["title"]),
            "excerpt": redact_quantities(item["excerpt"]),
            "access_scope": item["source"]["access_scope"],
            "regions": item["source"]["regions"],
            "limitations": [redact_quantities(v) for v in item["source"]["limitations"]],
            "reviewed_claims": [redact_quantities(c["statement"]) for c in item["claims"]],
        }
        for item in evidence["knowledge"]
        if item["source"].get("id") not in excluded_product_sources(context)
    ]
    return {"context": summary, "facts": facts, "knowledge": knowledge}
