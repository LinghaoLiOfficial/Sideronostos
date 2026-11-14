from sideronostos_backend.modules.farm_assistant.model_view import model_view


def context(selected="option-1"):
    return {
        "reference": {"page": "rotation", "draft": {"dirty": False}},
        "warnings": [],
        "allowed_actions": ["open_planner"],
        "fields": [],
        "selection": None,
        "science": None,
        "can_claim_optimal": True,
        "run": {
            "status": "optimal",
            "selected_option_id": selected,
            "provenance": {
                "benchmark_scope": "benchmark_not_locally_calibrated",
                "limitations": [],
            },
            "result": {
                "options": [
                    {
                        "id": "option-1",
                        "feasible": True,
                        "solver": {"status": "optimal"},
                        "verification": {"violations": []},
                        "seasons": [],
                    }
                ]
            },
        },
        "comparison": None,
    }


def test_model_cannot_mix_unselected_metrics_even_with_verified_displays():
    facts = [
        {
            "id": "F1",
            "key": "current.option-1.water_m3",
            "label": "current / Option 1: water",
            "value": 12345,
            "display": "12,345.00 m³",
            "unit": "m³",
            "source": {"option_id": "option-1"},
        },
        {
            "id": "F2",
            "key": "current.option-2.water_m3",
            "label": "other water",
            "value": 999,
            "display": "999 m³",
            "unit": "m³",
            "source": {"option_id": "option-2"},
        },
        {
            "id": "F3",
            "key": "current.option-1.cost_usd",
            "label": "cost",
            "value": 222,
            "display": "222 USD",
            "unit": "USD",
            "source": {"option_id": "option-1"},
        },
    ]
    result = model_view("估算补水总量是多少？", context(), {"facts": facts, "knowledge": []})
    assert [f["id"] for f in result["facts"]] == ["F1"]
    assert result["facts"][0]["verified_display"] == "12,345.00 m³"
    assert "999" not in str(result) and "222" not in str(result)
    assert result["facts"][0]["role"] == "selected calculation"


def test_unselected_plan_does_not_expose_any_option_metrics_to_model():
    fact = {
        "id": "F1",
        "key": "current.option-1.water_m3",
        "label": "water",
        "value": 8,
        "display": "8 m³",
        "unit": "m³",
        "source": {"option_id": "option-1"},
    }
    result = model_view("这个方案为什么最好？", context(None), {"facts": [fact], "knowledge": []})
    assert result["facts"] == []
    assert result["context"]["answer_requirement"] == "ask_to_select_specific_option"


def test_annual_metrics_link_their_calendar_year_placeholder_without_exposing_literal_year():
    facts = [
        {
            "id": "F1",
            "key": "current.year.2027",
            "label": "current: calendar year",
            "value": "2027",
            "source": {"option_id": "option-1"},
        },
        {
            "id": "F2",
            "key": "current.option-1.2027.cost_usd",
            "label": "current / 2027: cost",
            "value": 1000,
            "source": {"option_id": "option-1", "year": 2027},
        },
    ]
    result = model_view("各年的投入是多少？", context(), {"facts": facts, "knowledge": []})
    cost = next(f for f in result["facts"] if f["id"] == "F2")
    assert cost["year_reference"] == "{{F1}}"
    assert "2027" not in str(result)


def test_unsupported_yield_is_a_product_limit_before_any_missing_plan_clarification():
    result = model_view("请保证当前方案会提高产量。", context(None), {"facts": [], "knowledge": []})
    assert (
        result["context"]["answer_requirement"]
        == "yield_and_profit_are_not_computed_even_after_recalculation"
    )
    assert result["context"]["allowed_actions"] == []


def test_comparison_roles_do_not_assume_the_second_selected_run_is_newer():
    import copy

    c = context()
    c["comparison"] = {
        "run": copy.deepcopy(c["run"]),
        "score_comparable": True,
        "input_changes": {},
    }
    view = model_view("比较用水量", c, {"facts": [], "knowledge": []})
    assert [r["role"] for r in view["context"]["calculations"]] == [
        "reference calculation",
        "comparison calculation",
    ]


def test_science_warnings_keep_their_release_instead_of_becoming_global_causes():
    c = context()
    c["warnings"] = ["outside_time_coverage", "draft_not_calculated"]
    c["science"] = {
        "unavailable": [{"release_id": "power-history", "reason": "outside_time_coverage"}]
    }
    fact = {
        "id": "F1",
        "key": "science.smap:AM:surface_moisture",
        "label": "surface moisture AM",
        "value": None,
        "source": {
            "release_id": "smap-day",
            "product": "SPL3SMP_E",
            "status": "no_recommended_retrieval",
        },
    }
    view = model_view("SMAP 水分是多少？", c, {"facts": [fact], "knowledge": []})
    assert view["context"]["warnings"] == ["draft_not_calculated"]
    assert view["context"]["science_missing"] == []
    for question in [
        "Morning moisture is available but evening is missing",
        "表层水分为什么缺失？",
    ]:
        moisture_view = model_view(question, c, {"facts": [fact], "knowledge": []})
        assert moisture_view["context"]["science_missing"] == []
    weather_view = model_view("SMAP 和天气数据分别缺什么？", c, {"facts": [fact], "knowledge": []})
    assert weather_view["context"]["science_missing"] == c["science"]["unavailable"]
    assert view["facts"][0]["data_release"] == "smap-day"
    assert view["facts"][0]["quality_status"] == "no_recommended_retrieval"


def test_infeasible_run_explanation_does_not_request_a_nonexistent_option():
    c = context(None)
    c["run"]["status"] = "infeasible"
    c["run"]["result"]["options"] = []
    view = model_view("这个方案为何无解？", c, {"facts": [], "knowledge": []})
    assert (
        view["context"]["answer_requirement"] == "explain_run_status_without_requesting_an_option"
    )


def test_options_inside_one_run_are_not_misrouted_to_a_second_run_request():
    import copy

    c = context()
    first = c["run"]["result"]["options"][0]
    first["verification"]["totals"] = {"water_m3": 120, "cost_usd": 50}
    second = copy.deepcopy(first)
    second["id"] = "option-2"
    second["verification"]["totals"] = {"water_m3": 80, "cost_usd": 60}
    c["run"]["result"]["options"].append(second)
    facts = [
        {
            "id": "F1",
            "key": "current.option-1.water_m3",
            "label": "Option 1 water",
            "value": 120,
            "source": {"option_id": "option-1"},
        },
        {
            "id": "F2",
            "key": "current.option-2.water_m3",
            "label": "Option 2 water",
            "value": 80,
            "source": {"option_id": "option-2"},
        },
    ]
    for question in [
        "Compare the two options from this run in plain language.",
        "How do both options trade off water use and cost?",
        "Compare all options from this calculation.",
        "比较这次计算的两个方案",
    ]:
        view = model_view(question, c, {"facts": facts, "knowledge": []})
        assert "answer_requirement" not in view["context"]
        assert {f["id"] for f in view["facts"]} == {"F1", "F2"}
        assert [f["option_role"] for f in view["facts"]] == ["alternative A", "alternative B"]
        pair = view["context"]["within_run_comparison"]
        assert pair["direction_B_minus_A"]["water_m3"] == "lower"
        assert pair["direction_B_minus_A"]["cost_usd"] == "higher"


def test_result_metrics_have_renderable_references_and_cannot_be_confused_with_measurements():
    facts = [
        {
            "id": "F1",
            "key": "current.option-1.water_m3",
            "label": "estimated water",
            "value": 123,
            "source": {"kind": "optimization", "option_id": "option-1"},
        },
        {
            "id": "F2",
            "key": "science.smap.am",
            "label": "surface moisture",
            "value": 0.2,
            "source": {"kind": "science", "product": "SPL3SMP_E"},
        },
    ]
    view = model_view("解释水分资料和估算用水", context(), {"facts": facts, "knowledge": []})
    estimate, observation = view["facts"]
    assert estimate["render_reference"] == "{{F1}}"
    assert estimate["origin"] == "model_result_not_measured"
    assert observation["origin"] != estimate["origin"]
    assert "123" not in str(view)
    assert (
        "is_zero" not in estimate
    )  # Do not substitute a zero/nonzero hint for the available value.


def test_annual_value_order_is_derived_by_server_and_keeps_equal_years_together():
    facts = []
    for year, year_id, value_id, value in [
        (2027, "F1", "F2", 100),
        (2028, "F3", "F4", 0),
        (2029, "F5", "F6", 100),
    ]:
        facts.extend(
            [
                {
                    "id": year_id,
                    "key": f"current.year.{year}",
                    "label": "year",
                    "value": str(year),
                    "source": {},
                },
                {
                    "id": value_id,
                    "key": f"current.option-1.{year}.cost_usd",
                    "label": "estimated cost",
                    "value": value,
                    "source": {"kind": "optimization", "option_id": "option-1", "year": year},
                },
            ]
        )
    view = model_view("各年投入有什么差别？", context(), {"facts": facts, "knowledge": []})
    order = view["context"]["annual_metric_orderings"][0]
    assert order["metric"] == "cost_usd"
    assert order["ascending_equal_value_groups"] == [["{{F4}}"], ["{{F2}}", "{{F6}}"]]
    assert "2027" not in str(view) and "100" not in str(view)


def test_model_reads_verified_display_but_status_is_not_a_renderable_number():
    facts = [
        {
            "id": "F1",
            "key": "current.status",
            "label": "status",
            "value": "optimal",
            "display": "optimal",
            "source": {"kind": "optimization"},
        },
        {
            "id": "F2",
            "key": "current.option-1.cost_usd",
            "label": "estimated cost",
            "value": 12345,
            "display": "12,345.00 USD",
            "source": {"kind": "optimization", "option_id": "option-1"},
        },
    ]
    view = model_view("当前方案成本是多少？", context(), {"facts": facts, "knowledge": []})
    status, cost = view["facts"]
    assert status["render_reference"] is None
    assert cost["verified_display"] == "12,345.00 USD"
    assert cost["render_reference"] == "{{F2}}"


def test_unselected_option_request_does_not_leak_run_optimality_into_explanation():
    fact = {
        "id": "F1",
        "key": "current.status",
        "label": "status",
        "value": "optimal",
        "display": "optimal",
        "source": {"kind": "optimization"},
    }
    view = model_view("这个方案为什么最好？", context(None), {"facts": [fact], "knowledge": []})
    assert not view["facts"]
    assert "optimal" not in str(view["context"]["calculations"])
    assert view["context"]["answer_requirement"] == "ask_to_select_specific_option"


def test_chinese_by_year_and_english_each_year_keep_annual_facts():
    facts = [
        {
            "id": "F1",
            "key": "current.year.2027",
            "label": "year",
            "value": "2027",
            "display": "2027",
            "source": {},
        },
        {
            "id": "F2",
            "key": "current.option-1.2027.labor_days",
            "label": "labour",
            "value": 3,
            "display": "3.00 person-days",
            "source": {"option_id": "option-1", "year": 2027},
        },
    ]
    for question in ["按年需要多少劳力？", "What is the labour estimate for each year?"]:
        view = model_view(question, context(), {"facts": facts, "knowledge": []})
        assert [f["id"] for f in view["facts"]] == ["F1", "F2"]
        assert view["facts"][1]["year_reference"] == "{{F1}}"
