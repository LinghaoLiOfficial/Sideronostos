"""Server-owned input requirements before weather/candidate preparation.

`ready` here means the input preflight passed, not that a candidate exists or a farm
can execute an optimized schedule. Ownership/current-partition checks belong to the
service, scientific weather QA to the published release and candidate preparation.
"""

from datetime import date
from typing import Any, Literal

from ...agri_data.schemas import GEOD
from ...field_shift.schemas import Field as FieldSnapshot
from .contracts import SoilWater
from .inputs import CapacityInput, FieldConditions, PlanningDraft
from .model import HistoricalCrop
from .profiles import ProfileV3, parameter_records
from .readiness import RecordedValue, Requirement, assess_readiness

# name: unit, type, lower, upper, feature; these cannot be replaced by client flags.
FIELD_REQUIREMENTS: dict[
    str, tuple[str, Literal["number", "text", "boolean"], float | None, float | None, str]
] = {
    "field_capacity": ("m3/m3", "number", 0.000001, 1, "soil_water"),
    "wilting_point": ("m3/m3", "number", 0, 1, "soil_water"),
    "depth_m": ("m", "number", 0.000001, 10, "soil_water"),
    "ph": ("pH", "number", 0, 14, "soil_suitability"),
    "salinity_ds_m": ("dS/m", "number", 0, 100, "soil_suitability"),
    "drainage": ("category", "text", None, None, "soil_suitability"),
    "slope_deg": ("degree", "number", 0, 90, "terrain"),
    "mechanical_access": ("1", "boolean", None, None, "management"),
    "effective_rain_fraction": ("1", "number", 0, 1, "soil_water"),
    "initial_water_policy": ("category", "text", None, None, "soil_water"),
    "history_reviewed": ("1", "boolean", None, None, "history"),
    "history_state": ("category", "text", None, None, "history"),
    "management_reviewed": ("1", "boolean", None, None, "management"),
    "baseline_confirmed": ("1", "boolean", None, None, "baseline"),
}


def resolve_history(field: FieldSnapshot, profile: ProfileV3, start: date) -> list[HistoricalCrop]:
    compatible = {profile.id, *profile.compatible_history_profile_ids}
    linked = {e.linked_legacy_year for e in field.history_events}
    entries: list[tuple[str, date, Literal["day", "month", "year"]]] = []
    for old in field.history:
        if old.year not in linked:
            if field.profile_id not in compatible:
                raise ValueError("history_catalogue_incompatible")
            entries.append((old.crop_id, date(old.year, 12, 31), "year"))
    for event in field.history_events:
        if event.profile_id not in compatible:
            raise ValueError("history_catalogue_incompatible")
        entries.append((event.crop_id, event.latest_end(), event.precision))
    result = []
    for crop_id, end, precision in entries:
        identity = profile.history_catalogue.get(crop_id)
        if identity is None:
            raise ValueError("history_crop_unknown")
        if end >= start:
            raise ValueError("history_overlaps_horizon")
        result.append(
            HistoricalCrop(
                crop_id=crop_id, end_latest=end, precision=precision, **identity.model_dump()
            )
        )
    return result


class InputAudit:
    def __init__(self, draft: PlanningDraft, profile: ProfileV3):
        self.draft, self.profile = draft, profile
        self.requirements: list[Requirement] = []
        self.values: dict[str, RecordedValue] = {}
        self.checks: list[dict[str, Any]] = []

    def add(
        self,
        path: str,
        value: RecordedValue | None,
        unit: str,
        feature: str,
        kind: Literal["number", "text", "boolean"] = "number",
        minimum: float | None = 0,
        maximum: float | None = None,
        dated: bool = False,
    ) -> None:
        self.requirements.append(
            Requirement(
                path=path,
                unit=unit,
                value_kind=kind,
                minimum=minimum,
                maximum=maximum,
                features=[feature],
                enforce_applicability_dates=dated,
            )
        )
        if value is not None:
            self.values[path] = value

    def issue(self, path: str, issue: str, feature: str, value: Any = None) -> None:
        self.checks.append(
            {
                "path": path,
                "value": value,
                "unit": "validation",
                "expected_unit": "validation",
                "sources": [],
                "missing_reason": None,
                "status": "blocked",
                "issues": [issue],
                "warnings": [],
                "engineering_assumption": False,
                "blocks": [feature],
            }
        )

    def capacity(
        self,
        prefix: str,
        cap: CapacityInput | None,
        unit: str,
        feature: str,
        maximum: float | None = None,
    ) -> None:
        self.add(
            prefix + ".capacity",
            cap.amount if cap else None,
            unit,
            feature,
            maximum=maximum,
            dated=True,
        )
        if cap is None or cap.remediable is None:
            self.issue(prefix + ".remediable", "remedy_policy_missing", feature)
        elif cap.remediable:
            unit_cost = {"m3/day": "USD/m3", "h/day": "USD/h", "kg": "USD/kg", "day": "USD/day"}[
                unit
            ]
            self.add(
                prefix + ".gap_unit_cost",
                cap.gap_unit_cost,
                unit_cost,
                feature,
                minimum=1e-12,
                dated=True,
            )
            self.add(prefix + ".remedy", cap.remedy, "text", feature, "text", dated=True)
        elif cap.gap_unit_cost is not None or cap.remedy is not None:
            self.issue(prefix + ".remediable", "hard_limit_cannot_have_soft_remedy", feature)

    def report(self) -> dict[str, Any]:
        result = assess_readiness(
            requirements=self.requirements,
            values=self.values,
            sources=self.draft.sources,
            region_id=self.profile.region_id,
            start=self.draft.start,
            end=self.draft.end,
            enabled_features={f for r in self.requirements for f in r.features},
            accept_engineering_assumptions=self.draft.accept_engineering_assumptions,
        )
        result["items"].extend(self.checks)
        return result


def assess_inputs(
    draft: PlanningDraft, profile: ProfileV3, fields: list[FieldSnapshot]
) -> dict[str, Any]:
    audit = InputAudit(draft, profile)
    by_id = {f.id: f for f in fields}
    selected = {c.id for c in draft.fields}
    metric: str | None
    weights = draft.weights or profile.default_weights
    if draft.profile_id != profile.id:
        audit.issue("profile.id", "profile_identity_mismatch", "profile")
    if set(draft.sources) & set(profile.sources):
        audit.issue("sources", "reserved_profile_source_identity", "profile")
    for metric, reason in draft.disabled_metrics.items():
        if not reason.strip() or getattr(weights, metric) != 0:
            audit.issue("weights." + metric, "disabled_metric_needs_zero_weight_and_reason", metric)
    if not set(draft.allowed_crop_ids) <= profile.crops.keys():
        audit.issue("allowed_crop_ids", "unknown_crop", "profile")
    crops = {k: profile.crops[k] for k in draft.allowed_crop_ids if k in profile.crops}
    for key, crop in crops.items():
        for metric, present in [
            ("profit", crop.economics is not None),
            ("soil", crop.soil_components is not None and crop.soil_weights is not None),
            ("risk", crop.risk_weights is not None),
            ("rotation", profile.transition_scores is not None),
        ]:
            if not present and metric not in draft.disabled_metrics:
                audit.issue(f"profile.crops.{key}.{metric}", "metric_parameters_missing", metric)
    profile_values = {}
    profile_requirements = []
    for path, value in parameter_records(profile).items():
        metric = next(
            (
                m
                for m, segment in [
                    ("profit", ".economics."),
                    ("soil", ".soil_components."),
                    ("soil", ".soil_weights."),
                    ("risk", ".risk_weights."),
                ]
                if segment in path
            ),
            None,
        )
        if path.startswith("transition_scores."):
            metric = "rotation"
        if path.startswith("scales."):
            metric = path.split(".")[1]
        if metric in draft.disabled_metrics:
            continue
        if path.startswith("crops.") and path.split(".")[1] not in crops:
            continue
        name = "profile." + path
        profile_values[name] = value
        profile_requirements.append(
            Requirement(
                path=name,
                unit=value.unit,
                value_kind="text" if isinstance(value.value, str) else "number",
                features=[metric or "profile"],
            )
        )
    profile_audit = assess_readiness(
        requirements=profile_requirements,
        values=profile_values,
        sources=profile.sources,
        region_id=profile.region_id,
        start=draft.start,
        end=draft.end,
        enabled_features={f for r in profile_requirements for f in r.features},
        accept_engineering_assumptions=draft.accept_engineering_assumptions,
    )
    distances = []
    for choice in draft.fields:
        prefix = "fields." + choice.id
        field = by_id.get(choice.id)
        if field is None:
            audit.issue(prefix, "field_missing", "field_identity")
            continue
        if choice.expected_version != field.version:
            audit.issue(
                prefix + ".version", "field_version_changed", "field_identity", field.version
            )
        if not field.farm_id or not field.partition_revision:
            audit.issue(prefix + ".farm", "farm_association_missing", "field_identity")
        points = [[field.longitude, field.latitude]]
        if field.geometry:
            points.extend(point for ring in field.geometry["coordinates"] for point in ring)
        distance = max(
            abs(
                GEOD.inv(profile.weather_center[0], profile.weather_center[1], point[0], point[1])[
                    2
                ]
            )
            / 1000
            for point in points
        )
        distances.append(
            {
                "field_id": field.id,
                "max_distance_km": distance,
                "limit_km": profile.weather_radius_km,
            }
        )
        if distance > profile.weather_radius_km:
            audit.issue(prefix + ".location", "outside_weather_coverage", "weather")
        conditions = draft.field_conditions.get(field.id, FieldConditions())
        values: dict[str, RecordedValue] = {str(k): v for k, v in conditions.values.items()}
        for key, (unit, value_kind, low, high, feature) in FIELD_REQUIREMENTS.items():
            audit.add(prefix + "." + key, values.get(key), unit, feature, value_kind, low, high)
        supplied: dict[str, Any] = {k: v.value for k, v in values.items()}
        for key in ("history_reviewed", "management_reviewed", "baseline_confirmed"):
            if supplied.get(key) is not True:
                audit.issue(
                    prefix + "." + key, "confirmation_required", FIELD_REQUIREMENTS[key][-1]
                )
        if supplied.get("initial_water_policy") not in (None, "independent_wilting_point_v1"):
            audit.issue(
                prefix + ".initial_water_policy", "unsupported_initial_water_policy", "soil_water"
            )
        if supplied.get("drainage") not in (None, "poor", "moderate", "well"):
            audit.issue(prefix + ".drainage", "unknown_drainage_class", "soil_suitability")
        if all(supplied.get(k) is not None for k in ("field_capacity", "wilting_point", "depth_m")):
            try:
                SoilWater(
                    **{k: supplied[k] for k in ("field_capacity", "wilting_point", "depth_m")}
                )
            except ValueError:
                audit.issue(prefix + ".soil_water", "invalid_soil_water", "soil_water")
        has_history = bool(field.history or field.history_events)
        if has_history:
            if supplied.get("history_state") != "recorded":
                audit.issue(
                    prefix + ".history_state", "recorded_history_not_acknowledged", "history"
                )
            try:
                resolve_history(field, profile, draft.start)
            except ValueError as error:
                audit.issue(prefix + ".history", str(error), "history")
        else:
            audit.add(
                prefix + ".history_absence_reason",
                values.get("history_absence_reason"),
                "text",
                "history",
                "text",
            )
            if supplied.get("history_state") != "no_prior_crop":
                audit.issue(prefix + ".history_state", "history_unknown", "history")
        baseline = [b for b in draft.baseline if b.field_id == field.id]
        if not baseline:
            audit.issue(prefix + ".baseline", "baseline_missing", "baseline")
        for b in baseline:
            baseline_crop = crops.get(b.crop_id)
            if baseline_crop and not any(
                first <= b.sow_date.strftime("%m-%d") <= last
                for first, last in baseline_crop.sow_windows
            ):
                audit.issue(prefix + ".baseline", "baseline_outside_sow_window", "baseline")
            if b.crop_id in conditions.forbidden_crop_ids:
                audit.issue(prefix + ".baseline", "baseline_crop_prohibited", "baseline")
        if conditions.bare_limit_disabled is None or not conditions.bare_limit_disabled.strip():
            audit.capacity(
                prefix + ".bare",
                conditions.bare_limit,
                "day",
                "bare",
                (draft.end - draft.start).days + 1,
            )
        farm = draft.farm_resources.get(field.farm_id or "")
        water = farm.daily.get(conditions.water_system_id or "") if farm else None
        if field.irrigation_available:
            if water is None or water.kind != "water" or field.id not in water.field_ids:
                audit.issue(prefix + ".water_system", "water_system_missing", "water_resources")
        elif conditions.water_system_id is not None:
            audit.issue(
                prefix + ".water_system", "rainfed_field_has_water_system", "water_resources"
            )
        for machine in {op.machine for c in crops.values() for op in c.operations}:
            matches = (
                [
                    r
                    for r in farm.daily.values()
                    if r.kind == "machine" and r.machine_type == machine and field.id in r.field_ids
                ]
                if farm
                else []
            )
            if len(matches) != 1:
                audit.issue(
                    prefix + ".machine." + machine,
                    "machine_membership_missing" if not matches else "ambiguous_machine_assignment",
                    "machine_resources",
                )
    farm_ids = {f.farm_id for f in fields if f.id in selected and f.farm_id}
    for farm_id in set(draft.farm_resources) - farm_ids:
        audit.issue("farms." + farm_id, "unknown_farm", "field_identity")
    resource_ids: set[str] = set()
    water_memberships: dict[str, list[str]] = {}
    for farm_id in farm_ids:
        farm = draft.farm_resources.get(farm_id)
        for resource_id, resource in farm.daily.items() if farm else []:
            prefix = f"farms.{farm_id}.daily.{resource_id}"
            feature = resource.kind + "_resources"
            if resource_id in resource_ids:
                audit.issue(prefix, "duplicate_resource_id", feature)
            resource_ids.add(resource_id)
            if any(
                fid not in selected or fid not in by_id or by_id[fid].farm_id != farm_id
                for fid in resource.field_ids
            ):
                audit.issue(prefix + ".field_ids", "invalid_resource_membership", feature)
            unit = "m3/day" if resource.kind == "water" else "h/day"
            audit.capacity(prefix, resource.default, unit, feature)
            for day, amount in resource.overrides.items():
                audit.add(
                    prefix + ".overrides." + day.isoformat(), amount, unit, feature, dated=True
                )
            if resource.kind == "water":
                for fid in resource.field_ids:
                    water_memberships.setdefault(fid, []).append(resource_id)
                if resource.water_basis is None:
                    audit.issue(prefix + ".water_basis", "water_basis_missing", feature)
                if resource.water_basis == "gross":
                    audit.add(
                        prefix + ".efficiency",
                        resource.irrigation_efficiency,
                        "1",
                        feature,
                        minimum=1e-12,
                        maximum=1,
                        dated=True,
                    )
                elif resource.irrigation_efficiency is not None:
                    audit.issue(
                        prefix + ".efficiency", "net_capacity_cannot_be_converted_again", feature
                    )
            elif resource.machine_type is None:
                audit.issue(prefix + ".machine_type", "machine_type_missing", feature)
        limits = (
            {(p.kind, p.crop_id, p.period_id): p.limit for p in farm.period_limits} if farm else {}
        )
        period_kinds: tuple[Literal["seed", "market"], ...] = ("seed", "market")
        for kind in period_kinds:
            for crop_id in crops:
                for period in draft.periods:
                    audit.capacity(
                        f"farms.{farm_id}.{kind}.{crop_id}.{period.id}",
                        limits.get((kind, crop_id, period.id)),
                        "kg",
                        kind + "_resources",
                    )
    for fid, ids in water_memberships.items():
        condition = draft.field_conditions.get(fid)
        if (
            len(ids) != 1
            or condition is None
            or condition.water_system_id != ids[0]
            or fid not in by_id
            or not by_id[fid].irrigation_available
        ):
            audit.issue(
                "fields." + fid + ".water_system", "ambiguous_water_system", "water_resources"
            )
    result = audit.report()
    result["items"] = profile_audit["items"] + result["items"]
    result["blocked_features"] = sorted(
        {feature for item in result["items"] for feature in item["blocks"]}
    )
    result["ready"] = not result["blocked_features"]
    result.update(
        stage="input_preflight",
        scope=profile.scope,
        spatial_checks=distances,
        field_versions=[
            {
                "id": f.id,
                "version": f.version,
                "farm_id": f.farm_id,
                "partition_revision": f.partition_revision,
            }
            for f in fields
            if f.id in selected
        ],
        limitations=[
            *profile.limitations,
            "Input preflight does not establish candidate availability, "
            "solver feasibility or local agronomic validity.",
        ],
    )
    return result
