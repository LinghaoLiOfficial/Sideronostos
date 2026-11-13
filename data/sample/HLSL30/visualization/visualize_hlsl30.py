#!/usr/bin/env python3
"""Visualize one HLSL30 scene using optical, thermal, and Fmask layers."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Patch
import numpy as np
import rasterio


REQUIRED_LAYERS = ("B02", "B03", "B04", "B05", "B06", "B10", "Fmask")
REFLECTANCE_LAYERS = ("B02", "B03", "B04", "B05", "B06")
FILE_PATTERN = re.compile(
    r"^(HLS\.L30\..+\.v\d+\.\d+)\.(B02|B03|B04|B05|B06|B10|Fmask)\.tif$"
)
FMASK_BITS = {
    "cirrus": 0,
    "cloud": 1,
    "adjacent_cloud": 2,
    "cloud_shadow": 3,
    "snow_ice": 4,
    "water": 5,
}
CATEGORY_LABELS = (
    "Clear land",
    "Water",
    "Snow / ice",
    "Cloud shadow",
    "Adjacent to cloud",
    "Cloud / cirrus",
    "NoData",
)
CATEGORY_COLORS = (
    "#a7d8a5",
    "#3b82f6",
    "#f8fafc",
    "#6b4f3a",
    "#f59e0b",
    "#d1d5db",
    "#111827",
)
MISSING_COLOR = "#e5e7eb"


@dataclass
class Layer:
    values: np.ndarray
    valid: np.ndarray
    description: str


@dataclass
class Scene:
    prefix: str
    layers: dict[str, Layer]
    fmask: np.ndarray
    fmask_valid: np.ndarray
    categories: np.ndarray
    crs: str
    bounds: tuple[float, float, float, float]
    resolution: tuple[float, float]
    metadata: dict[str, str]


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("stride must be a positive integer")
    return number


def find_scene(input_dir: Path) -> tuple[str, dict[str, Path]]:
    if not input_dir.is_dir():
        raise ValueError(f"Input directory does not exist: {input_dir}")
    groups: dict[str, dict[str, Path]] = {}
    for path in sorted(input_dir.glob("*.tif")):
        match = FILE_PATTERN.fullmatch(path.name)
        if match:
            prefix, name = match.groups()
            groups.setdefault(prefix, {})[name] = path
    if len(groups) != 1:
        names = ", ".join(groups) or "none"
        raise ValueError(f"Expected exactly one HLSL30 scene group, found {len(groups)}: {names}")
    prefix, paths = next(iter(groups.items()))
    missing = set(REQUIRED_LAYERS) - paths.keys()
    if missing:
        raise ValueError(f"Missing layers for {prefix}: {', '.join(sorted(missing))}")
    return prefix, paths


def classify_fmask(fmask: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Build exclusive categories; later assignments have higher priority."""
    categories = np.full(fmask.shape, 6, dtype=np.uint8)
    categories[valid] = 0
    categories[valid & ((fmask & (1 << FMASK_BITS["water"])) != 0)] = 1
    categories[valid & ((fmask & (1 << FMASK_BITS["snow_ice"])) != 0)] = 2
    categories[valid & ((fmask & (1 << FMASK_BITS["cloud_shadow"])) != 0)] = 3
    categories[valid & ((fmask & (1 << FMASK_BITS["adjacent_cloud"])) != 0)] = 4
    cloud_or_cirrus = (
        ((fmask & (1 << FMASK_BITS["cloud"])) != 0)
        | ((fmask & (1 << FMASK_BITS["cirrus"])) != 0)
    )
    categories[valid & cloud_or_cirrus] = 5
    return categories


def read_scene(input_dir: Path) -> Scene:
    prefix, paths = find_scene(input_dir)
    layers: dict[str, Layer] = {}
    reference = None
    metadata: dict[str, str] = {}
    fmask = None
    fmask_valid = None

    for name in REQUIRED_LAYERS:
        with rasterio.open(paths[name]) as source:
            if source.count != 1 or source.crs is None:
                raise ValueError(f"{name}: expected a single-band raster with a CRS")
            if not source.crs.is_projected or source.crs.linear_units != "metre":
                raise ValueError(f"{name}: expected a projected CRS with metre units")
            transform = source.transform
            if transform.b != 0 or transform.d != 0 or transform.a <= 0 or transform.e >= 0:
                raise ValueError(f"{name}: expected an unrotated, north-up raster")
            signature = (source.shape, source.crs, transform)
            if reference is None:
                reference = signature
                bounds = tuple(source.bounds)
                resolution = tuple(source.res)
                crs = source.crs.to_string()
            elif signature != reference:
                raise ValueError(f"{name}: shape, CRS or affine transform differs from B02")

            raw = source.read(1)
            valid = (source.read_masks(1) > 0) & np.isfinite(raw)
            if source.nodata is not None:
                valid &= raw != source.nodata
            tags = source.tags()

            if name == "Fmask":
                if raw.dtype != np.uint8 or source.nodata != 255:
                    raise ValueError("Fmask: expected uint8 data with NoData=255")
                bit_description = tags.get("Fmask bit description", "")
                if not all(word in bit_description for word in ("water", "snow/ice", "cloud shadow", "cloud", "cirrus")):
                    raise ValueError("Fmask bit description is missing or incomplete")
                if source.scales != (1.0,) or source.offsets != (0.0,):
                    raise ValueError("Fmask: unexpected scale/offset")
                fmask = raw
                fmask_valid = valid
                metadata = tags
                continue

            expected_scale = 0.01 if name == "B10" else 0.0001
            if not np.isclose(source.scales[0], expected_scale) or not np.isclose(source.offsets[0], 0):
                raise ValueError(
                    f"{name}: expected scale={expected_scale} and offset=0, found "
                    f"{source.scales[0]} and {source.offsets[0]}"
                )
            if name == "B10" and tags.get("unit") != "Celsius":
                raise ValueError(f"B10: expected unit='Celsius', found {tags.get('unit')!r}")
            values = raw.astype(np.float32) * np.float32(source.scales[0])
            values += np.float32(source.offsets[0])
            layers[name] = Layer(values, valid, source.descriptions[0] or tags.get("long_name", name))

    if fmask is None or fmask_valid is None:
        raise ValueError("Fmask was not loaded")
    if metadata.get("SENTINEL2_TILEID") not in prefix:
        raise ValueError("Fmask tile metadata does not match the filename")
    categories = classify_fmask(fmask, fmask_valid)
    return Scene(
        prefix,
        layers,
        fmask,
        fmask_valid,
        categories,
        crs,
        bounds,
        resolution,
        metadata,
    )


def masks(scene: Scene) -> tuple[np.ndarray, np.ndarray]:
    flagged_surface = sum(1 << bit for bit in range(5))
    clear_sky = scene.fmask_valid & ((scene.fmask & flagged_surface) == 0)
    clear_land = clear_sky & ((scene.fmask & (1 << FMASK_BITS["water"])) == 0)
    return clear_sky, clear_land


def compute_index(
    first: Layer, second: Layer, base_mask: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    denominator = first.values + second.values
    valid = base_mask & first.valid & second.valid & (denominator > 0)
    result = np.full(first.values.shape, np.nan, dtype=np.float32)
    np.divide(
        first.values - second.values,
        denominator,
        out=result,
        where=denominator != 0,
    )
    valid &= np.isfinite(result) & (result >= -1) & (result <= 1)
    result[~valid] = np.nan
    return result, valid


def summary_stats(label: str, values: np.ndarray, unit: str = "") -> None:
    if not values.size:
        print(f"{label}: no valid pixels")
        return
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    suffix = f" {unit}" if unit else ""
    print(
        f"{label}: n={values.size:,}; min={values.min():.6f}, max={values.max():.6f}, "
        f"mean={np.mean(values, dtype=np.float64):.6f}, median={median:.6f}, "
        f"p05={p05:.6f}, p95={p95:.6f}{suffix}"
    )


def report(
    scene: Scene,
    ndvi: np.ndarray,
    ndvi_valid: np.ndarray,
    ndmi: np.ndarray,
    ndmi_valid: np.ndarray,
) -> None:
    clear_sky, clear_land = masks(scene)
    shape = scene.fmask.shape
    print(f"Scene: {scene.prefix}")
    print(f"Grid: {shape}; CRS: {scene.crs}; resolution (m): {scene.resolution}")
    print(f"Bounds (left, bottom, right, top; m): {scene.bounds}")
    print(
        f"Sensing time: {scene.metadata.get('SENSING_TIME', 'unknown')}; "
        f"metadata cloud coverage: {scene.metadata.get('cloud_coverage', 'unknown')}%; "
        f"spatial coverage: {scene.metadata.get('spatial_coverage', 'unknown')}%"
    )
    for name in REFLECTANCE_LAYERS:
        layer = scene.layers[name]
        summary_stats(f"{name} {layer.description} reflectance", layer.values[layer.valid])
    b10 = scene.layers["B10"]
    summary_stats("B10 TOA brightness temperature (all valid)", b10.values[b10.valid], "°C")
    summary_stats(
        "B10 TOA brightness temperature (clear sky)",
        b10.values[b10.valid & clear_sky],
        "°C",
    )

    print(f"Fmask valid pixels: {scene.fmask_valid.sum():,}/{scene.fmask.size:,}")
    for label, bit in FMASK_BITS.items():
        count = np.count_nonzero(scene.fmask_valid & ((scene.fmask & (1 << bit)) != 0))
        print(f"  raw flag {label}: {count:,}")
    aerosol = (scene.fmask >> 6) & 0b11
    for value, label in enumerate(("climatology", "low", "average", "high")):
        print(f"  aerosol {label}: {np.count_nonzero(scene.fmask_valid & (aerosol == value)):,}")
    print("Exclusive Fmask categories (cloud/cirrus has highest priority):")
    for index, label in enumerate(CATEGORY_LABELS):
        print(f"  {label}: {np.count_nonzero(scene.categories == index):,}")
    print(f"Clear sky including water: {clear_sky.sum():,}; clear land: {clear_land.sum():,}")
    summary_stats("NDVI (clear land)", ndvi[ndvi_valid])
    summary_stats("NDMI (clear land)", ndmi[ndmi_valid])


def stretch_rgb(
    channels: tuple[np.ndarray, np.ndarray, np.ndarray],
    valid: np.ndarray,
    stride: int,
) -> np.ndarray:
    rgb = np.empty((*channels[0][::stride, ::stride].shape, 3), dtype=np.float32)
    for index, channel in enumerate(channels):
        low, high = np.percentile(channel[valid], [2, 98])
        if high <= low:
            high = low + 1e-6
        sampled = channel[::stride, ::stride]
        rgb[..., index] = np.clip((sampled - low) / (high - low), 0, 1)
    rgb[~valid[::stride, ::stride]] = 0.9
    return rgb


def configure_map(axis: plt.Axes, title: str, extent: np.ndarray) -> None:
    axis.set(
        title=title,
        xlabel="Easting (km)",
        ylabel="Northing (km)",
        xlim=(extent[0], extent[1]),
        ylim=(extent[2], extent[3]),
        aspect="equal",
    )
    axis.ticklabel_format(style="plain", useOffset=False)


def render(
    scene: Scene,
    ndvi: np.ndarray,
    ndvi_valid: np.ndarray,
    ndmi: np.ndarray,
    ndmi_valid: np.ndarray,
    stride: int,
    output: Path,
) -> None:
    if min(scene.fmask.shape[0] // stride, scene.fmask.shape[1] // stride) < 2:
        raise ValueError("stride leaves fewer than two rows or columns for rendering")
    layers = scene.layers
    clear_sky, clear_land = masks(scene)
    rgb_valid = layers["B04"].valid & layers["B03"].valid & layers["B02"].valid
    swir_valid = (
        clear_sky & layers["B06"].valid & layers["B05"].valid & layers["B04"].valid
    )
    true_color = stretch_rgb(
        (layers["B04"].values, layers["B03"].values, layers["B02"].values),
        rgb_valid,
        stride,
    )
    swir_color = stretch_rgb(
        (layers["B06"].values, layers["B05"].values, layers["B04"].values),
        swir_valid,
        stride,
    )

    left, bottom, right, top = scene.bounds
    extent = np.array([left, right, bottom, top], dtype=np.float64) / 1000
    figure, axes = plt.subplots(2, 3, figsize=(18, 11.5), layout="constrained")

    axes[0, 0].imshow(true_color, extent=extent, origin="upper", interpolation="nearest")
    configure_map(axes[0, 0], "True color B04/B03/B02\nClouds retained", extent)
    axes[0, 1].imshow(swir_color, extent=extent, origin="upper", interpolation="nearest")
    configure_map(
        axes[0, 1],
        f"Clear-sky SWIR composite B06/B05/B04\n{swir_valid.sum():,} pixels; gray = masked",
        extent,
    )

    ndvi_cmap = plt.get_cmap("RdYlGn").copy()
    ndvi_cmap.set_bad(MISSING_COLOR)
    ndvi_image = axes[0, 2].imshow(
        np.ma.array(ndvi[::stride, ::stride], mask=~ndvi_valid[::stride, ::stride]),
        extent=extent,
        origin="upper",
        interpolation="nearest",
        aspect="equal",
        cmap=ndvi_cmap,
        vmin=-1,
        vmax=1,
    )
    configure_map(axes[0, 2], f"NDVI — clear land only\n{ndvi_valid.sum():,} pixels", extent)
    figure.colorbar(ndvi_image, ax=axes[0, 2], label="NDVI", shrink=0.85, pad=0.02)

    ndmi_cmap = plt.get_cmap("BrBG").copy()
    ndmi_cmap.set_bad(MISSING_COLOR)
    ndmi_image = axes[1, 0].imshow(
        np.ma.array(ndmi[::stride, ::stride], mask=~ndmi_valid[::stride, ::stride]),
        extent=extent,
        origin="upper",
        interpolation="nearest",
        aspect="equal",
        cmap=ndmi_cmap,
        vmin=-1,
        vmax=1,
    )
    configure_map(axes[1, 0], f"NDMI — clear land only\n{ndmi_valid.sum():,} pixels", extent)
    figure.colorbar(ndmi_image, ax=axes[1, 0], label="NDMI", shrink=0.85, pad=0.02)

    b10 = layers["B10"]
    temperature_valid = clear_sky & b10.valid
    temperature_values = b10.values[temperature_valid]
    temp_low, temp_high = np.percentile(temperature_values, [2, 98])
    temperature_cmap = plt.get_cmap("inferno").copy()
    temperature_cmap.set_bad(MISSING_COLOR)
    temperature_image = axes[1, 1].imshow(
        np.ma.array(
            b10.values[::stride, ::stride],
            mask=~temperature_valid[::stride, ::stride],
        ),
        extent=extent,
        origin="upper",
        interpolation="nearest",
        aspect="equal",
        cmap=temperature_cmap,
        vmin=temp_low,
        vmax=temp_high,
    )
    configure_map(
        axes[1, 1],
        f"B10 clear-sky TOA brightness temperature\n{temperature_valid.sum():,} pixels; not land-surface temperature",
        extent,
    )
    figure.colorbar(
        temperature_image,
        ax=axes[1, 1],
        label="TOA brightness temperature (°C)",
        extend="both",
        shrink=0.85,
        pad=0.02,
    )

    category_cmap = ListedColormap(CATEGORY_COLORS)
    axes[1, 2].imshow(
        scene.categories[::stride, ::stride],
        extent=extent,
        origin="upper",
        interpolation="nearest",
        aspect="equal",
        cmap=category_cmap,
        norm=BoundaryNorm(np.arange(-0.5, 7.5, 1), 7),
    )
    configure_map(axes[1, 2], "Fmask exclusive quality categories", extent)
    axes[1, 2].legend(
        handles=[
            Patch(facecolor=color, label=label)
            for color, label in zip(CATEGORY_COLORS, CATEGORY_LABELS, strict=True)
        ],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.16),
        ncol=3,
        frameon=False,
        fontsize=8.5,
    )

    sensing_time = scene.metadata.get("SENSING_TIME", "unknown")
    try:
        sensing_label = datetime.fromisoformat(sensing_time.replace("Z", "+00:00")).strftime(
            "%Y-%m-%d %H:%M:%S UTC"
        )
    except ValueError:
        sensing_label = sensing_time
    tile = scene.metadata.get("SENTINEL2_TILEID", "unknown")
    cloud = scene.metadata.get("cloud_coverage", "unknown")
    figure.suptitle(
        f"HLSL30 Landsat scene overview — tile {tile}\n"
        f"{sensing_label}; metadata cloud coverage {cloud}%",
        fontsize=16,
    )
    figure.supxlabel(
        f"Native {scene.crs}; {scene.resolution[0]:g} m pixels. Map stride {stride}; "
        "full-resolution statistics. No interpolation. Aerosol bits are reported but not masked.",
        fontsize=10,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=180, facecolor="white")
    plt.close(figure)
    print(f"Saved: {output.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "raw",
        help="Directory containing one HLSL30 scene",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output PNG (default: <scene>_overview.png beside this script)",
    )
    parser.add_argument(
        "--stride",
        type=positive_int,
        default=2,
        help="Map sampling stride (default: 2); statistics use all pixels",
    )
    args = parser.parse_args()

    try:
        scene = read_scene(args.input_dir)
        output = args.output or Path(__file__).resolve().parent / f"{scene.prefix}_overview.png"
        if output.suffix.lower() != ".png":
            raise ValueError("Output must use a .png extension")
        _, clear_land = masks(scene)
        ndvi, ndvi_valid = compute_index(
            scene.layers["B05"], scene.layers["B04"], clear_land
        )
        ndmi, ndmi_valid = compute_index(
            scene.layers["B05"], scene.layers["B06"], clear_land
        )
        report(scene, ndvi, ndvi_valid, ndmi, ndmi_valid)
        render(scene, ndvi, ndvi_valid, ndmi, ndmi_valid, args.stride, output)
    except (ValueError, OSError, rasterio.errors.RasterioError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
