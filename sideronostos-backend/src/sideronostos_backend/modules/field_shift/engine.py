"""Explainable rotation enumeration: validate, filter hard constraints, then rank.

All numerical crop and rotation assumptions live in a versioned profile. This
engine estimates scenarios; it does not predict yield, soil health or profit.
"""

from calendar import monthrange
from collections import Counter
from datetime import date, timedelta
from hashlib import sha256
from itertools import product
from time import perf_counter

from .schemas import (
    Crop,
    EngineResult,
    Environment,
    Evidence,
    Field,
    PlanMetrics,
    PlanningInputs,
    PlanSeason,
    Profile,
    RejectionSummary,
    RotationOption,
    Rule,
    Violation,
)

RULE_MESSAGES = {
    "crop_gap": "同一作物的回归时间短于配置的轮作间隔。",
    "family_gap": "同一植物科的回归时间短于配置的间隔。",
    "annual_calendar": "作物的生长窗口跨出了其规划年份。",
    "soil_compatibility": "按当前配置，作物与已记录土壤质地不兼容。",
    "water_limit": "估计的单季灌溉缺口超过可用水量上限。",
    "cost_limit": "估计的年度投入成本超过预算。",
    "labor_limit": "估计的年度劳动量超过农户上限。",
    "allowed_crops": "当前种植安排包含已从候选作物中排除的作物。",
}
SUPPORTED_RULES = {"crop_gap", "family_gap", "annual_calendar", "soil_compatibility", "water_model"}


def _validate_inputs(
    field: Field,
    profile: Profile,
    environment: Environment,
    inputs: PlanningInputs,
) -> tuple[dict[str, Crop], dict[str, Rule]]:
    if field.profile_id != profile.id:
        raise ValueError("地块配置与所选规则配置不一致")
    if profile.is_demo and not inputs.accept_demo_assumptions:
        raise ValueError("比较前请先确认理解演示假设")
    crops = {crop.id: crop for crop in profile.crops}
    requested = set(inputs.allowed_crop_ids + inputs.baseline_crop_ids)
    requested.update(entry.crop_id for entry in field.history)
    if requested - crops.keys():
        raise ValueError(f"未知作物标识：{', '.join(sorted(requested - crops.keys()))}")
    if any(entry.year >= inputs.start_year for entry in field.history):
        raise ValueError("种植历史年份必须早于规划开始年份")
    rules: dict[str, Rule] = {}
    for rule in profile.rules:
        if rule.kind not in SUPPORTED_RULES or rule.kind in rules:
            raise ValueError(f"规则类型不受支持或重复：{rule.kind}")
        rules[rule.kind] = rule
        if rule.kind in {"crop_gap", "family_gap"}:
            gap = rule.parameters.get("intervening_years")
            if not isinstance(gap, int) or isinstance(gap, bool) or not 0 <= gap <= 20:
                raise ValueError(f"配置中的轮作间隔无效：{rule.id}")
    rain_rule = rules.get("water_model")
    fraction = rain_rule.parameters.get("effective_rainfall_fraction") if rain_rule else None
    if (
        not isinstance(fraction, (int, float))
        or isinstance(fraction, bool)
        or not 0 <= fraction <= 1
    ):
        raise ValueError("配置必须给出有效的降雨利用比例")
    if environment.status == "unavailable":
        raise ValueError("气候数据不可用，请刷新后再比较方案")
    months = {m.month: m for m in environment.months}
    if len(environment.months) != 12 or set(months) != set(range(1, 13)):
        raise ValueError("需要完整的十二个月参考气候数据")
    for month in months.values():
        if environment.status != "demo" and month.valid_days == 0:
            raise ValueError(f"以下月份没有有效气候观测：{month.month}")
        if month.rainfall_mm is None or month.tmin_c is None or month.tmax_c is None:
            raise ValueError(f"以下月份缺少降雨或温度数据：{month.month}")
        if month.tmin_c > month.tmax_c:
            raise ValueError(f"以下月份的温度上下界无效：{month.month}")
    return crops, rules


def _season(
    crop: Crop,
    year: int,
    field: Field,
    environment: Environment,
    inputs: PlanningInputs,
    rain_fraction: float,
) -> PlanSeason:
    # Imported here to keep profile/schema use independent from the network adapter.
    from .environment import estimate_reference_et

    try:
        sow = date(year, crop.sow_month, crop.sow_day)
    except ValueError as exc:
        raise ValueError(f"{year} 年作物 {crop.id} 的播种日历无效") from exc
    harvest = sow + timedelta(days=crop.duration_days - 1)
    months = {month.month: month for month in environment.months}
    demand_total = gap_total = 0.0
    day = sow
    while day <= harvest:
        month_end = date(day.year, day.month, monthrange(day.year, day.month)[1])
        segment_end = min(harvest, month_end)
        fraction = ((segment_end - day).days + 1) / monthrange(day.year, day.month)[1]
        weather = months[day.month]
        assert weather.tmin_c is not None and weather.tmax_c is not None
        assert weather.rainfall_mm is not None
        delta = inputs.scenario.temperature_change_c
        # Recalculate using scenario temperature and planning-year day lengths.
        reference_et = estimate_reference_et(
            day.month,
            weather.tmin_c + delta,
            weather.tmax_c + delta,
            field.latitude,
            day.year,
        )
        demand = reference_et * fraction * crop.kc
        rain = weather.rainfall_mm * (1 + inputs.scenario.rainfall_change_pct / 100)
        effective_rain = rain * fraction * rain_fraction
        demand_total += demand
        gap_total += max(0, demand - effective_rain)
        day = segment_end + timedelta(days=1)
    return PlanSeason(
        year=year,
        crop_id=crop.id,
        crop_name=crop.name,
        family=crop.family,
        sow_date=sow,
        harvest_date=harvest,
        water_demand_mm=round(demand_total, 2),
        irrigation_gap_mm=round(gap_total, 2),
        cover_days=crop.duration_days,
        cost_usd_ha=crop.estimated_cost_usd_ha,
        labor_days_ha=crop.estimated_labor_days_ha,
    )


def _violations(
    seasons: list[PlanSeason],
    field: Field,
    crops: dict[str, Crop],
    rules: dict[str, Rule],
    inputs: PlanningInputs,
) -> list[Violation]:
    violations: list[Violation] = []
    prior = [(h.year, crops[h.crop_id]) for h in sorted(field.history, key=lambda item: item.year)]
    water_limit = inputs.max_irrigation_mm if field.irrigation_available else 0.0
    for season in seasons:
        crop = crops[season.crop_id]
        for kind in ("crop_gap", "family_gap"):
            if kind not in rules:
                continue
            rule = rules[kind]
            for prior_year, prior_crop in prior:
                same = (
                    prior_crop.id == crop.id
                    if kind == "crop_gap"
                    else prior_crop.family == crop.family
                )
                if same and season.year - prior_year <= rule.parameters["intervening_years"]:
                    violations.append(
                        Violation(
                            rule_id=rule.id,
                            message=(
                                f"{season.year} 年 {crop.name}：{rule.description} "
                                f"此前同作物或同科记录：{prior_year} 年 {prior_crop.name}。"
                            ),
                        )
                    )
        if season.harvest_date.year != season.year:
            calendar_rule = rules.get("annual_calendar")
            violations.append(
                Violation(
                    rule_id=calendar_rule.id if calendar_rule else "annual_calendar",
                    message=f"{season.year} 年 {crop.name}：收获日期跨出了规划年份。",
                )
            )
        if field.soil_texture != "unknown" and field.soil_texture not in crop.allowed_soils:
            soil_rule = rules.get("soil_compatibility")
            violations.append(
                Violation(
                    rule_id=soil_rule.id if soil_rule else "soil_compatibility",
                    message=(
                        f"{season.year} 年 {crop.name}：土壤质地 {field.soil_texture} "
                        "不在此配置允许的土壤类型内。"
                    ),
                )
            )
        if crop.id not in inputs.allowed_crop_ids:
            violations.append(
                Violation(
                    rule_id="allowed_crops",
                    message=(
                        f"{season.year} {crop.name} is excluded from your allowed crop choices."
                    ),
                )
            )
        for metric, limit, rule_id, unit in (
            (season.irrigation_gap_mm, water_limit, "water_limit", "mm"),
            (season.cost_usd_ha, inputs.max_cost_usd_ha, "cost_limit", "USD/ha"),
            (season.labor_days_ha, inputs.max_labor_days_ha, "labor_limit", "days/ha"),
        ):
            if metric > limit + 1e-9:
                suffix = (
                    " 此地块没有灌溉条件。"
                    if rule_id == "water_limit" and not field.irrigation_available
                    else ""
                )
                violations.append(
                    Violation(
                        rule_id=rule_id,
                        message=(
                            f"{season.year} 年 {crop.name}：{metric:g} {unit} "
                            "超过年度上限 "
                            f"{limit:g} {unit}。{suffix}"
                        ),
                    )
                )
        prior.append((season.year, crop))
    return violations


def _metrics(seasons: list[PlanSeason]) -> PlanMetrics:
    return PlanMetrics(
        irrigation_gap_mm=round(sum(s.irrigation_gap_mm for s in seasons), 2),
        water_demand_mm=round(sum(s.water_demand_mm for s in seasons), 2),
        cover_days=sum(s.cover_days for s in seasons),
        diversity=len({s.family for s in seasons}),
        cost_usd_ha=round(sum(s.cost_usd_ha for s in seasons), 2),
        labor_days_ha=round(sum(s.labor_days_ha for s in seasons), 2),
    )


def _evidence(
    field: Field, profile: Profile, environment: Environment, inputs: PlanningInputs
) -> list[Evidence]:
    irrigation = "可用" if field.irrigation_available else "不可用"
    soil = {"unknown": "未知", "sand": "砂土", "loam": "壤土", "clay": "黏土"}[field.soil_texture]
    return [
        *profile.sources,
        *environment.evidence,
        Evidence(
            id="farmer-constraints",
            title="农户的地块信息与规划输入",
            kind="farmer_input",
            detail=(
                f"地块 {field.name}；{field.area_ha:g} ha；土壤 {soil}；灌溉{irrigation}。"
                f"年度上限：{inputs.max_irrigation_mm:g} mm、"
                f"{inputs.max_cost_usd_ha:g} USD/ha、{inputs.max_labor_days_ha:g} 天/ha。"
                f"种植历史记录：{len(field.history)} 条。"
            ),
        ),
        Evidence(
            id="scenario-water-estimate",
            title="情景需水计算",
            kind="estimate",
            detail=(
                "月尺度 Hargreaves 参考蒸散量乘以配置中的固定 Kc；"
                "降雨按生长窗口天数分配，再乘以配置的有效降雨比例。"
                "各月正缺口相加，不考虑土壤储水跨月结转或灌溉效率。"
                f"降雨情景 {inputs.scenario.rainfall_change_pct:+g}%；"
                f"温度情景 {inputs.scenario.temperature_change_c:+g} °C。"
                "这是情景估计，不是实测灌溉量或天气预报。"
            ),
        ),
    ]


def generate_options(
    field: Field,
    profile: Profile,
    environment: Environment,
    inputs: PlanningInputs,
) -> EngineResult:
    started = perf_counter()
    crops, rules = _validate_inputs(field, profile, environment, inputs)
    rain_fraction = float(rules["water_model"].parameters["effective_rainfall_fraction"])
    all_ids = sorted(set(inputs.allowed_crop_ids + inputs.baseline_crop_ids))
    # Compute each crop/year only once; ranking never triggers additional climate work.
    season_cache = {
        (year, crop_id): _season(crops[crop_id], year, field, environment, inputs, rain_fraction)
        for year in range(inputs.start_year, inputs.start_year + 3)
        for crop_id in all_ids
    }
    evidence = _evidence(field, profile, environment, inputs)

    def option(sequence: tuple[str, ...], is_baseline: bool = False) -> RotationOption:
        seasons = [
            season_cache[(inputs.start_year + offset, crop_id)]
            for offset, crop_id in enumerate(sequence)
        ]
        violations = _violations(seasons, field, crops, rules, inputs)
        metrics = _metrics(seasons)
        digest = sha256(
            (profile.id + profile.version + str(inputs.start_year) + ":".join(sequence)).encode()
        ).hexdigest()[:16]
        return RotationOption(
            id="baseline" if is_baseline else f"rotation-{digest}",
            label="当前种植安排" if is_baseline else " → ".join(s.crop_name for s in seasons),
            is_baseline=is_baseline,
            feasible=not violations,
            seasons=seasons,
            metrics=metrics,
            violations=violations,
            evidence=evidence,
            reasons=[
                "当前种植安排保留用于比较；违反的约束会完整列出。"
                if is_baseline
                else "通过现有数据可核查的配置规则；缺失历史、未知土壤和未确认地区仍需当地复核。",
                f"三年估计：灌溉缺口 {metrics.irrigation_gap_mm:g} mm；"
                f"计划覆盖 {metrics.cover_days} 天；"
                f"{metrics.diversity} 个植物科；"
                f"投入成本 {metrics.cost_usd_ha:g} USD/ha；"
                f"劳动量 {metrics.labor_days_ha:g} 天/ha。",
            ],
        )

    baseline = option(tuple(inputs.baseline_crop_ids), True)
    feasible: list[RotationOption] = []
    rejected_count = feasible_count = 0
    rejection_counts: Counter[str] = Counter()
    for sequence in product(sorted(inputs.allowed_crop_ids), repeat=3):
        candidate = option(sequence)
        if not candidate.feasible:
            rejected_count += 1
            rejection_counts.update({violation.rule_id for violation in candidate.violations})
            continue
        feasible_count += 1
        if list(sequence) != inputs.baseline_crop_ids:
            feasible.append(candidate)

    # Normalize only feasible alternatives. Priorities may change rank, never feasibility.
    dimensions = (
        ("irrigation_gap_mm", inputs.weights.water, False),
        ("cover_days", inputs.weights.cover, True),
        ("diversity", inputs.weights.diversity, True),
        ("cost_usd_ha", inputs.weights.cost, False),
    )
    bounds = (
        {
            key: (
                min(getattr(o.metrics, key) for o in feasible),
                max(getattr(o.metrics, key) for o in feasible),
            )
            for key, _, _ in dimensions
        }
        if feasible
        else {}
    )

    def score(candidate: RotationOption) -> float:
        total = 0.0
        for key, weight, higher_is_better in dimensions:
            low, high = bounds[key]
            if high == low:
                continue
            normalized = (getattr(candidate.metrics, key) - low) / (high - low)
            total += weight * (normalized if higher_is_better else 1 - normalized)
        return total

    feasible.sort(key=lambda candidate: (-score(candidate), candidate.id))
    # Representative comparison policy: best score, then the best different crop
    # combination with distinct totals. If none exists, prefer a different crop
    # combination even when totals tie; otherwise show another order explicitly.
    # Calendar/leap-year sub-mm differences alone must not hide crop-mix trade-offs.
    alternatives = feasible[:1]
    if alternatives:
        alternatives[0].reasons.append(
            "在可行替代方案中，按您的权重得分最高；这是偏好排序，不是农业效益预测。"
        )
    if len(feasible) > 1:
        first = feasible[0]
        first_mix = sorted(season.crop_id for season in first.seasons)
        different_mix = [
            candidate
            for candidate in feasible[1:]
            if sorted(season.crop_id for season in candidate.seasons) != first_mix
        ]
        distinct = next(
            (candidate for candidate in different_mix if candidate.metrics != first.metrics), None
        )
        second = distinct or (different_mix[0] if different_mix else feasible[1])
        if distinct is not None:
            explanation = (
                "为展示不同取舍，选择了作物组合及汇总指标均不同的最高分可行方案；"
                "因此展示的是两种代表性选择，而非简单取总分前两名。"
            )
        elif different_mix:
            explanation = (
                "该方案提供了不同作物组合，但与首个方案的汇总估计相同；不据此声称额外收益。"
            )
        elif second.metrics == first.metrics:
            explanation = (
                "可行替代方案只有同一作物组合，汇总估计相同。"
                "第二方案仅改变种植顺序，不声称额外收益。"
            )
        else:
            explanation = (
                "可行替代方案只有同一作物组合。第二方案仅改变顺序；"
                "细小汇总差异来自日历和气候估计，不代表已验证的农业收益。"
            )
        second.reasons.append(explanation)
        alternatives.append(second)
    priority_names = {"water": "节水", "cover": "覆盖", "diversity": "多样性", "cost": "成本"}
    weight_text = "、".join(
        f"{priority_names[key]} {value:g}/5" for key, value in inputs.weights.model_dump().items()
    )
    for candidate in alternatives:
        candidate.reasons.append(
            f"采用您的优先级：{weight_text}。"
            "仅在可行方案间按各指标范围归一化：较低灌溉缺口和成本、较高计划覆盖天数与"
            "植物科多样性得分更高。同分时使用稳定的序列排序。"
        )
    limitations = [*environment.limitations, *profile.assumptions]
    if not field.history:
        limitations.append("缺少种植历史：无法核查规划开始前的作物及科属间隔。")
    else:
        max_gap = max(
            (
                r.parameters["intervening_years"]
                for r in rules.values()
                if r.kind in {"crop_gap", "family_gap"}
            ),
            default=0,
        )
        expected = set(range(inputs.start_year - max_gap, inputs.start_year))
        if expected - {h.year for h in field.history}:
            limitations.append("种植历史不足以覆盖配置中的轮作间隔；无法核查未知年份。")
    if field.soil_texture == "unknown":
        limitations.append("土壤质地未知，尚未核实作物与土壤的适配性；请补充当地土壤信息。")
    if environment.status != "demo" and any(
        m.valid_days < m.expected_days for m in environment.months
    ):
        limitations.append("参考气候中存在观测不完整的月份；估计结果包含这些不确定性。")
    if not alternatives:
        limitations.append(
            "没有替代方案通过全部配置约束。请查看筛除原因，仅调整实际可以放宽的条件。"
        )
    descriptions = {r.id: r.description for r in profile.rules}
    return EngineResult(
        baseline=baseline,
        alternatives=alternatives,
        feasible_count=feasible_count,
        rejected_count=rejected_count,
        rejection_summary=[
            RejectionSummary(
                rule_id=key, message=descriptions.get(key, RULE_MESSAGES.get(key, key)), count=count
            )
            for key, count in sorted(rejection_counts.items(), key=lambda pair: (-pair[1], pair[0]))
        ],
        limitations=list(dict.fromkeys(limitations)),
        elapsed_ms=round((perf_counter() - started) * 1000, 2),
    )
