"""Independent v2 mathematical contract; never cast v1 snapshots into this model."""

from datetime import date, timedelta
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Nonnegative = Annotated[float, Field(ge=0)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class HistoricalCrop(Contract):
    crop_id: str
    family: str
    end_latest: date
    turnaround_days: int = Field(ge=0, le=365)
    precision: Literal["day", "month", "year"]


class PlanningField(Contract):
    id: str
    area_ha: float = Field(gt=0, le=100000)
    irrigation_available: bool
    require_crop: bool = True
    history: list[HistoricalCrop] = Field(default_factory=list)


class Candidate(Contract):
    id: str
    field_id: str
    crop_id: str
    family: str
    sow_date: date
    harvest_date: date
    turnaround_days: int = Field(ge=0, le=365)
    water_mm: list[Nonnegative]
    cost_usd_ha: Nonnegative
    labor_days_ha: Nonnegative

    @model_validator(mode="after")
    def daily_shape(self) -> Self:
        if self.harvest_date < self.sow_date:
            raise ValueError("Harvest precedes sowing")
        if len(self.water_mm) != (self.harvest_date - self.sow_date).days + 1:
            raise ValueError("Water series must cover every growing day")
        return self

    @property
    def occupied_until(self) -> date:
        return self.harvest_date + timedelta(days=self.turnaround_days)


class ResourceLimit(Contract):
    water_m3: Nonnegative
    cost_usd: Nonnegative
    labor_days: Nonnegative


class Weights(Contract):
    cover: Nonnegative
    diversity: Nonnegative
    water: Nonnegative
    cost: Nonnegative

    @model_validator(mode="after")
    def nonzero(self) -> Self:
        if not any(self.model_dump().values()):
            raise ValueError("At least one objective weight must be positive")
        return self


class References(Contract):
    cover: float = Field(gt=0)
    diversity: float = Field(gt=0)
    water: float = Field(gt=0)
    cost: float = Field(gt=0)


class Problem(Contract):
    version: Literal["rotation-milp-v2.0"] = "rotation-milp-v2.0"
    start: date
    end: date
    fields: list[PlanningField] = Field(min_length=1, max_length=10)
    candidates: list[Candidate] = Field(max_length=240)
    family_gaps: dict[str, Annotated[int, Field(ge=0)]]
    field_limits: dict[str, dict[int, ResourceLimit]] = Field(default_factory=dict)
    farm_limits: dict[int, ResourceLimit] = Field(default_factory=dict)
    weights: Weights
    references: References

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if not 0 <= (self.end - self.start).days <= 1095:
            raise ValueError("Horizon must be ordered and at most three years")
        fids = {f.id for f in self.fields}
        if len(fids) != len(self.fields) or len({c.id for c in self.candidates}) != len(
            self.candidates
        ):
            raise ValueError("Duplicate field or candidate ID")
        years = set(range(self.start.year, self.end.year + 1))
        if not set(self.field_limits) <= fids or not set(self.farm_limits) <= years:
            raise ValueError("Resource limits reference unknown field or year")
        if any(not set(v) <= years for v in self.field_limits.values()):
            raise ValueError("Field limits outside horizon")
        for f in self.fields:
            for h in f.history:
                if h.end_latest >= self.start or h.family not in self.family_gaps:
                    raise ValueError("History must predate horizon and use known family")
        for c in self.candidates:
            if c.field_id not in fids or c.family not in self.family_gaps:
                raise ValueError("Candidate has unknown field or family")
            if c.sow_date < self.start or c.occupied_until > self.end:
                raise ValueError("Candidate or turnaround outside horizon")
        return self


class CropV2(Contract):
    id: str
    name: str
    family: str
    base_c: float = Field(ge=-10, le=30)
    upper_c: float = Field(gt=0, le=50)
    gdd_required: float = Field(gt=0, le=10000)
    gdd_recipe: Literal["draft_one_sided_v1", "bounded_both_v1"]
    max_growing_days: int = Field(ge=1, le=365)
    turnaround_days: int = Field(ge=0, le=365)
    sow_start_mmdd: str
    sow_end_mmdd: str
    kc: tuple[Nonnegative, Nonnegative, Nonnegative]
    stage_fractions: tuple[Nonnegative, Nonnegative, Nonnegative, Nonnegative]
    cost_usd_ha: Nonnegative
    labor_days_ha: Nonnegative
    parameter_origins: dict[str, str]

    @model_validator(mode="after")
    def check_parameters(self) -> Self:
        required = set(type(self).model_fields) - {"id", "name", "parameter_origins"}
        if not required <= self.parameter_origins.keys() or any(
            not self.parameter_origins[key].strip() for key in required
        ):
            raise ValueError("Each executable parameter needs provenance")
        if self.base_c >= self.upper_c or abs(sum(self.stage_fractions) - 1) > 1e-6:
            raise ValueError("Invalid crop temperature or stage fractions")
        if any(v <= 0 for v in self.stage_fractions) or any(v > 2 for v in self.kc):
            raise ValueError("Invalid stage lengths or crop coefficients")
        a = date.fromisoformat(f"2001-{self.sow_start_mmdd}")
        b = date.fromisoformat(f"2001-{self.sow_end_mmdd}")
        if b < a:
            raise ValueError("Split a cross-year sowing window into explicit windows")
        return self
