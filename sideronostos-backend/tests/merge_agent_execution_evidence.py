"""Combine opt-in real-business test output into the 39-operation acceptance record."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text())
    expected = {item["operation_id"] for item in catalog["items"]}
    rows = []
    for domain in ("field_management", "remote_sensing", "rotation"):
        file = args.directory / f"{domain}.json"
        data = json.loads(file.read_text())
        if data["domain"] != domain:
            raise ValueError(f"Wrong domain in {file}")
        rows.extend({"domain": domain, **item} for item in data["items"])
    actual = [item["operation_id"] for item in rows]
    if len(actual) != len(set(actual)) or set(actual) != expected:
        raise ValueError("Actual business results do not cover the full registered catalog")
    for item in rows:
        item["passed"] = item["result_link_present"] and (
            item["chat_status"] == "completed" and item["business_status"] == "succeeded"
            or item["chat_status"] == "pending"
            and item.get("final_workflow_status") == "completed"
        )
    output = {
        "environment": (
            "synthetic verified owner, dedicated PostgreSQL/pgvector, real assistant and "
            "business HTTP routes, synthetic weather/SMAP/NASA catalog fixtures; "
            "no live NASA acquisition or production model"
        ),
        "total": len(rows),
        "passed": sum(item["passed"] for item in rows),
        "items": sorted(rows, key=lambda item: item["operation_id"]),
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(f"{output['passed']}/{output['total']} real synthetic business operations passed")
    if output["passed"] != output["total"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
