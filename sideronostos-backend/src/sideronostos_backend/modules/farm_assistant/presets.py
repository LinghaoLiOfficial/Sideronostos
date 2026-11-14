PRESETS = {
    "field_management": {
        "id": "field_management",
        "enabled": True,
        "name": "地块助手",
        "name_en": "Fields",
        "description": "查看和理解自己的地块资料。",
        "description_en": "Understand your own fields and their saved details.",
        "color": "#4d9b75",
    },
    "remote_sensing": {
        "id": "remote_sensing",
        "enabled": True,
        "name": "遥感助手",
        "name_en": "Remote sensing",
        "description": "解释已选区域的遥感事实和数据局限。",
        "description_en": "Explain remote-sensing facts for a selected area and their limits.",
        "color": "#4b8cb8",
    },
    "local_agriculture": {
        "id": "local_agriculture",
        "enabled": True,
        "name": "本地农业知识助手",
        "name_en": "Local agriculture",
        "description": "解释有来源的本地规则和专家知识；价格与品种仅为 mock 示例。",
        "description_en": (
            "Explain sourced local rules and expert knowledge; prices and varieties "
            "are mock examples only."
        ),
        "color": "#ca9a4e",
    },
    "rotation": {
        "id": "rotation",
        "enabled": True,
        "name": "轮作助手",
        "name_en": "Rotation",
        "description": "解释轮作、当前方案与经营取舍。",
        "description_en": "Explain rotation, current plans and farm trade-offs.",
        "color": "#8671d9",
    },
}


def enabled_presets() -> list[dict[str, object]]:
    return [dict(p) for p in PRESETS.values() if p["enabled"]]
