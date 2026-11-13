"""Stable client identities; server ownership is never an input field."""

from typing import Any, Self

from pydantic import Field as PydField
from pydantic import model_validator

from ..agri_data.schemas import validate_geometry
from .schemas import Contract, Identifier, Name


class FarmInput(Contract):
    local_id: Identifier
    name: Name
    geometry: dict[str, Any]
    partition_revision: Identifier
    expected_version: int | None = PydField(default=None, strict=True, ge=1)

    @model_validator(mode="after")
    def boundary(self) -> Self:
        result = validate_geometry(self.geometry, allow_holes=True)
        if result["geometry"]["type"] != "Polygon" or result["area_ha"] > 100000:
            raise ValueError("Farm requires a polygon no larger than 100000 ha")
        self.geometry = result["geometry"]
        return self


class SyncField(Contract):
    local_id: Identifier
    expected_version: int | None = PydField(default=None, strict=True, ge=1)
    # Validate each agronomic form separately so one incomplete field cannot hide
    # successful siblings. Arbitrary fields still fail FieldInput validation.
    field: dict[str, Any]


class FarmSyncInput(Contract):
    idempotency_key: str = PydField(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    farm: FarmInput
    fields: list[SyncField] = PydField(min_length=1, max_length=100)

    @model_validator(mode="after")
    def distinct(self) -> Self:
        if len({item.local_id for item in self.fields}) != len(self.fields):
            raise ValueError("Duplicate local field identities")
        return self
