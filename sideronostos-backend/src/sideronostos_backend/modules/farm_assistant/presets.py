PRESETS = {
    "rotation": {
        "id": "rotation",
        "enabled": True,
        "name": "轮作助手",
        "name_en": "Rotation",
        "description": "解释轮作、当前方案与经营取舍。",
        "color": "#8671d9",
    },
    "soil_water": {"id": "soil_water", "enabled": False, "name": "水土助手"},
    "crop": {"id": "crop", "enabled": False, "name": "作物助手"},
}


def enabled_presets() -> list[dict[str, object]]:
    return [dict(p) for p in PRESETS.values() if p["enabled"]]
