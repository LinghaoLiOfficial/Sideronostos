"""Transactional, owner-scoped farm synchronization with replayable batch receipts."""

import hashlib
import json
import math
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from shapely.geometry import Point, shape  # type: ignore[import-untyped]
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..agri_data.schemas import validate_geometry
from .farm_schemas import FarmSyncInput, SyncField
from .models import FarmRecord, FarmSyncReceipt, FieldRecord, utcnow
from .schemas import FieldInput
from .service import _field, _validate_field


def farm_view(row: FarmRecord) -> dict[str, Any]:
    return {
        **row.data,
        "id": row.id,
        "local_id": row.local_id,
        "version": row.version,
        "resource_group_id": row.id,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def canonical_field(raw: dict[str, Any], farm: FarmRecord) -> FieldInput:
    body = FieldInput.model_validate(raw)
    _validate_field(body)
    if body.geometry is None:
        raise ValueError("Confirmed managed fields require a polygon boundary")
    geometry = validate_geometry(body.geometry, allow_holes=True)
    area = geometry["area_ha"]
    # Turf spherical areas and WGS84 ellipsoidal areas differ. Accept at most 1%
    # measurement discrepancy, then persist the canonical geodesic area.
    if not math.isclose(body.area_ha, area, rel_tol=0.01, abs_tol=1e-5):
        raise ValueError("Declared area differs from the boundary area by more than 1%")
    boundary = shape(body.geometry)
    if not boundary.covers(Point(body.longitude, body.latitude)):
        raise ValueError("Field reference coordinate must lie inside its boundary")
    if not shape(farm.data["geometry"]).buffer(1e-8).covers(boundary):
        raise ValueError("Field boundary must lie inside the farm")
    return body.model_copy(update={"area_ha": area})


async def validate_neighbors(
    session: AsyncSession, farm_id: str, revision: str, local_id: str, body: FieldInput
) -> None:
    siblings = (
        await session.scalars(
            select(FieldRecord).where(
                FieldRecord.farm_id == farm_id,
                FieldRecord.partition_revision == revision,
                FieldRecord.local_id != local_id,
            )
        )
    ).all()
    boundary = shape(body.geometry)
    if any(boundary.intersection(shape(f.data["geometry"])).area > 1e-12 for f in siblings):
        raise ValueError("Managed fields in the same partition cannot overlap")


async def validate_managed_edit(
    session: AsyncSession, owner: str, original: FieldRecord, body: FieldInput
) -> FieldInput:
    farm = await session.scalar(
        select(FarmRecord)
        .where(FarmRecord.id == original.farm_id, FarmRecord.owner_user_id == owner)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if farm is None:
        raise HTTPException(404, "Farm not found")
    revision = original.partition_revision
    if revision is None or revision != farm.data["partition_revision"]:
        raise HTTPException(
            409, "Archived partition fields are read-only; use the active partition"
        )
    try:
        canonical = canonical_field(body.model_dump(mode="json"), farm)
        await validate_neighbors(session, farm.id, revision, original.local_id or "", canonical)
        return canonical
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


class FarmService:
    async def list_farms(self, session: AsyncSession, owner: str) -> list[dict[str, Any]]:
        rows = (
            await session.scalars(
                select(FarmRecord)
                .where(FarmRecord.owner_user_id == owner)
                .order_by(FarmRecord.updated_at.desc(), FarmRecord.id)
            )
        ).all()
        return [farm_view(row) for row in rows]

    async def get_farm(self, session: AsyncSession, owner: str, identifier: str) -> dict[str, Any]:
        farm = await session.scalar(
            select(FarmRecord).where(FarmRecord.id == identifier, FarmRecord.owner_user_id == owner)
        )
        if farm is None:
            raise HTTPException(404, "Farm not found")
        fields = (
            await session.scalars(
                select(FieldRecord)
                .where(
                    FieldRecord.farm_id == farm.id,
                    FieldRecord.owner_user_id == owner,
                    FieldRecord.partition_revision == farm.data["partition_revision"],
                )
                .order_by(FieldRecord.local_id)
            )
        ).all()
        return {**farm_view(farm), "fields": [_field(f).model_dump(mode="json") for f in fields]}

    async def _receipt(
        self, session: AsyncSession, owner: str, key: str, digest: str
    ) -> dict[str, Any] | None:
        receipt = await session.get(FarmSyncReceipt, (owner, key))
        if receipt is None:
            return None
        if receipt.payload_hash != digest:
            raise HTTPException(409, "Idempotency key already belongs to different inputs")
        return receipt.response

    async def sync(self, session: AsyncSession, owner: str, body: FarmSyncInput) -> dict[str, Any]:
        digest = hashlib.sha256(
            json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        replay = await self._receipt(session, owner, body.idempotency_key, digest)
        if replay is not None:
            return replay
        data = body.farm.model_dump(mode="json", exclude={"local_id", "expected_version"})
        now = utcnow()
        try:
            created = await session.scalar(
                insert(FarmRecord)
                .values(
                    id=str(uuid4()),
                    owner_user_id=owner,
                    local_id=body.farm.local_id,
                    version=1,
                    data=data,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_nothing(constraint="uq_farm_owner_local")
                .returning(FarmRecord.id)
            )
            farm = await session.scalar(
                select(FarmRecord)
                .where(FarmRecord.owner_user_id == owner, FarmRecord.local_id == body.farm.local_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            assert farm is not None
            # The farm lock serializes concurrent writes and overlap checks.
            replay = await self._receipt(session, owner, body.idempotency_key, digest)
            if replay is not None:
                await session.commit()
                return replay
            expected = body.farm.expected_version
            if (created and expected is not None) or (
                expected is not None and expected != farm.version
            ):
                raise HTTPException(409, "Farm version changed; reload before synchronizing")
            if farm.data != data:
                if expected is None:
                    raise HTTPException(
                        409, "Changing a farm or partition requires its current version"
                    )
                farm.data, farm.version, farm.updated_at = data, farm.version + 1, now
                await session.flush()
            items = []
            for item in body.fields:
                try:
                    async with session.begin_nested():
                        saved = await self._sync_field(session, owner, farm, item)
                        items.append(
                            {
                                "local_id": item.local_id,
                                "status": "synced",
                                "field": _field(saved).model_dump(mode="json"),
                                "error": None,
                            }
                        )
                except (ValueError, ValidationError, HTTPException) as error:
                    code = error.status_code if isinstance(error, HTTPException) else 422
                    if code not in {404, 409, 422}:
                        raise
                    detail = error.detail if isinstance(error, HTTPException) else str(error)
                    items.append(
                        {
                            "local_id": item.local_id,
                            "status": "conflict" if code == 409 else "invalid",
                            "field": None,
                            "error": str(detail),
                        }
                    )
            response = {
                "farm": farm_view(farm),
                "items": items,
                "complete": all(i["status"] == "synced" for i in items),
            }
            session.add(
                FarmSyncReceipt(
                    owner_user_id=owner,
                    idempotency_key=body.idempotency_key,
                    payload_hash=digest,
                    response=response,
                )
            )
            await session.commit()
            return response
        except IntegrityError:
            # A concurrently reused key for a different farm rolls back all writes.
            await session.rollback()
            replay = await self._receipt(session, owner, body.idempotency_key, digest)
            if replay is not None:
                return replay
            raise
        except Exception:
            await session.rollback()
            raise

    async def _sync_field(
        self, session: AsyncSession, owner: str, farm: FarmRecord, item: SyncField
    ) -> FieldRecord:
        body = canonical_field(item.field, farm)
        data = body.model_dump(mode="json")
        revision = farm.data["partition_revision"]
        existing = await session.scalar(
            select(FieldRecord)
            .where(
                FieldRecord.farm_id == farm.id,
                FieldRecord.owner_user_id == owner,
                FieldRecord.partition_revision == revision,
                FieldRecord.local_id == item.local_id,
            )
            .execution_options(populate_existing=True)
        )
        await validate_neighbors(session, farm.id, revision, item.local_id, body)
        if existing is None:
            if item.expected_version is not None:
                raise HTTPException(409, "The linked field is missing in this partition")
            existing = FieldRecord(
                owner_user_id=owner,
                farm_id=farm.id,
                local_id=item.local_id,
                partition_revision=revision,
                data=data,
            )
            session.add(existing)
            await session.flush()
            return existing
        if item.expected_version is not None and item.expected_version != existing.version:
            raise HTTPException(409, "Field version changed; reload before synchronizing")
        if existing.data == data:
            return existing
        if item.expected_version is None:
            raise HTTPException(409, "Existing field differs; review its version before updating")
        saved = await session.scalar(
            update(FieldRecord)
            .where(
                FieldRecord.id == existing.id,
                FieldRecord.owner_user_id == owner,
                FieldRecord.version == item.expected_version,
            )
            .values(data=data, version=FieldRecord.version + 1, updated_at=utcnow())
            .returning(FieldRecord)
            .execution_options(populate_existing=True)
        )
        if saved is None:
            raise HTTPException(409, "Field changed during synchronization")
        return saved
