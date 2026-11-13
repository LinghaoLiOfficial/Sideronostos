"""Offline science publication; imports files already acquired and reviewed."""

import argparse
import asyncio
import hashlib
import json
import re
import shutil
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text

from ...core.config import get_settings
from ..database.session import create_engine, create_session_factory
from .adapters.power import parse_power
from .adapters.smap_l3 import prepare_smap
from .models import ScienceRelease
from .settings import get_agri_data_settings


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


async def publish(release_id: str, product: str, data: dict[str, Any]) -> dict[str, Any]:
    if not re.fullmatch(r"[a-z0-9-]{1,80}", release_id):
        raise ValueError("Use a stable lowercase release identifier")
    digest = hashlib.sha256(
        json.dumps(data, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()
    engine = create_engine(get_settings())
    try:
        async with create_session_factory(engine)() as session:
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                {"key": "science:" + release_id},
            )
            existing = await session.get(ScienceRelease, release_id)
            if existing:
                if existing.manifest_sha256 != digest or existing.status != "published":
                    raise ValueError("Release IDs are immutable; choose a new version")
                return {"id": release_id, "status": "already_published", "sha256": digest}
            session.add(
                ScienceRelease(
                    id=release_id,
                    product=product,
                    status="published",
                    manifest_sha256=digest,
                    data=data,
                    published_at=datetime.now(UTC),
                )
            )
            await session.commit()
        return {"id": release_id, "status": "published", "sha256": digest}
    finally:
        await engine.dispose()


async def main_async(args: argparse.Namespace) -> None:
    if args.command == "prepare-smap":
        manifest = prepare_smap(args.source, args.output)
        print(
            json.dumps(
                {
                    "status": "prepared_not_published",
                    "sha256": manifest["sha256"],
                    "passes": manifest["passes"],
                }
            )
        )
    elif args.command == "publish-power":
        payload = json.loads(args.source.read_text())
        data = parse_power(
            payload,
            latitude=args.latitude,
            longitude=args.longitude,
            start=args.start,
            end=args.end,
        )
        if data["complete_days"] != data["expected_days"]:
            raise ValueError("The first planning weather release requires a complete daily series")
        data["sha256"] = file_hash(args.source)
        data["product_version"] = str(
            payload.get("header", {}).get("api", {}).get("version", "unknown")
        )
        data["matching_policy"] = "point background lookup within 1000 m of requested coordinate"
        print(json.dumps(await publish(args.release, "NASA_POWER_DAILY", data)))
    else:
        manifest = json.loads((args.source / "manifest.json").read_text())
        if manifest["product"] != "SPL3SMP_E" or manifest["product_version"] != "006":
            raise ValueError("Unsupported scientific manifest")
        if not re.fullmatch(r"[a-z0-9-]{1,80}", args.release):
            raise ValueError("Invalid release identifier")
        destination = get_agri_data_settings().asset_root / args.release
        destination.mkdir(parents=True, exist_ok=True)
        for entry in manifest["passes"].values():
            source = (args.source / entry["asset"]).resolve()
            if (
                not source.is_relative_to(args.source.resolve())
                or file_hash(source) != entry["asset_sha256"]
            ):
                raise ValueError("Prepared asset integrity failed")
            target = destination / source.name
            if target.exists():
                if file_hash(target) != entry["asset_sha256"]:
                    raise ValueError("A different scientific asset exists under this release ID")
            else:
                temporary = target.with_suffix(".copying")
                shutil.copyfile(source, temporary)
                temporary.replace(target)
        result = await publish(args.release, "SPL3SMP_E", manifest)
        (destination / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        )
        print(json.dumps(result))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    smap = sub.add_parser("prepare-smap")
    smap.add_argument("--source", type=Path, required=True)
    smap.add_argument("--output", type=Path, required=True)
    for kind in ("power", "smap"):
        action = sub.add_parser("publish-" + kind)
        action.add_argument("--source", type=Path, required=True)
        action.add_argument("--release", required=True)
        if kind == "power":
            action.add_argument("--latitude", type=float, required=True)
            action.add_argument("--longitude", type=float, required=True)
            action.add_argument("--start", type=date.fromisoformat, required=True)
            action.add_argument("--end", type=date.fromisoformat, required=True)
    asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    main()
