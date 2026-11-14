"""Server-owned bot identities and bounded remote-sensing capabilities."""

from typing import Any

BOT_PRESETS = {
    "field-guide": "field_management",
    "remote-water": "remote_sensing",
    "remote-soil": "remote_sensing",
    "remote-weather": "remote_sensing",
    "local-knowledge-guide": "local_agriculture",
    "rotation-guide": "rotation",
}

DEFAULT_BOTS = {
    "field_management": "field-guide",
    "remote_sensing": "remote-water",
    "local_agriculture": "local-knowledge-guide",
    "rotation": "rotation-guide",
}

REMOTE_METRICS = {
    "remote-water": frozenset({"surface_soil_moisture", "rainfall_total", "reference_et0_total"}),
    "remote-soil": frozenset({"surface_soil_moisture"}),
    "remote-weather": frozenset({"rainfall_total", "reference_et0_total"}),
}

REMOTE_SOURCES = {
    "remote-water": ["S01", "S09", "S11", "S29", "S36", "SMAP006"],
    "remote-soil": ["S09", "SMAP006"],
    "remote-weather": ["S01", "S11", "S29", "S36"],
}


def default_bot_id(preset: str) -> str:
    return DEFAULT_BOTS[preset]


def scoped_sources(bot_id: str, requested: list[str] | None) -> list[str] | None:
    permitted = REMOTE_SOURCES.get(bot_id)
    if permitted is None:
        return requested
    return [source for source in permitted if requested is None or source in requested]


def _fact_allowed(bot_id: str, fact: dict[str, Any]) -> bool:
    source = fact.get("source") or {}
    product = source.get("product")
    key = fact.get("key", "")
    if not key.startswith("science."):
        return False
    if product == "SPL3SMP_E":
        metric = source.get("metric") or (
            "surface_soil_moisture" if "surface_moisture" in key else None
        )
        return metric == "surface_soil_moisture" and metric in REMOTE_METRICS[bot_id]
    if product == "NASA_POWER_DAILY":
        metric = source.get("metric") or next(
            (name for name in ("rainfall_total", "reference_et0_total") if name in key), None
        )
        return metric in REMOTE_METRICS[bot_id]
    return False


def scope_context(context: dict[str, Any], bot_id: str) -> dict[str, Any]:
    if bot_id not in REMOTE_METRICS:
        return context
    scoped = dict(context)
    scoped["facts"] = [fact for fact in context["facts"] if _fact_allowed(bot_id, fact)]
    scoped["fields"] = []
    scoped["run"] = None
    scoped["comparison"] = None
    scoped["v1_analysis"] = None
    scoped["allowed_actions"] = ["view_sources"]
    scoped["can_claim_optimal"] = False
    if context.get("science"):
        science = dict(context["science"])
        unavailable_reasons = {item.get("reason") for item in science.get("unavailable", [])}
        scoped["warnings"] = [
            warning for warning in context.get("warnings", []) if warning not in unavailable_reasons
        ]
        science["facts"] = [
            fact
            for fact in science["facts"]
            if fact.get("metric") in REMOTE_METRICS[bot_id]
            and _fact_allowed(
                bot_id,
                {
                    "key": "science.",
                    "source": {**(fact.get("source") or {}), "metric": fact["metric"]},
                },
            )
        ]
        # Unavailability records only carry release IDs, not product identity.
        # They cannot be safely attributed to this specialty.
        science["unavailable"] = []
        scoped["science"] = science
    return scoped


def action_allowed(bot_id: str, action: str, metric: object = None) -> bool:
    if bot_id not in REMOTE_METRICS:
        return True
    if action == "field.create":
        return False
    if action == "remote_sensing.fact" and metric is not None:
        return isinstance(metric, str) and metric in REMOTE_METRICS[bot_id]
    return action in {"remote_sensing.layer", "remote_sensing.fact"}


def layer_allowed(bot_id: str, product: str | None) -> bool:
    if bot_id not in REMOTE_METRICS:
        return True
    if product == "SPL3SMP_E":
        return "surface_soil_moisture" in REMOTE_METRICS[bot_id]
    if product in {"NASA_POWER_DAILY", "NASA_POWER_DAILY_WITH_GPM"} or (product or "").startswith(
        "GPM_"
    ):
        return bool(REMOTE_METRICS[bot_id] & {"rainfall_total", "reference_et0_total"})
    return False
