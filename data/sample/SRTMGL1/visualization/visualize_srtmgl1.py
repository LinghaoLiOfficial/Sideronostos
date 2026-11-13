#!/usr/bin/env python3
"""Visualize a zipped SRTMGL1 HGT elevation tile."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


EXPECTED_SIZE = 3601
VOID_VALUE = -32768
METRES_PER_DEGREE = 111_320.0
MISSING_COLOR = "#e5e7eb"
TILE_PATTERN = re.compile(r"^([NS])(\d{2})([EW])(\d{3})\.hgt$", re.IGNORECASE)


@dataclass(frozen=True)
class Tile:
    tile_id: str
    elevation: np.ndarray
    valid: np.ndarray
    west: float
    east: float
    south: float
    north: float
    latitude_spacing_m: float
    longitude_spacing_m_at_center: float


@dataclass(frozen=True)
class Terrain:
    slope_degrees: np.ndarray
    hillshade: np.ndarray
    derivative_valid: np.ndarray


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("stride must be at least 1")
    return parsed


def tile_bounds(member_name: str) -> tuple[str, float, float, float, float]:
    name = Path(member_name).name
    match = TILE_PATTERN.fullmatch(name)
    if not match:
        raise ValueError(f"Invalid HGT tile filename: {member_name}")
    latitude_sign, latitude_text, longitude_sign, longitude_text = match.groups()
    south = float(int(latitude_text) * (1 if latitude_sign.upper() == "N" else -1))
    west = float(int(longitude_text) * (1 if longitude_sign.upper() == "E" else -1))
    return name[:-4].upper(), west, west + 1.0, south, south + 1.0


def read_tile(input_path: Path) -> Tile:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input ZIP file does not exist: {input_path}")
    try:
        with ZipFile(input_path) as archive:
            members = [
                info
                for info in archive.infolist()
                if not info.is_dir() and info.filename.lower().endswith(".hgt")
            ]
            if len(members) != 1:
                raise ValueError(
                    f"Expected exactly one HGT member, found {len(members)}: "
                    + ", ".join(info.filename for info in members)
                )
            member = members[0]
            raw = archive.read(member)
    except BadZipFile as error:
        raise ValueError(f"Invalid ZIP archive: {input_path}") from error

    if len(raw) % 2:
        raise ValueError(f"HGT byte length must be even, got {len(raw):,}")
    sample_count = len(raw) // 2
    size = int(np.sqrt(sample_count))
    if size * size != sample_count:
        raise ValueError(
            f"HGT sample count {sample_count:,} does not form a square grid"
        )
    if size != EXPECTED_SIZE:
        raise ValueError(
            f"Expected SRTMGL1 grid {EXPECTED_SIZE}x{EXPECTED_SIZE}, got {size}x{size}"
        )

    tile_id, west, east, south, north = tile_bounds(member.filename)
    raw_elevation = np.frombuffer(raw, dtype=">i2").reshape(size, size)
    valid = raw_elevation != VOID_VALUE
    if not valid.any():
        raise ValueError("HGT tile contains no valid elevation samples")
    elevation = raw_elevation.astype(np.float32)
    elevation[~valid] = np.nan

    arc_seconds = 3600.0 / (size - 1)
    latitude_spacing_m = METRES_PER_DEGREE * arc_seconds / 3600.0
    center_latitude = (south + north) / 2.0
    longitude_spacing_m = (
        METRES_PER_DEGREE
        * np.cos(np.deg2rad(center_latitude))
        * arc_seconds
        / 3600.0
    )
    return Tile(
        tile_id=tile_id,
        elevation=elevation,
        valid=valid,
        west=west,
        east=east,
        south=south,
        north=north,
        latitude_spacing_m=latitude_spacing_m,
        longitude_spacing_m_at_center=longitude_spacing_m,
    )


def terrain_derivatives(tile: Tile) -> Terrain:
    size = tile.elevation.shape[0]
    latitudes = np.linspace(tile.north, tile.south, size, dtype=np.float64)
    longitude_spacing = (
        METRES_PER_DEGREE * np.cos(np.deg2rad(latitudes)) / (size - 1)
    )
    row_change, column_change = np.gradient(tile.elevation)
    dz_north = -row_change / tile.latitude_spacing_m
    dz_east = column_change / longitude_spacing[:, np.newaxis]
    derivative_valid = tile.valid & np.isfinite(dz_north) & np.isfinite(dz_east)

    gradient_magnitude = np.hypot(dz_east, dz_north)
    slope = np.degrees(np.arctan(gradient_magnitude)).astype(np.float32)
    slope[~derivative_valid] = np.nan

    azimuth = np.deg2rad(315.0)
    altitude = np.deg2rad(45.0)
    sun_east = np.sin(azimuth) * np.cos(altitude)
    sun_north = np.cos(azimuth) * np.cos(altitude)
    sun_up = np.sin(altitude)
    normal_length = np.sqrt(1.0 + dz_east**2 + dz_north**2)
    illumination = (
        -dz_east * sun_east - dz_north * sun_north + sun_up
    ) / normal_length
    hillshade = np.clip(illumination, 0.0, 1.0).astype(np.float32)
    hillshade[~derivative_valid] = np.nan
    return Terrain(slope_degrees=slope, hillshade=hillshade, derivative_valid=derivative_valid)


def describe(values: np.ndarray) -> dict[str, float | int]:
    if values.size == 0:
        raise ValueError("Cannot summarize an empty array")
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    return {
        "count": int(values.size),
        "minimum": float(np.min(values)),
        "mean": float(np.mean(values, dtype=np.float64)),
        "median": float(median),
        "p05": float(p05),
        "p95": float(p95),
        "maximum": float(np.max(values)),
    }


def report(tile: Tile, terrain: Terrain) -> None:
    elevation_values = tile.elevation[tile.valid]
    slope_values = terrain.slope_degrees[terrain.derivative_valid]
    elevation_stats = describe(elevation_values)
    slope_stats = describe(slope_values)
    total = tile.elevation.size
    void_count = total - int(elevation_stats["count"])
    print(f"Tile: {tile.tile_id}")
    print(f"Grid: {tile.elevation.shape[0]} x {tile.elevation.shape[1]}")
    print(
        f"Coverage: longitude {tile.west:.6f} to {tile.east:.6f}, "
        f"latitude {tile.south:.6f} to {tile.north:.6f}"
    )
    print(
        f"Spacing: 1 arc-second; north-south={tile.latitude_spacing_m:.3f} m, "
        f"east-west at tile center={tile.longitude_spacing_m_at_center:.3f} m"
    )
    print(
        f"Valid elevation: {int(elevation_stats['count']):,}/{total:,} "
        f"({int(elevation_stats['count']) / total * 100.0:.2f}%); "
        f"Void={void_count:,} ({void_count / total * 100.0:.4f}%)"
    )
    print(
        f"Elevation (m): min={elevation_stats['minimum']:.0f}, "
        f"mean={elevation_stats['mean']:.3f}, median={elevation_stats['median']:.0f}, "
        f"p05={elevation_stats['p05']:.0f}, p95={elevation_stats['p95']:.0f}, "
        f"max={elevation_stats['maximum']:.0f}, "
        f"relief={elevation_stats['maximum'] - elevation_stats['minimum']:.0f}"
    )
    print(
        f"Slope (degrees): valid={int(slope_stats['count']):,}, "
        f"min={slope_stats['minimum']:.3f}, mean={slope_stats['mean']:.3f}, "
        f"median={slope_stats['median']:.3f}, p05={slope_stats['p05']:.3f}, "
        f"p95={slope_stats['p95']:.3f}, max={slope_stats['maximum']:.3f}"
    )


def style_map_axis(axis: plt.Axes) -> None:
    axis.set_xlabel("Longitude (degrees east)")
    axis.set_ylabel("Latitude (degrees north)")
    axis.ticklabel_format(style="plain", useOffset=False)


def render(tile: Tile, terrain: Terrain, output_path: Path, stride: int) -> None:
    extent = (tile.west, tile.east, tile.south, tile.north)
    figure, axes = plt.subplots(2, 2, figsize=(15, 11), layout="constrained")

    elevation_cmap = matplotlib.colormaps["terrain"].copy()
    elevation_cmap.set_bad(MISSING_COLOR)
    elevation_image = axes[0, 0].imshow(
        tile.elevation[::stride, ::stride],
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=elevation_cmap,
        vmin=float(np.nanmin(tile.elevation)),
        vmax=float(np.nanmax(tile.elevation)),
    )
    axes[0, 0].set_title("Elevation above EGM96 geoid")
    style_map_axis(axes[0, 0])
    figure.colorbar(elevation_image, ax=axes[0, 0], label="Elevation (m)", shrink=0.86)

    hillshade_cmap = matplotlib.colormaps["gray"].copy()
    hillshade_cmap.set_bad(MISSING_COLOR)
    axes[0, 1].imshow(
        terrain.hillshade[::stride, ::stride],
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=hillshade_cmap,
        vmin=0.0,
        vmax=1.0,
    )
    axes[0, 1].set_title("Terrain hillshade\nAzimuth 315 degrees, altitude 45 degrees")
    style_map_axis(axes[0, 1])

    slope_values = terrain.slope_degrees[terrain.derivative_valid]
    slope_high = float(np.percentile(slope_values, 99))
    slope_cmap = matplotlib.colormaps["magma"].copy()
    slope_cmap.set_bad(MISSING_COLOR)
    slope_image = axes[1, 0].imshow(
        terrain.slope_degrees[::stride, ::stride],
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=slope_cmap,
        vmin=0.0,
        vmax=slope_high,
    )
    axes[1, 0].set_title("Terrain slope\nFull-resolution gradient, display capped at p99")
    style_map_axis(axes[1, 0])
    figure.colorbar(
        slope_image,
        ax=axes[1, 0],
        label="Slope (degrees)",
        extend="max",
        shrink=0.86,
    )

    elevation_values = tile.elevation[tile.valid]
    counts, edges = np.histogram(elevation_values, bins=80)
    axes[1, 1].stairs(counts, edges, color="#2563eb", linewidth=1.8, fill=True, alpha=0.28)
    p05, median, p95 = np.percentile(elevation_values, [5, 50, 95])
    for value, label, color in (
        (p05, "p05", "#0f766e"),
        (median, "median", "#dc2626"),
        (p95, "p95", "#7c3aed"),
    ):
        axes[1, 1].axvline(value, color=color, linestyle="--", linewidth=1.5, label=f"{label}: {value:.0f} m")
    axes[1, 1].set(
        title="Full-resolution elevation distribution",
        xlabel="Elevation (m)",
        ylabel="Pixel count",
    )
    axes[1, 1].ticklabel_format(axis="y", style="sci", scilimits=(0, 0))
    axes[1, 1].grid(axis="y", alpha=0.2)
    axes[1, 1].legend(frameon=False)

    figure.suptitle(
        f"SRTMGL1 - {tile.tile_id} - 1 arc-second digital elevation model\n"
        f"{tile.south:.0f} to {tile.north:.0f} degrees N | "
        f"{tile.west:.0f} to {tile.east:.0f} degrees E | approximately 30 m",
        fontsize=15,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    print(f"Saved visualization: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Input zipped SRTMGL1 HGT tile")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG path")
    parser.add_argument(
        "--stride",
        type=positive_int,
        default=2,
        help="Map sampling stride; statistics and derivatives use the full grid (default: 2)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        tile = read_tile(args.input)
        terrain = terrain_derivatives(tile)
        report(tile, terrain)
        render(tile, terrain, args.output, args.stride)
    except (OSError, ValueError) as error:
        raise SystemExit(f"Error: {error}") from error


if __name__ == "__main__":
    main()
