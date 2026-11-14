"""Tiny synthetic, fully enumeratable model fixtures; not agronomic defaults."""

from datetime import date, timedelta

START = date(2027, 1, 1)


def day(offset):
    return START + timedelta(days=offset)


def cap(value, soft=True, cost=1):
    return {
        "capacity": value,
        "remediable": soft,
        "gap_unit_cost": cost if soft else None,
        "remedy": "Synthetic fixture supplementation" if soft else None,
        "evidence_ids": ["fixture"],
    }


def candidate(identifier, start=0, crop=None, **changes):
    crop = crop or identifier
    result = dict(
        id=identifier,
        field_id="f",
        crop_id=crop,
        species_id=crop,
        family=crop,
        sow_date=day(start),
        harvest_date=day(start + 1),
        turnaround_days=1,
        water_mm=[0, 0],
        cover_mask=[True, True, False],
        seed_kg_ha=1,
        yield_kg_ha=10,
        profit_usd_ha=10,
        soil_score=0.3,
        risk_score=0.1,
        machine_hours_ha={"m": {day(start): 1}},
        suitability=dict(sow=True, soil=True, terrain=True, climate=True, management=True),
        baseline_confirmed=True,
    )
    result.update(changes)
    return result


def problem(candidates=None, **changes):
    candidates = candidates or [candidate("a"), candidate("b", 3)]
    crops = sorted({c["crop_id"] for c in candidates})
    horizon_end = changes.get("end", day(5))
    count = (horizon_end - START).days + 1
    result = dict(
        start=day(0),
        end=horizon_end,
        fields=[
            dict(
                id="f",
                farm_id="farm",
                area_ha=2,
                irrigation_available=True,
                water_system_id="w",
                history=[],
            )
        ],
        candidates=candidates,
        family_gaps={c["family"]: 0 for c in candidates},
        periods=[dict(id="p", start=day(0), end=horizon_end)],
        daily_resources=[
            dict(
                id="w",
                farm_id="farm",
                kind="water",
                field_ids=["f"],
                days={day(i): cap(100) for i in range(count)},
            ),
            dict(
                id="m",
                farm_id="farm",
                kind="machine",
                field_ids=["f"],
                days={day(i): cap(100) for i in range(count)},
            ),
        ],
        period_resources=[
            dict(
                id=f"{kind}-{crop}",
                farm_id="farm",
                kind=kind,
                crop_id=crop,
                period_id="p",
                limit=cap(1000),
            )
            for crop in crops
            for kind in ("seed", "market")
        ],
        bare_limits={"f": cap(count)},
        bare_limit_disabled={},
        weights=dict(profit=0.3, water=0.2, rotation=0, soil=0.1, risk=0.1, bare=0.3),
        scales=dict(profit=100, water=100, soil=10, risk=10, bare=12),
        disabled_metrics={"rotation": "No reliable transition score in this synthetic fixture"},
        rotation_benefits=[],
    )
    result.update(changes)
    return result
