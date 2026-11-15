"""Small, opt-in record of actual synthetic chat-to-business operation outcomes."""

import json
import os
from pathlib import Path


def record(rows: dict[str, dict], operation_id: str, task: dict) -> None:
    if operation_id in rows:
        return
    execution = task["execution"]
    rows[operation_id] = {
        "operation_id": operation_id,
        "chat_status": task["status"],
        "business_status": execution["status"],
        "business_http_status": execution["status_code"],
        "content_type": execution["content_type"],
        "result_link_present": bool(task.get("href") or task.get("result_page_url")),
    }


def save(domain: str, rows: dict[str, dict]) -> None:
    directory = os.getenv("AGENT_EXECUTION_MATRIX_DIR")
    if not directory:
        return
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{domain}.json").write_text(
        json.dumps({"domain": domain, "items": list(rows.values())}, indent=2) + "\n"
    )
