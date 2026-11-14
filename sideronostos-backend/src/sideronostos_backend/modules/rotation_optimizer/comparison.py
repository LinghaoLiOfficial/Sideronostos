"""One comparison contract shared by the results API and assistant snapshots.

Callers must resolve both run views through authenticated ownership checks first.
"""

from typing import Any

from fastapi import HTTPException


def compare_run_views(
    a: dict[str, Any], b: dict[str, Any], first_option_id: str, second_option_id: str
) -> dict[str, Any]:
    version_a = a["request"].get("model_version", "rotation-milp-v2.0")
    version_b = b["request"].get("model_version", "rotation-milp-v2.0")
    if version_a != version_b:
        raise HTTPException(422, "Compare results from the same model version")
    if a["id"] == b["id"]:
        raise HTTPException(422, "Select two different completed runs")

    def field_identity(run: dict[str, Any]) -> list[tuple[str, int]]:
        return sorted((f["id"], f["version"]) for f in run["field_snapshots"])

    if (
        field_identity(a) != field_identity(b)
        or any(a["request"][k] != b["request"][k] for k in ("start", "end", "profile_id"))
        or a["provenance"]["weather_sha256"] != b["provenance"]["weather_sha256"]
        or a["provenance"].get("profile_sha256") != b["provenance"].get("profile_sha256")
    ):
        raise HTTPException(
            422, "Runs need matching field versions, horizon, profile and weather release"
        )
    if a["status"] in ("pending", "running", "cancelled", "failed", "timeout_no_solution") or b[
        "status"
    ] in ("pending", "running", "cancelled", "failed", "timeout_no_solution"):
        raise HTTPException(422, "Both runs need completed calculated results")
    choices = []
    for run, option_id in [(a, first_option_id), (b, second_option_id)]:
        result = run["result"] or {}
        options = [*result.get("options", []), result.get("baseline")]
        option = next((o for o in options if o and o["id"] == option_id), None)
        if option is None or not option.get("complete", True):
            raise HTTPException(422, "Select a complete calculated option in each run")
        if version_a == "rotation-milp-v3.0" and not option.get("scientific_verification", {}).get(
            "valid"
        ):
            raise HTTPException(422, "Comparison requires scientifically verified options")
        choices.append(option)
    daily = version_a == "rotation-milp-v3.0"
    before, after = [o["verification"]["metrics" if daily else "totals"] for o in choices]
    definitions = [
        o.get("objective_definition", run["result"].get("objective_definition", {}))
        for o, run in zip(choices, (a, b), strict=True)
    ]
    weights = [
        definition.get("weights", run["request"].get("weights"))
        for definition, run in zip(definitions, (a, b), strict=True)
    ]
    scale_key = "scales" if daily else "references"

    return {
        "first_run_id": a["id"],
        "second_run_id": b["id"],
        "first_option_id": first_option_id,
        "second_option_id": second_option_id,
        "delta": {
            k: after[k] - before[k] if before[k] is not None and after[k] is not None else None
            for k in before
        },
        "unavailable_metrics": [k for k in before if before[k] is None or after[k] is None],
        "model_version": version_a,
        "input_changes": {
            k: {"before": a["request"][k], "after": b["request"][k]}
            for k in a["request"]
            if k != "idempotency_key" and a["request"][k] != b["request"][k]
        },
        "score_comparable": weights[0] == weights[1]
        and definitions[0].get(scale_key) == definitions[1].get(scale_key),
        "interpretation": (
            "second minus first; estimates under their respective scenarios, not measured outcomes"
        ),
    }
