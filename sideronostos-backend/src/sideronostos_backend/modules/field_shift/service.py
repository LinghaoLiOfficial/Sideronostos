"""Field Shift persistence; identity comes exclusively from the authenticated principal."""

from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .engine import generate_options
from .models import AnalysisRecord, FieldRecord, SavedPlanRecord, utcnow
from .profiles import get_profile
from .schemas import (
    Analysis,
    Environment,
    Field,
    FieldInput,
    PlanningInputs,
    ProfileSummary,
    SavedPlan,
)

REFERENCE_YEAR = 2025


async def fetch_environment(latitude: float, longitude: float, reference_year: int) -> Environment:
    from .environment import fetch_environment as fetch

    return await fetch(latitude, longitude, reference_year)


def _validate_field(body: FieldInput) -> None:
    try:
        profile = get_profile(body.profile_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    known = {crop.id for crop in profile.crops}
    unknown = {entry.crop_id for entry in body.history} - known
    if unknown:
        raise HTTPException(
            status_code=422, detail=f"Unknown crop identifiers: {', '.join(sorted(unknown))}"
        )

    from ..rotation_optimizer.profiles import get_profile as rotation_profile

    for event in body.history_events:
        try:
            catalogue = rotation_profile(event.profile_id).history_catalogue
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        if event.crop_id not in catalogue:
            raise HTTPException(422, "Unknown crop in precise history catalogue")


def _field(record: FieldRecord) -> Field:
    return Field(
        **record.data,
        id=record.id,
        version=record.version,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class FieldShiftService:
    async def _field_record(
        self, session: AsyncSession, user_id: str, field_id: str
    ) -> FieldRecord:
        record = await session.scalar(
            select(FieldRecord)
            .where(
                FieldRecord.id == field_id,
                FieldRecord.owner_user_id == user_id,
            )
            .execution_options(populate_existing=True)
        )
        if record is None:
            raise HTTPException(status_code=404, detail="Field not found")
        return record

    async def list_fields(self, session: AsyncSession, user_id: str) -> list[Field]:
        records = (
            await session.scalars(
                select(FieldRecord)
                .where(
                    FieldRecord.owner_user_id == user_id,
                )
                .order_by(FieldRecord.updated_at.desc(), FieldRecord.id)
            )
        ).all()
        return [_field(record) for record in records]

    async def get_field(self, session: AsyncSession, user_id: str, field_id: str) -> Field:
        return _field(await self._field_record(session, user_id, field_id))

    async def create_field(
        self,
        session: AsyncSession,
        user_id: str,
        body: FieldInput,
        *,
        field_id: str | None = None,
        commit: bool = True,
    ) -> Field:
        _validate_field(body)
        values = {"id": field_id} if field_id is not None else {}
        record = FieldRecord(owner_user_id=user_id, data=body.model_dump(mode="json"), **values)
        session.add(record)
        if commit:
            await session.commit()
        else:
            await session.flush()
        await session.refresh(record)
        return _field(record)

    async def update_field(
        self,
        session: AsyncSession,
        user_id: str,
        field_id: str,
        body: FieldInput,
        expected_version: int,
    ) -> Field:
        original = await self._field_record(session, user_id, field_id)
        # Old clients omit extension fields. Only explicit values may clear them.
        body = FieldInput.model_validate(
            {**original.data, **body.model_dump(mode="json", exclude_unset=True)}
        )
        _validate_field(body)
        record = await session.scalar(
            update(FieldRecord)
            .where(
                FieldRecord.id == field_id,
                FieldRecord.owner_user_id == user_id,
                FieldRecord.version == expected_version,
            )
            .values(
                data=body.model_dump(mode="json"),
                version=FieldRecord.version + 1,
                updated_at=utcnow(),
            )
            .returning(FieldRecord)
            .execution_options(populate_existing=True)
        )
        if record is None:
            raise HTTPException(
                status_code=409, detail="This field changed. Reload it before saving your edits."
            )
        await session.commit()
        return _field(record)

    async def get_environment(
        self,
        session: AsyncSession,
        user_id: str,
        field_id: str,
        *,
        refresh: bool = False,
    ) -> Environment:
        record = await self._field_record(session, user_id, field_id)
        field = _field(record)
        key = f"power-monthly-v1:{field.latitude!r}:{field.longitude!r}:{REFERENCE_YEAR}"
        if (
            not refresh
            and record.environment_key == key
            and record.environment_snapshot is not None
        ):
            cached = Environment.model_validate(record.environment_snapshot)
            if cached.status == "live":
                return cached.model_copy(update={"status": "cached"})
            if cached.status == "cached":
                return cached
            # Failed-provider fallbacks must not permanently pin a field to demo data.
            if (
                record.environment_cached_at is not None
                and (utcnow() - record.environment_cached_at).total_seconds() < 60
            ):
                return cached

        # Release the read transaction before the external weather request.
        await session.commit()
        result = await fetch_environment(field.latitude, field.longitude, REFERENCE_YEAR)
        cached_at: datetime | None = utcnow()
        if result.status in {"demo", "unavailable"}:
            # A concurrent successful refresh may have written newer observations
            # while this request was in flight. Lock and inspect the latest copy.
            latest = await session.scalar(
                select(FieldRecord)
                .where(FieldRecord.id == field_id, FieldRecord.owner_user_id == user_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if latest is not None and latest.environment_key == key and latest.environment_snapshot:
                previous = Environment.model_validate(latest.environment_snapshot)
                if previous.status in {"live", "cached"}:
                    result = previous.model_copy(
                        update={
                            "status": "cached",
                            "limitations": list(
                                dict.fromkeys(
                                    [
                                        *previous.limitations,
                                        "刷新失败，继续使用同一地点与参考年的真实历史缓存；数据获取时间未更新。请稍后重试。",
                                    ]
                                )
                            ),
                        }
                    )
                    cached_at = latest.environment_cached_at
        updated = await session.scalar(
            update(FieldRecord)
            .where(
                FieldRecord.id == field_id,
                FieldRecord.owner_user_id == user_id,
                FieldRecord.version == field.version,
            )
            .values(
                environment_key=key,
                environment_snapshot=result.model_dump(mode="json"),
                environment_cached_at=cached_at,
            )
            .returning(FieldRecord.id)
        )
        if updated is None:
            raise HTTPException(
                status_code=409,
                detail="This field changed while weather was loading. Reload and retry.",
            )
        await session.commit()
        return result

    async def create_analysis(
        self,
        session: AsyncSession,
        user_id: str,
        field_id: str,
        inputs: PlanningInputs,
        expected_field_version: int,
    ) -> Analysis:
        field = await self.get_field(session, user_id, field_id)
        if field.version != expected_field_version:
            raise HTTPException(
                status_code=409, detail="This field changed. Reload it before comparing plans."
            )
        environment = await self.get_environment(session, user_id, field_id)
        try:
            profile = get_profile(field.profile_id)
            result = generate_options(field, profile, environment, inputs)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        # Recheck atomically after weather retrieval and computation. A concurrent
        # field edit must not silently attach old assumptions to the new version.
        version = await session.scalar(
            select(FieldRecord.version)
            .where(
                FieldRecord.id == field_id,
                FieldRecord.owner_user_id == user_id,
            )
            .with_for_update()
        )
        if version != field.version:
            raise HTTPException(
                status_code=409,
                detail="This field changed during analysis. Reload and compare again.",
            )
        analysis = Analysis(
            **result.model_dump(),
            id=str(uuid4()),
            field_id=field_id,
            field_version=field.version,
            created_at=utcnow(),
            profile=ProfileSummary.model_validate(profile),
            profile_snapshot=profile.model_copy(deep=True),
            inputs=inputs,
            environment=environment,
        )
        session.add(
            AnalysisRecord(
                id=analysis.id,
                owner_user_id=user_id,
                field_id=field_id,
                data=analysis.model_dump(mode="json"),
                field_snapshot=field.model_dump(mode="json"),
                created_at=analysis.created_at,
            )
        )
        await session.commit()
        return analysis

    async def _analysis_record(
        self,
        session: AsyncSession,
        user_id: str,
        analysis_id: str,
    ) -> AnalysisRecord:
        record = await session.scalar(
            select(AnalysisRecord).where(
                AnalysisRecord.id == analysis_id,
                AnalysisRecord.owner_user_id == user_id,
            )
        )
        if record is None:
            raise HTTPException(status_code=404, detail="Analysis not found")
        return record

    async def get_analysis(self, session: AsyncSession, user_id: str, analysis_id: str) -> Analysis:
        return Analysis.model_validate(
            (await self._analysis_record(session, user_id, analysis_id)).data
        )

    async def list_plans(
        self,
        session: AsyncSession,
        user_id: str,
        field_id: str | None = None,
    ) -> list[SavedPlan]:
        conditions = [SavedPlanRecord.owner_user_id == user_id]
        if field_id is not None:
            await self._field_record(session, user_id, field_id)
            conditions.append(SavedPlanRecord.field_id == field_id)
        records = (
            await session.scalars(
                select(SavedPlanRecord)
                .where(*conditions)
                .order_by(SavedPlanRecord.created_at.desc(), SavedPlanRecord.id)
            )
        ).all()
        return [SavedPlan.model_validate(record.data) for record in records]

    async def get_plan(self, session: AsyncSession, user_id: str, plan_id: str) -> SavedPlan:
        record = await session.scalar(
            select(SavedPlanRecord).where(
                SavedPlanRecord.id == plan_id,
                SavedPlanRecord.owner_user_id == user_id,
            )
        )
        if record is None:
            raise HTTPException(status_code=404, detail="Saved plan not found")
        return SavedPlan.model_validate(record.data)

    async def save_plan(
        self,
        session: AsyncSession,
        user_id: str,
        analysis_id: str,
        option_id: str,
        title: str,
        notes: str,
    ) -> SavedPlan:
        record = await self._analysis_record(session, user_id, analysis_id)
        analysis = Analysis.model_validate(record.data)
        field = Field.model_validate(record.field_snapshot)
        option = next(
            (item for item in [analysis.baseline, *analysis.alternatives] if item.id == option_id),
            None,
        )
        if option is None:
            raise HTTPException(status_code=422, detail="Choose an option from this analysis.")
        if not option.feasible:
            raise HTTPException(
                status_code=422,
                detail="Resolve this option's constraint violations before saving a plan.",
            )
        existing_query = select(SavedPlanRecord).where(
            SavedPlanRecord.owner_user_id == user_id,
            SavedPlanRecord.analysis_id == analysis_id,
            SavedPlanRecord.option_id == option_id,
        )
        existing = await session.scalar(existing_query)
        if existing is not None:
            return SavedPlan.model_validate(existing.data)
        saved = SavedPlan(
            id=str(uuid4()),
            title=title,
            notes=notes,
            created_at=utcnow(),
            field_id=field.id,
            field_name=field.name,
            option=option,
            analysis=analysis,
            field_snapshot=field,
        )
        session.add(
            SavedPlanRecord(
                id=saved.id,
                owner_user_id=user_id,
                field_id=field.id,
                analysis_id=analysis_id,
                option_id=option_id,
                data=saved.model_dump(mode="json"),
                created_at=saved.created_at,
            )
        )
        try:
            await session.commit()
        except IntegrityError:
            # Concurrent tabs can both observe no saved copy. The unique key is
            # authoritative; return the already committed immutable snapshot.
            await session.rollback()
            existing = await session.scalar(existing_query)
            if existing is None:
                raise
            return SavedPlan.model_validate(existing.data)
        return saved
