"""Account-backed field map workspace and the versioned Iowa benchmark seed."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .models import FieldWorkspaceRecord, utcnow
from .farm_schemas import FarmSyncInput
from .schemas import Contract, FieldInput

SAMPLE_FARM_ID = "iowa-nasa-benchmark-v1"
SAMPLE_RELEASE_ID = "iowa-nasa-2022-2024-v1"
SAMPLE_VERSION = "iowa-four-fields-v1"

FIELD_RINGS: tuple[tuple[tuple[float, float], ...], ...] = (
    (
        (-93.50963065622372, 41.99635499484917),
        (-93.4999717999181, 41.99639746922237),
        (-93.5, 42.0),
        (-93.50965940104048, 41.99995752029144),
        (-93.50963065622372, 41.99635499484917),
    ),
    (
        (-93.4998510640831, 41.99639799500949),
        (-93.49019218692332, 41.996439646573855),
        (-93.49021983545668, 42.00004218264954),
        (-93.49987925735579, 42.00000052585317),
        (-93.4998510640831, 41.99639799500949),
    ),
    (
        (-93.50966011972817, 42.000047583398214),
        (-93.50000070506803, 42.000090063240165),
        (-93.5000289104296, 42.00369259167637),
        (-93.50968886992659, 42.00365010649845),
        (-93.50966011972817, 42.000047583398214),
    ),
    (
        (-93.49987996225357, 42.000090589094995),
        (-93.49022052673473, 42.00013224602217),
        (-93.49024818044455, 42.00373477975703),
        (-93.49990816080467, 42.003693117597244),
        (-93.49987996225357, 42.000090589094995),
    ),
)


class FarmProperties(Contract):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    boundarySource: Literal["drawn", "imported", "synthetic"]
    partitionCount: int = Field(ge=1, le=100)
    partitionMethod: Literal["equal-area-strips", "regular-grid"]
    partitionOrientation: Literal["farm-axis", "cardinal"]
    partitionGridRows: int | None = Field(default=None, ge=1, le=100)
    partitionGridColumns: int | None = Field(default=None, ge=1, le=100)
    partitionStatus: Literal["draft", "confirmed"]
    backendFarmId: str | None = Field(default=None, max_length=100)
    backendVersion: int | None = Field(default=None, ge=1)
    partitionRevision: str | None = Field(default=None, max_length=100)
    expectedFieldCount: int | None = Field(default=None, ge=0, le=1200)
    partitionMetadataKnown: bool | None = None
    conflictOfFarmId: str | None = Field(default=None, max_length=100)
    syncError: str | None = Field(default=None, max_length=2000)
    pendingSync: FarmSyncInput | None = None
    createdAt: datetime
    updatedAt: datetime
    sourceReleaseId: str | None = Field(default=None, max_length=100)
    sampleVersion: str | None = Field(default=None, max_length=100)


class FieldProperties(Contract):
    id: str = Field(min_length=1, max_length=100)
    farmId: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    status: Literal["candidate", "confirmed"]
    partitionIndex: int = Field(ge=1, le=1000)
    boundarySource: Literal["generated", "edited"]
    farmerConfirmed: bool
    backendFieldId: str | None = Field(default=None, max_length=100)
    backendVersion: int | None = Field(default=None, ge=1)
    syncStatus: Literal["needs-details", "pending", "synced", "conflict", "error"] | None = None
    syncError: str | None = Field(default=None, max_length=2000)
    details: FieldInput | None = None
    createdAt: datetime
    updatedAt: datetime


class Polygon(Contract):
    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]

    @model_validator(mode="after")
    def valid_polygon(self) -> Polygon:
        from ..agri_data.schemas import validate_geometry

        normalized = validate_geometry(self.model_dump())
        if normalized["geometry"]["type"] != "Polygon":
            raise ValueError("Workspace boundaries must be polygons")
        self.coordinates = normalized["geometry"]["coordinates"]
        return self


class FarmFeature(Contract):
    type: Literal["Feature"]
    id: str | None = None
    geometry: Polygon
    properties: FarmProperties

    @model_validator(mode="after")
    def matching_id(self) -> FarmFeature:
        if self.id is not None and self.id != self.properties.id:
            raise ValueError("Farm feature ID must match its properties")
        self.id = self.properties.id
        return self


class FieldFeature(Contract):
    type: Literal["Feature"]
    id: str | None = None
    geometry: Polygon
    properties: FieldProperties

    @model_validator(mode="after")
    def matching_id(self) -> FieldFeature:
        if self.id is not None and self.id != self.properties.id:
            raise ValueError("Field feature ID must match its properties")
        self.id = self.properties.id
        return self


class WorkspaceDocument(Contract):
    farms: list[FarmFeature] = Field(max_length=100)
    fields: list[FieldFeature] = Field(max_length=1200)
    initialized_from: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def consistent_graph(self) -> WorkspaceDocument:
        farm_ids = [item.properties.id for item in self.farms]
        field_ids = [item.properties.id for item in self.fields]
        if len(farm_ids) != len(set(farm_ids)) or len(field_ids) != len(set(field_ids)):
            raise ValueError("Workspace identifiers must be unique")
        known = set(farm_ids)
        if any(item.properties.farmId not in known for item in self.fields):
            raise ValueError("Every field must belong to a workspace farm")
        release_farms = [item for item in self.farms if item.properties.sourceReleaseId is not None]
        if any(
            item.properties.id != SAMPLE_FARM_ID
            or item.properties.sourceReleaseId != SAMPLE_RELEASE_ID
            or item.properties.sampleVersion != SAMPLE_VERSION
            for item in release_farms
        ):
            raise ValueError("Only the versioned Iowa sample may reference a science release")
        sample_farms = [item for item in self.farms if item.properties.id == SAMPLE_FARM_ID]
        if sample_farms:
            sample_fields = sorted(
                (item for item in self.fields if item.properties.farmId == SAMPLE_FARM_ID),
                key=lambda item: item.properties.partitionIndex,
            )
            if (
                len(sample_farms) != 1
                or len(sample_fields) != len(FIELD_RINGS)
                or sample_farms[0].properties.partitionStatus != "confirmed"
                or any(
                    field.properties.id != f"{SAMPLE_FARM_ID}-field-{index}"
                    or field.properties.status != "confirmed"
                    or field.geometry.coordinates[0] != [list(point) for point in ring]
                    for index, (field, ring) in enumerate(
                        zip(sample_fields, FIELD_RINGS, strict=True), 1
                    )
                )
            ):
                raise ValueError("The Iowa benchmark must remain a locked four-field sample")
        return self


class WorkspacePut(WorkspaceDocument):
    expected_version: int = Field(ge=1)


class WorkspaceView(WorkspaceDocument):
    version: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime


def _sample(now: datetime | None = None) -> WorkspaceDocument:
    stamp = now or utcnow()
    west = min(point[0] for ring in FIELD_RINGS for point in ring)
    south = min(point[1] for ring in FIELD_RINGS for point in ring)
    east = max(point[0] for ring in FIELD_RINGS for point in ring)
    north = max(point[1] for ring in FIELD_RINGS for point in ring)
    farm = {
        "type": "Feature",
        "id": SAMPLE_FARM_ID,
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [[west, south], [east, south], [east, north], [west, north], [west, south]]
            ],
        },
        "properties": {
            "id": SAMPLE_FARM_ID,
            "name": "Iowa NASA benchmark",
            "boundarySource": "synthetic",
            "partitionCount": 4,
            "partitionMethod": "regular-grid",
            "partitionOrientation": "cardinal",
            "partitionGridRows": 2,
            "partitionGridColumns": 2,
            "partitionStatus": "confirmed",
            "createdAt": stamp,
            "updatedAt": stamp,
            "sourceReleaseId": SAMPLE_RELEASE_ID,
            "sampleVersion": SAMPLE_VERSION,
        },
    }
    fields: list[dict[str, Any]] = []
    for index, ring in enumerate(FIELD_RINGS, 1):
        identifier = f"{SAMPLE_FARM_ID}-field-{index}"
        fields.append(
            {
                "type": "Feature",
                "id": identifier,
                "geometry": {"type": "Polygon", "coordinates": [[list(point) for point in ring]]},
                "properties": {
                    "id": identifier,
                    "farmId": SAMPLE_FARM_ID,
                    "name": f"Field {index}",
                    "status": "confirmed",
                    "partitionIndex": index,
                    "boundarySource": "generated",
                    "farmerConfirmed": True,
                    "createdAt": stamp,
                    "updatedAt": stamp,
                },
            }
        )
    return WorkspaceDocument.model_validate(
        {"farms": [farm], "fields": fields, "initialized_from": SAMPLE_VERSION}
    )


def _view(row: FieldWorkspaceRecord) -> WorkspaceView:
    return WorkspaceView.model_validate(
        {
            **row.data,
            "version": row.version,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
    )


class FieldWorkspaceService:
    async def get_or_create(self, session: AsyncSession, user_id: str) -> WorkspaceView:
        row = await session.get(FieldWorkspaceRecord, user_id)
        if row is None:
            document = _sample()
            row = FieldWorkspaceRecord(owner_user_id=user_id, data=document.model_dump(mode="json"))
            session.add(row)
            try:
                await session.commit()
                await session.refresh(row)
            except IntegrityError:
                await session.rollback()
                row = await session.get(FieldWorkspaceRecord, user_id)
                if row is None:
                    raise
        return _view(row)

    async def replace(
        self, session: AsyncSession, user_id: str, body: WorkspacePut
    ) -> WorkspaceView:
        data = WorkspaceDocument.model_validate(body.model_dump(exclude={"expected_version"}))
        row = await session.scalar(
            update(FieldWorkspaceRecord)
            .where(
                FieldWorkspaceRecord.owner_user_id == user_id,
                FieldWorkspaceRecord.version == body.expected_version,
            )
            .values(
                data=data.model_dump(mode="json"),
                version=FieldWorkspaceRecord.version + 1,
                updated_at=utcnow(),
            )
            .returning(FieldWorkspaceRecord)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise HTTPException(409, "This field workspace changed. Reload it before saving.")
        await session.commit()
        return _view(row)

    async def restore_sample(self, session: AsyncSession, user_id: str) -> WorkspaceView:
        await self.get_or_create(session, user_id)
        row = await session.scalar(
            select(FieldWorkspaceRecord)
            .where(FieldWorkspaceRecord.owner_user_id == user_id)
            .with_for_update()
        )
        assert row is not None
        document = WorkspaceDocument.model_validate(row.data)
        if any(farm.properties.id == SAMPLE_FARM_ID for farm in document.farms):
            await session.commit()
            return _view(row)
        sample = _sample()
        document.farms.extend(sample.farms)
        document.fields.extend(sample.fields)
        row.data = document.model_dump(mode="json")
        row.version += 1
        row.updated_at = utcnow()
        await session.commit()
        await session.refresh(row)
        return _view(row)
