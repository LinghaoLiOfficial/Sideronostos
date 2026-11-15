"""Owner-scoped editable agronomy with immutable published revisions."""

from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import LocalAgronomyVersion, utcnow
from .profiles import ProfileV2, get_profile, profile_hash
from .settings import get_rotation_settings

SYSTEM_FIELDS = ("id", "scope", "weather_release_id", "weather_center", "weather_radius_km")


def version_view(row: LocalAgronomyVersion) -> dict[str, Any]:
    return {
        "id": row.id,
        "revision": row.revision,
        "status": row.status,
        "is_active": row.is_active,
        "sha256": row.sha256,
        "profile": row.data,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "published_at": row.published_at.isoformat() if row.published_at else None,
    }


class LocalKnowledgeService:
    @staticmethod
    async def _lock_owner(session: AsyncSession, owner: str) -> None:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": "local-agronomy-owner:" + owner},
        )

    async def ensure(self, session: AsyncSession, owner: str) -> None:
        existing = await session.scalar(
            select(LocalAgronomyVersion.id).where(LocalAgronomyVersion.owner_user_id == owner)
        )
        if existing:
            return
        await self._lock_owner(session, owner)
        existing = await session.scalar(
            select(LocalAgronomyVersion.id).where(LocalAgronomyVersion.owner_user_id == owner)
        )
        if existing:
            return
        seed = get_profile(get_rotation_settings().default_profile_id)
        data = seed.model_dump(mode="json")
        checksum = profile_hash(seed)
        now = utcnow()
        session.add_all(
            [
                LocalAgronomyVersion(
                    id=str(uuid4()),
                    owner_user_id=owner,
                    revision=1,
                    status="published",
                    is_active=True,
                    data=data,
                    sha256=checksum,
                    created_at=now,
                    updated_at=now,
                    published_at=now,
                ),
                LocalAgronomyVersion(
                    id=str(uuid4()),
                    owner_user_id=owner,
                    revision=None,
                    status="draft",
                    is_active=False,
                    data=data,
                    sha256=checksum,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        await session.commit()

    async def catalogue(self, session: AsyncSession, owner: str) -> dict[str, Any]:
        await self.ensure(session, owner)
        rows = (
            await session.scalars(
                select(LocalAgronomyVersion)
                .where(LocalAgronomyVersion.owner_user_id == owner)
                .order_by(LocalAgronomyVersion.revision.desc().nulls_first())
            )
        ).all()
        draft = next(row for row in rows if row.status == "draft")
        active = next(row for row in rows if row.is_active)
        versions = [row for row in rows if row.status == "published"]
        return {
            "active": version_view(active),
            "draft": version_view(draft),
            "versions": [version_view(row) for row in versions],
        }

    async def active(self, session: AsyncSession, owner: str) -> LocalAgronomyVersion:
        await self.ensure(session, owner)
        row = await session.scalar(
            select(LocalAgronomyVersion).where(
                LocalAgronomyVersion.owner_user_id == owner,
                LocalAgronomyVersion.is_active.is_(True),
            )
        )
        if row is None:
            raise HTTPException(409, "No published local agronomy version is active")
        return row

    async def get_revision(
        self, session: AsyncSession, owner: str, revision: int
    ) -> dict[str, Any]:
        await self.ensure(session, owner)
        row = await session.scalar(
            select(LocalAgronomyVersion).where(
                LocalAgronomyVersion.owner_user_id == owner,
                LocalAgronomyVersion.revision == revision,
                LocalAgronomyVersion.status == "published",
            )
        )
        if row is None:
            raise HTTPException(404, "Local agronomy revision not found")
        return version_view(row)

    @staticmethod
    def _validated_profile(
        data: dict[str, Any], active: LocalAgronomyVersion
    ) -> ProfileV2:
        for field in SYSTEM_FIELDS:
            if data.get(field) != active.data.get(field):
                raise HTTPException(422, f"System-managed profile field cannot change: {field}")
        try:
            return ProfileV2.model_validate(data)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    async def save_draft(
        self,
        session: AsyncSession,
        owner: str,
        data: dict[str, Any],
        expected_updated_at: datetime,
    ) -> dict[str, Any]:
        await self.ensure(session, owner)
        await self._lock_owner(session, owner)
        draft = await session.scalar(
            select(LocalAgronomyVersion)
            .where(
                LocalAgronomyVersion.owner_user_id == owner,
                LocalAgronomyVersion.status == "draft",
            )
            .with_for_update()
        )
        active = await self.active(session, owner)
        if draft is None:
            raise HTTPException(409, "Local agronomy draft is unavailable")
        if draft.updated_at != expected_updated_at:
            raise HTTPException(409, "The local agronomy draft changed; reload before saving")
        profile = self._validated_profile(data, active)
        draft.data = profile.model_dump(mode="json")
        draft.sha256 = profile_hash(profile)
        draft.updated_at = utcnow()
        await session.commit()
        await session.refresh(draft)
        return version_view(draft)

    async def publish(
        self, session: AsyncSession, owner: str, expected_updated_at: datetime
    ) -> dict[str, Any]:
        await self.ensure(session, owner)
        await self._lock_owner(session, owner)
        draft = await session.scalar(
            select(LocalAgronomyVersion)
            .where(
                LocalAgronomyVersion.owner_user_id == owner,
                LocalAgronomyVersion.status == "draft",
            )
            .with_for_update()
        )
        active = await session.scalar(
            select(LocalAgronomyVersion)
            .where(
                LocalAgronomyVersion.owner_user_id == owner,
                LocalAgronomyVersion.is_active.is_(True),
            )
            .with_for_update()
        )
        if draft is None or active is None:
            raise HTTPException(409, "Local agronomy lifecycle is incomplete")
        if draft.updated_at != expected_updated_at:
            raise HTTPException(409, "The local agronomy draft changed; reload before publishing")
        profile = self._validated_profile(draft.data, active)
        maximum = await session.scalar(
            select(func.max(LocalAgronomyVersion.revision)).where(
                LocalAgronomyVersion.owner_user_id == owner
            )
        )
        now = utcnow()
        active.is_active = False
        draft.status = "published"
        draft.revision = int(maximum or 0) + 1
        draft.is_active = True
        draft.data = profile.model_dump(mode="json")
        draft.sha256 = profile_hash(profile)
        draft.updated_at = now
        draft.published_at = now
        replacement = LocalAgronomyVersion(
            id=str(uuid4()),
            owner_user_id=owner,
            revision=None,
            status="draft",
            is_active=False,
            data=draft.data,
            sha256=draft.sha256,
            created_at=now,
            updated_at=now,
        )
        session.add(replacement)
        await session.commit()
        return await self.catalogue(session, owner)

    async def resolve(
        self,
        session: AsyncSession,
        owner: str,
        version_id: str | None,
        checksum: str | None,
    ) -> tuple[ProfileV2, LocalAgronomyVersion]:
        if (version_id is None) != (checksum is None):
            raise HTTPException(422, "Profile version ID and checksum must be supplied together")
        active = await self.active(session, owner)
        if version_id is not None and (active.id != version_id or active.sha256 != checksum):
            raise HTTPException(409, "The active local agronomy version changed; reload and retry")
        try:
            return ProfileV2.model_validate(active.data), active
        except ValueError as error:
            raise HTTPException(500, "Published local agronomy is invalid") from error
