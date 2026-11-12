from sideronostos_backend.modules.farm_assistant.context import append_run_facts


def test_run_evidence_includes_calendar_year_and_zero_activity_with_exact_scope():
    # Hand-written snapshot. No model or optimizer is stubbed; this tests the evidence adapter.
    run = {
        "id": "run-a",
        "status": "optimal",
        "selected_option_id": "option-1",
        "request": {"start": "2027-01-01", "end": "2028-12-31"},
        "provenance": {"profile_id": "p", "weather_release_id": "w", "limitations": ["benchmark"]},
        "result": {
            "options": [
                {
                    "id": "option-1",
                    "label": "Option 1",
                    "feasible": True,
                    "solver": {"status": "optimal"},
                    "verification": {
                        "totals": {"cost_usd": 80},
                        "farm_years": {"2027": {"cost_usd": 80}},
                    },
                    "seasons": [
                        {
                            "field_id": "north",
                            "crop_id": "pea",
                            "sow_date": "2027-04-05",
                            "harvest_date": "2027-06-20",
                            "occupied_until": "2027-07-04",
                            "growing_days": 77,
                        }
                    ],
                }
            ]
        },
    }
    facts = []
    append_run_facts(facts, run, "current", "zh")
    bykey = {f["key"]: f for f in facts}
    assert bykey["current.option-1.2028.cost_usd"]["value"] == 0
    assert bykey["current.year.2028"]["display"] == "2028"
    calendar = next(f for f in facts if f["value"] == "2027-06-20")
    assert calendar["source"]["field_id"] == "north"
    assert calendar["source"]["option_id"] == "option-1"
    assert calendar["source"]["calendar_kind"] == "modeled_maturity"
    assert any(f["value"] == "2027-07-04" for f in facts)
