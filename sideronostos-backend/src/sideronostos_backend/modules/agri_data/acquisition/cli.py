"""Command-line entry point for the offline NASA acquisition pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, cast

from .analysis import analyze_non_appeears
from .auth import auth_summary
from .config import PipelineConfig
from .geometry import write_fields
from .layers import prepare_all
from .manifest import atomic_json
from .optimizer import optimize
from .pipeline import (
    download_completed_appeears,
    initialize,
    run_audit,
    run_fetch,
    run_plan,
    storage_budget,
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[6]


def _config(path: str | None) -> PipelineConfig:
    return PipelineConfig.load(Path(path)) if path else PipelineConfig.default(_repo_root())


def _print(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        prog="sideronostos_nasa",
        description="Real NASA acquisition, COG preparation, and historical rotation benchmark",
    )
    result.add_argument(
        "--config", help="Pipeline config JSON; defaults to the fixed Iowa benchmark"
    )
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "auth-check", help="Verify Earthdata .netrc authentication without printing credentials"
    )
    commands.add_parser("generate-aoi", help="Generate four synthetic Iowa fields")
    commands.add_parser("audit", help="Audit CMR/AppEEARS coverage and services")
    commands.add_parser("plan", help="Create the download plan and enforce disk budgets")
    commands.add_parser(
        "analyze",
        help="Analyze and visualize acquired POWER, GPM, SRTM, and GRACE data only",
    )
    fetch = commands.add_parser("fetch", help="Fetch real NASA data with resume and checksums")
    fetch.add_argument(
        "--products",
        nargs="+",
        choices=["power", "gpm", "smap", "hls", "ecostress", "srtm", "grace"],
    )
    fetch.add_argument(
        "--completed-only",
        action="store_true",
        help="Download only completed AppEEARS tasks; do not wait for pending tasks",
    )
    fetch.add_argument(
        "--submit-only", action="store_true", help="Submit AppEEARS tasks without waiting"
    )
    commands.add_parser(
        "prepare", help="Apply QA, aggregate data, and produce EPSG:4326 COG layers"
    )
    optimize_parser = commands.add_parser(
        "optimize", help="Solve nested 1/2/3-year historical benchmarks"
    )
    optimize_parser.add_argument("--time-limit", type=float, default=30)
    all_parser = commands.add_parser(
        "run-all", help="Run audit, plan, fetch, prepare, and optimize"
    )
    all_parser.add_argument("--time-limit", type=float, default=30)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    config = _config(args.config)
    try:
        if args.command == "auth-check":
            payload = {**auth_summary(), **storage_budget(config).check()}
        elif args.command == "generate-aoi":
            config.ensure_directories()
            payload = write_fields(
                config.root / "aoi" / "fields.geojson",
                longitude=config.longitude,
                latitude=config.latitude,
            )
        elif args.command == "audit":
            payload = run_audit(config)
        elif args.command == "plan":
            payload = run_plan(config)
        elif args.command == "analyze":
            payload = analyze_non_appeears(config)
        elif args.command == "fetch":
            selected_products = set(args.products) if args.products else None
            if args.completed_only:
                if args.submit_only:
                    raise ValueError("--completed-only cannot be combined with --submit-only")
                payload = download_completed_appeears(config, products=selected_products)
            else:
                payload = run_fetch(
                    config,
                    products=selected_products,
                    wait_for_appeears=not args.submit_only,
                )
            if "power" in payload:
                power = cast(dict[str, Any], payload["power"])
                payload["power"] = {
                    "product": power["product"],
                    "start": power["start"],
                    "end": power["end"],
                    "expected_days": power["expected_days"],
                    "complete_days": power["complete_days"],
                    "content_sha256": power["content_sha256"],
                }
        elif args.command == "prepare":
            initialize(config)
            payload = prepare_all(config)
        elif args.command == "optimize":
            initialize(config)
            payload = optimize(config, time_limit=args.time_limit)
        else:
            _, manifest = initialize(config)
            payload = {
                "audit": run_audit(config),
                "plan": run_plan(config),
                "fetch": run_fetch(config),
                "prepare": prepare_all(config),
                "optimize": optimize(config, time_limit=args.time_limit),
            }
            manifest.finish()
        _print(payload)
        return 0
    except Exception as error:
        if args.command != "analyze":
            config.ensure_directories()
            atomic_json(
                config.root / "last-error.json",
                {
                    "command": args.command,
                    "error_type": type(error).__name__,
                    "message": "See command output; raw service error text is not persisted.",
                },
            )
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
