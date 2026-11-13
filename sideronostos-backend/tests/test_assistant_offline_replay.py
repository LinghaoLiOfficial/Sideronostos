"""Replay saved provider outputs against real local guards; never invoke a provider."""

import hashlib
import json
import socket

import pytest

from sideronostos_backend.modules.farm_assistant.evaluation.replay import replay, write_report


def artifact_pair(tmp_path, texts):
    context = {
        "reference": {"page": "map"},
        "fields": [],
        "warnings": [],
        "allowed_actions": [],
        "can_claim_optimal": False,
    }
    fact = {
        "id": "F1",
        "key": "soil.moisture",
        "label": "表层水分",
        "value": 0.29,
        "display": "0.29 m³/m³",
        "source": {"kind": "observed"},
    }
    fixtures = tmp_path / "fixtures.json"
    fixtures.write_text(
        json.dumps(
            {
                "case_sha256": "frozen-cases",
                "contexts": {"soil": {"context": context}},
            }
        )
    )
    rows = [
        {
            "attempt_id": f"soil/{i}",
            "case_id": "soil",
            "question": "水分是多少？",
            "status": "complete",
            "evidence": {"facts": [fact], "knowledge": []},
            "raw_model_answer": None
            if text is None
            else {
                "paragraphs": [{"text": text, "evidence_ids": []}],
                "actions": [],
                "needs_clarification": False,
            },
        }
        for i, text in enumerate(texts, 1)
    ]
    report = tmp_path / "run.json"
    report.write_text(
        json.dumps(
            {
                "schema": "rotation-evaluation-run-v1",
                "case_sha256": "frozen-cases",
                "fixtures_sha256": hashlib.sha256(fixtures.read_bytes()).hexdigest(),
                "pipeline": {"source_sha256": "old-source", "model": "recorded-model"},
                "results": rows,
            }
        )
    )
    return report, fixtures


def test_replay_binds_archived_slots_without_network_or_editing_inputs(tmp_path, monkeypatch):
    def forbid_network(*args, **kwargs):
        raise AssertionError("Offline replay attempted network access")

    monkeypatch.setattr(socket.socket, "connect", forbid_network)
    report, fixtures = artifact_pair(tmp_path, ["表层水分为 {{F1}}。"])
    before = (report.read_bytes(), fixtures.read_bytes())
    result = replay(report, fixtures)
    assert result["summary"] == {"attempts": 1, "accepted": 1, "rejected": 0, "not_replayable": 0}
    assert result["rows"][0]["status"] == "accepted"
    assert result["rows"][0]["bound_fact_ids"] == ["F1"]
    assert result["semantic_quality"] == "NOT_EVALUATED"
    assert result["provider_calls"] == 0
    assert (report.read_bytes(), fixtures.read_bytes()) == before
    assert "0.29" not in json.dumps(result)


def test_replay_rejects_unicode_numbers_unknown_slots_and_unavailable_actions(tmp_path):
    report, fixtures = artifact_pair(
        tmp_path, ["年份是٢٠٢٧。", "根据[K①]。", "水分是{{F9}}。", "请打开页面。"]
    )
    data = json.loads(report.read_text())
    data["results"][1]["raw_model_answer"]["paragraphs"][0]["evidence_ids"] = ["F1"]
    data["results"][-1]["raw_model_answer"]["actions"] = ["open_planner"]
    report.write_text(json.dumps(data))
    result = replay(report, fixtures)
    assert result["summary"]["rejected"] == 4
    assert [r["stage"] for r in result["rows"]] == ["schema", "binding", "schema", "binding"]
    assert result["rows"][1]["reason"] == "Numbers must come from server-bound facts"
    assert result["rows"][3]["reason"] == "Action not available in this context"


def test_replay_refuses_mismatched_or_mutated_fixtures(tmp_path):
    report, fixtures = artifact_pair(tmp_path, ["水分为{{F1}}。"])
    fixtures.write_text(fixtures.read_text() + " ")
    with pytest.raises(ValueError, match="Fixture hash"):
        replay(report, fixtures)


def test_missing_provider_output_is_not_counted_as_pass_and_output_is_exclusive(tmp_path):
    report, fixtures = artifact_pair(tmp_path, [None])
    result = replay(report, fixtures)
    assert result["summary"] == {"attempts": 1, "accepted": 0, "rejected": 0, "not_replayable": 1}
    assert result["decision"] == "offline_diagnostics_only"
    output = tmp_path / "replay.json"
    write_report(result, output)
    saved = output.read_bytes()
    with pytest.raises(FileExistsError):
        write_report(result, output)
    assert output.read_bytes() == saved
