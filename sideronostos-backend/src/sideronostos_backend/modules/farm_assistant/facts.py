"""Server-owned fact identifiers and displays shared by versioned evidence adapters."""

from typing import Any


def add_fact(
    facts: list[dict[str, Any]],
    key: str,
    label: str,
    value: Any,
    unit: str,
    source: dict[str, Any],
    *,
    language: str = "zh",
    limitations: list[str] | None = None,
) -> None:
    if value is None:
        display = "缺测 / unavailable" if language == "zh" else "unavailable"
    elif isinstance(value, (float, int)) and not isinstance(value, bool):
        display = f"{value:,.2f} {unit}".strip()
    else:
        display = f"{value} {unit}".strip()
    facts.append(
        {
            "id": f"F{len(facts) + 1}",
            "key": key,
            "label": label,
            "value": value,
            "unit": unit,
            "display": display,
            "source": source,
            "limitations": limitations or [],
        }
    )
