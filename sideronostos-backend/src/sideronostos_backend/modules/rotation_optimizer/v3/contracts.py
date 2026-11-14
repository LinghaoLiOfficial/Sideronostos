"""Typed scientific contracts for the daily model; missing values are not coefficients."""

import math
from typing import Annotated, Literal, Self

from pydantic import Field, StrictBool, model_validator

from ..schemas import Contract

Number = Annotated[float, Field(strict=True)]
Positive = Annotated[float, Field(strict=True, gt=0)]
Nonnegative = Annotated[float, Field(strict=True, ge=0)]
Fraction = Annotated[float, Field(strict=True, ge=0, le=1)]
PositiveFraction = Annotated[float, Field(strict=True, gt=0, le=1)]
Identifier = Annotated[str, Field(min_length=1, max_length=150)]

MODEL_VERSION = "rotation-milp-v3.0"
PRECOMPUTE_VERSION = "daily-root-zone-v3.0"


class SoilWater(Contract):
    field_capacity: PositiveFraction  # m³/m³
    wilting_point: Fraction  # m³/m³
    depth_m: Annotated[float, Field(strict=True, gt=0, le=10)]

    @model_validator(mode="after")
    def available_water(self) -> Self:
        if self.wilting_point >= self.field_capacity:
            raise ValueError("Field capacity must exceed permanent wilting point")
        return self


class InitialWater(Contract):
    # Independent coefficients cannot credit the same measured reservoir to each crop.
    # Dry initial/root expansion state is conservative and must be acknowledged.
    policy: Literal["independent_wilting_point_v1"]
    confirmed: StrictBool
    evidence_id: Identifier

    @model_validator(mode="after")
    def acknowledged(self) -> Self:
        if not self.confirmed:
            raise ValueError("Confirm the independent conservative initial-water assumption")
        return self


class Phenology(Contract):
    base_c: Annotated[float, Field(strict=True, ge=-10, le=30)]
    upper_c: Annotated[float, Field(strict=True, gt=0, le=50)]
    maturity_gdd: Annotated[float, Field(strict=True, gt=0, le=10000)]
    gdd_recipe: Literal["draft_one_sided_v1", "bounded_both_v1"]
    max_growing_days: int = Field(strict=True, ge=1, le=365)
    turnaround_days: int = Field(strict=True, ge=0, le=365)

    @model_validator(mode="after")
    def thresholds(self) -> Self:
        if self.base_c >= self.upper_c:
            raise ValueError("GDD base must be below its upper temperature")
        return self


class Canopy(Contract):
    kc: tuple[Nonnegative, Nonnegative, Nonnegative]
    stage_fractions: tuple[PositiveFraction, PositiveFraction, PositiveFraction, PositiveFraction]
    root_initial_m: Positive
    root_max_m: Positive
    depletion_fraction: tuple[
        PositiveFraction, PositiveFraction, PositiveFraction, PositiveFraction
    ]
    cover_start_fraction: Fraction
    residue_cover_days: int = Field(strict=True, ge=0, le=365)

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if not math.isclose(sum(self.stage_fractions), 1, abs_tol=1e-9):
            raise ValueError("Stage fractions must sum to one")
        if self.root_max_m < self.root_initial_m or self.root_max_m > 10:
            raise ValueError("Root growth must be nondecreasing and at most ten metres")
        if max(self.kc) > 2:
            raise ValueError("Kc exceeds the supported range")
        return self


class ObjectiveWeights(Contract):
    profit: Fraction
    water: PositiveFraction
    rotation: Fraction
    soil: Fraction
    risk: Fraction
    bare: Fraction

    @model_validator(mode="after")
    def unit_sum(self) -> Self:
        if not math.isclose(sum(self.model_dump().values()), 1, abs_tol=1e-9):
            raise ValueError("Six objective weights must sum to one")
        return self
