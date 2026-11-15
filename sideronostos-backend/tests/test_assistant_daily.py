"""Daily assistant projection: frozen optimizer evidence, no model or arithmetic mocks."""

import json
from pathlib import Path

import pytest

from sideronostos_backend.modules.farm_assistant.context import append_run_facts
from sideronostos_backend.modules.farm_assistant.model_view import model_view
from sideronostos_backend.modules.farm_assistant.schemas import ModelAnswer
from sideronostos_backend.modules.farm_assistant.validation import bind_answer


@pytest.fixture
def daily_run():
    artifact = json.loads(
        (
            Path(__file__).parent / "fixtures/assistant-daily.json"
        ).read_text()
    )
    snapshot = artifact["input_snapshot"]
    return {
        "id": "daily-run",
        "status": "optimal",
        "selected_option_id": "option-1",
        "request": snapshot["request"],
        "field_snapshots": snapshot["fields"],
        "provenance": {
            **snapshot["provenance"],
            "weather_release_id": snapshot["profile"]["weather_release_id"],
            "benchmark_scope": snapshot["profile"]["scope"],
            "limitations": snapshot["profile"]["limitations"],
            "sources": snapshot["profile"]["sources"],
        },
        "result": artifact["result"],
    }


def projected(run, question="请解释当前方案的取舍"):
    facts = []
    append_run_facts(facts, run, "current", "zh")
    context = {
        "reference": {"page": "rotation", "draft": {"dirty": False}},
        "fields": run["field_snapshots"],
        "warnings": [],
        "allowed_actions": ["edit_conditions"],
        "selection": None,
        "science": None,
        "run": run,
        "comparison": None,
        "can_claim_optimal": True,
    }
    return facts, model_view(question, context, {"facts": facts, "knowledge": []})


def test_daily_six_metrics_keep_null_and_original_provenance(daily_run):
    option = daily_run["result"]["options"][0]
    option["verification"]["metrics"]["profit"] = None
    option["objective_definition"]["disabled_metrics"]["profit"] = "Local prices unavailable"
    facts, view = projected(daily_run)
    lookup = {f["key"]: f for f in facts}
    assert lookup["current.option-1.profit"]["value"] is None
    assert "Local prices unavailable" in lookup["current.option-1.profit"]["limitations"]
    assert lookup["current.option-1.rotation"]["value"] == 0
    water = lookup["current.option-1.water"]
    assert water["value"] == option["verification"]["metrics"]["water"]
    assert water["source"]["profile_sha256"] == daily_run["provenance"]["profile_sha256"]
    assert water["source"]["model_version"] == "rotation-milp-v3.0"
    assert not any(".2027." in key for key in lookup)  # v3 does not publish annual totals
    assert {f["metric"] for f in view["facts"] if f["metric"]} >= {
        "profit",
        "water",
        "rotation",
        "soil",
        "risk",
        "bare",
    }


def test_daily_gaps_have_bound_date_capacity_remedy_and_input_source(daily_run):
    option = daily_run["result"]["options"][0]
    source_id = next(iter(daily_run["request"]["sources"]))
    option["execution_label"] = "diagnostic_requires_remedies"
    option["verification"].update(
        diagnostic=True,
        resource_feasible=False,
        gap_cost=60,
        resources=[
            {
                "id": "machine:shared:2027-04-20",
                "kind": "machine",
                "used": 2,
                "capacity": 0,
                "gap": 2,
                "unit": "hours",
                "remediable": True,
                "gap_unit_cost": 30,
                "gap_cost": 60,
                "remedy": "Confirm contractor booking",
                "evidence_ids": ["input:" + source_id],
            }
        ],
    )
    facts, view = projected(daily_run, "这个方案缺什么设备，怎么补救？")
    gap = next(f for f in facts if f["key"] == "current.option-1.resource.0.gap")
    assert gap["value"] == 2 and gap["unit"] == "hours"
    assert gap["source"]["resource_id"] == "machine:shared:2027-04-20"
    assert gap["source"]["input_sources"][0]["id"] == source_id
    assert any(f["value"] == "2027-04-20" for f in facts)
    assert any(f["value"] == "Confirm contractor booking" for f in facts)
    summary = view["context"]["calculations"][0]["options"][0]
    assert summary["diagnostic"] and not summary["resource_feasible"]
    assert summary["implementation_ready"] is False


@pytest.mark.parametrize("failure", ["incomplete", "unverified", "cancelled"])
def test_unverified_daily_result_never_exposes_trusted_numbers(daily_run, failure):
    daily_run["result"]["baseline"] = None
    daily_run["result"]["options"] = daily_run["result"]["options"][:1]
    option = daily_run["result"]["options"][0]
    if failure == "incomplete":
        option["complete"] = False
    elif failure == "unverified":
        option["scientific_verification"]["valid"] = False
    else:
        daily_run["status"] = "cancelled"
    facts, _ = projected(daily_run)
    assert not any(
        f["key"].startswith("current.option-1.")
        and f["value"] is not None
        and (isinstance(f["value"], (int, float)) or ".season." in f["key"])
        for f in facts
    )


def test_daily_profit_estimate_is_distinct_from_guaranteed_profit(daily_run):
    _, normal = projected(daily_run, "这个方案的收益估计是多少？")
    profits = [f for f in normal["facts"] if f["metric"] == "profit"]
    assert len(profits) == 1 and profits[0]["render_reference"]
    _, promise = projected(daily_run, "这个方案能保证利润吗？")
    assert (
        promise["context"]["answer_requirement"]
        == "estimates_are_not_guaranteed_yield_profit_or_measured_savings"
    )


def test_daily_within_run_comparison_preserves_missing_values_and_changed_weights(daily_run):
    first, second = daily_run["result"]["options"][:2]
    first["verification"]["metrics"]["profit"] = None
    _, view = projected(daily_run, "比较这次计算的两个方案")
    comparison = view["context"]["within_run_comparison"]
    assert comparison["direction_B_minus_A"]["profit"] == "unavailable"
    assert comparison["direction_B_minus_A"]["water"] == "higher"
    assert not comparison["score_comparable"]


def test_daily_no_solution_requests_no_nonexistent_option(daily_run):
    daily_run.update(status="timeout_no_solution", selected_option_id=None, result=None)
    _, view = projected(daily_run, "这个方案怎么样？")
    assert (
        view["context"]["answer_requirement"] == "explain_run_status_without_requesting_an_option"
    )


def test_diagnostic_cannot_be_claimed_ready_even_when_solver_is_optimal(daily_run):
    option = daily_run["result"]["options"][0]
    option["verification"].update(diagnostic=True, resource_feasible=False, gap_cost=60)
    facts, _ = projected(daily_run)
    status = next(f for f in facts if f["key"] == "current.option-1.execution_status")
    for claim in ["这个方案已具备实施条件。", "This plan is ready to implement."]:
        answer = ModelAnswer.model_validate(
            {"paragraphs": [{"text": claim, "evidence_ids": [status["id"]]}]}
        )
        with pytest.raises(ValueError, match="implementation"):
            bind_answer(answer, facts, [], allowed_actions=[], can_claim_optimal=True)


def test_daily_projection_excludes_old_product_semantics_even_in_archived_evidence(daily_run):
    context = {
        "reference": {"page": "rotation"},
        "fields": [],
        "warnings": [],
        "allowed_actions": [],
        "run": daily_run,
    }

    def help_item(identifier):
        return {
            "id": identifier,
            "excerpt": "Product method",
            "claims": [],
            "source": {
                "id": identifier,
                "title": identifier,
                "access_scope": "product_help",
                "regions": ["engineering"],
                "limitations": [],
            },
        }

    view = model_view(
        "如何计算？",
        context,
        {"facts": [], "knowledge": [help_item("HELPV2"), help_item("HELPV3")]},
    )
    assert [item["id"] for item in view["knowledge"]] == ["HELPV3"]


def test_all_generated_daily_alternatives_have_qualified_pairwise_directions(daily_run):
    from copy import deepcopy

    third = deepcopy(daily_run["result"]["options"][0])
    third["id"] = "option-3"
    third["verification"]["metrics"]["water"] = 1800
    daily_run["result"]["options"].append(third)
    _, view = projected(daily_run, "比较这些备选方案的水量")
    comparisons = view["context"]["within_run_comparisons"]
    assert len(comparisons) == 2
    assert comparisons[1]["direction_second_minus_first"]["water"] == "lower"
    assert not any(f["option_role"] is None and "Baseline" in f["label"] for f in view["facts"])


def test_actual_preparation_failure_exposes_bound_reason_count_and_baseline_date():
    run = json.loads(
        (
            Path(__file__).parent / "fixtures/assistant-preparation-failure.json"
        ).read_text()
    )
    run["selected_option_id"] = None
    facts, view = projected(run, "为什么这次没有方案？需要改什么？")
    lookup = {fact["key"]: fact for fact in facts}
    count = lookup["current.preparation.rejected.irrigation_unavailable"]
    assert count["value"] == 9
    assert count["source"]["run_id"] == run["id"]
    assert count["source"]["failure_scope"] == "generated_candidates_only"
    assert "灌溉设施" in count["label"]
    sow = lookup["current.preparation.error.0.sow_date"]
    assert sow["value"] == "2027-04-20"
    assert sow["source"]["field_id"] == run["field_snapshots"][0]["id"]
    assert any(f["id"] == count["id"] and f["render_reference"] for f in view["facts"])
    assert (
        view["context"]["answer_requirement"] == "explain_run_status_without_requesting_an_option"
    )
    assert not any(f["key"].endswith(".water") or f["key"].endswith(".profit") for f in facts)


def test_preparation_error_details_are_bounded_without_hiding_total(daily_run):
    daily_run.update(
        status="failed",
        selected_option_id=None,
        result={
            "error_code": "preparation_blocked",
            "preparation": {
                "ready": False,
                "stage": "candidate_preparation",
                "errors": ["field_has_no_candidate"] * 20,
                "rejected_by_reason": {},
            },
        },
    )
    facts, _ = projected(daily_run)
    lookup = {f["key"]: f for f in facts}
    assert lookup["current.preparation.error_count"]["value"] == 20
    assert len([key for key in lookup if key.startswith("current.preparation.error.")]) == 12
    assert lookup["current.preparation.shown_error_count"]["value"] == 12
    assert any(
        "full" in line for line in lookup["current.preparation.shown_error_count"]["limitations"]
    )


def test_resource_amounts_are_linked_to_their_own_date_not_a_plan_total(daily_run):
    option = daily_run["result"]["options"][0]
    option["verification"].update(
        diagnostic=True,
        resource_feasible=False,
        gap_cost=60,
        resources=[
            {
                "id": "water:shared:2027-04-20",
                "kind": "water",
                "used": 10,
                "capacity": 4,
                "gap": 6,
                "unit": "m3",
                "gap_cost": 60,
                "remedy": "Confirm additional allocation",
                "evidence_ids": [],
            }
        ],
    )
    facts, view = projected(daily_run, "这个方案供水缺口是多少？")
    gap = next(f for f in facts if f["key"] == "current.option-1.resource.0.gap")
    date_fact = next(f for f in facts if f["key"] == "current.option-1.resource.0.date")
    projected_gap = next(f for f in view["facts"] if f["id"] == gap["id"])
    assert projected_gap["scope"] == "single_resource_constraint_not_plan_total"
    assert projected_gap["date_reference"] == "{{" + date_fact["id"] + "}}"
    assert projected_gap["quantity_kind"] == "gap"
    assert projected_gap["resource_group"]
    assert "2027-04-20" not in projected_gap["resource_group"]
    overview = view["context"]["resource_gap_overviews"][0]
    assert overview["details_truncated"] is False
    assert overview["gap_total_reference"] is None
    assert overview["count_reference"] and overview["shown_count_reference"]
