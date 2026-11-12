from types import SimpleNamespace

from sideronostos_backend.modules.farm_assistant.evaluation import run


def test_evaluation_counts_rejected_and_repaired_provider_responses():
    calls = [
        {
            "parsed": {"text": "rejected"},
            "raw": SimpleNamespace(
                usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110},
                response_metadata={"token_usage": {"cost": 0.001}},
            ),
            "attempts": [],
        },
        {
            "parsed": {"text": "corrected"},
            "raw": SimpleNamespace(
                usage_metadata={"input_tokens": 200, "output_tokens": 20, "total_tokens": 220},
                response_metadata={"token_usage": {"cost": 0.002}},
            ),
            "attempts": [],
        },
    ]
    recorded = run.observed_metrics(calls)
    assert recorded["usage"]["total_tokens"] == 330
    assert recorded["provider_reported_chat_cost_usd"] == 0.003
    assert recorded["raw_model_answer"] == {"text": "corrected"}
    assert [r["parsed"] for r in recorded["provider_responses"]] == [c["parsed"] for c in calls]
