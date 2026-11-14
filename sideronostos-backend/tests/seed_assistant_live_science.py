"""Publish a tiny synthetic weather release in the dedicated live assistant test DB."""

from __future__ import annotations

import asyncio
import os

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sideronostos_backend.modules.agri_data.models import ScienceRelease

RELEASE_ID = "assistant-demo-weather-2025"


async def main() -> None:
    url = os.getenv("FIELD_SHIFT_TEST_DATABASE_URL", "")
    if not url or "test" not in (make_url(url).database or ""):
        raise RuntimeError("A dedicated PostgreSQL test database is required")
    engine = create_async_engine(url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            row = await session.get(ScienceRelease, RELEASE_ID)
            if row is None:
                session.add(ScienceRelease(
                    id=RELEASE_ID,
                    product="NASA_POWER_DAILY",
                    status="published",
                    manifest_sha256="d" * 64,
                    data={
                        "start": "2025-01-01",
                        "end": "2025-01-01",
                        "latitude": 42,
                        "longitude": -93.5,
                        "recipe": "assistant-synthetic-demo-v1",
                        "source_kind": "synthetic_test",
                        "days": [{
                            "date": "2025-01-01", "rain_mm": 4.0, "et0_mm": 2.0,
                        }],
                    },
                ))
                await session.commit()
            elif (
                row.product != "NASA_POWER_DAILY"
                or row.data.get("source_kind") != "synthetic_test"
            ):
                raise RuntimeError("The demo release ID is occupied by non-synthetic data")
            print(f"Published synthetic release: {RELEASE_ID}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
