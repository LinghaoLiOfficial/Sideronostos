#!/usr/bin/env python3
"""Visualize one ECOSTRESS ECO_L3T_JET scene on its native UTM grid."""

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


LAYER_NAMES = ("ETdaily", "ETuncertainty", "cloud", "water")
FILE_PATTERN = re.compile(
    r"^(ECO.+_L3T_JET_.+)_(ETdaily|ETuncertainty|cloud|water)\.tif$"
)
MISSING_COLOR = "#e5e7eb"
ET_UNIT = "mm day⁻¹"


@dataclass
class Layer:
    values: np.ndarray
    valid: np.ndarray


@dataclass
class Scene:
    prefix: str
    layers: dict[str, Layer]
    crs: str
    bounds: tuple[float, float, float, float]
    resolution: tuple[float, float]


def find_scene(input_dir: Path) -> tuple[str, dict[str, Path]]:
    """Return the only complete ECO_L3T_JET scene in input_dir."""
    if not input_dir.is_dir():
        raise ValueError(f"Input directory does not exist: {input_dir}")

    groups: dict[str, dict[str, Path]] = {}
    for path in sorted(input_dir.glob("*.tif")):
        match = FILE_PATTERN.fullmatch(path.name)
        if match:
            prefix, layer_name = match.groups()
            groups.setdefault(prefix, {})[layer_name] = path

    if len(groups) != 1:
        names = ", ".join(groups) or "none"
        raise ValueError(f"Expected exactly one scene group, found {len(groups)}: {names}")

    prefix, paths = next(iter(groups.items()))
    missing = set(LAYER_NAMES) - paths.keys()
    if missing:
        raise ValueError(f"Missing layers for {prefix}: {', '.join(sorted(missing))}")
    return prefix, paths


def read_scene(input_dir: Path) -> Scene:
    prefix, paths = find_scene(input_dir)
    layers: dict[str, Layer] = {}
    reference = None

    for name in LAYER_NAMES:
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
                raise ValueError(f"{name}: shape, CRS or affine transform differs from ETdaily")

            if source.scales != (1.0,) or source.offsets != (0.0,):
                raise ValueError(f"{name}: unexpected scale/offset; physical values required")

            values = source.read(1)
            valid = (source.read_masks(1) > 0) & np.isfinite(values)
            if source.nodata is not None:
                valid &= values != source.nodata
            layers[name] = Layer(values, valid)

    for name in ("ETdaily", "ETuncertainty"):
        if not layers[name].valid.any():
            raise ValueError(f"{name}: no valid pixels")

    return Scene(prefix, layers, crs, bounds, resolution)


def category_mask(layer: Layer, value: int) -> np.ndarray:
    return layer.valid & (layer.values == value)


def masks(scene: Scene) -> dict[str, np.ndarray]:
    layers = scene.layers
    et_valid = layers["ETdaily"].valid
    land = et_valid & category_mask(layers["water"], 0)
    water = et_valid & category_mask(layers["water"], 1)
    return {"all": et_valid, "land": land, "water": water}


def summary_stats(label: str, values: np.ndarray) -> None:
    if not values.size:
        print(f"{label}: no valid pixels")
        return
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    print(
        f"{label}: n={values.size:,}; min={values.min():.6f}, "
        f"max={values.max():.6f}, mean={np.mean(values, dtype=np.float64):.6f}, "
        f"median={median:.6f}, p05={p05:.6f}, p95={p95:.6f} {ET_UNIT}"
    )


def report(scene: Scene) -> None:
    layers = scene.layers
    selection = masks(scene)
    print(f"Scene: {scene.prefix}")
    print(f"Grid: {layers['ETdaily'].values.shape}; CRS: {scene.crs}")
    print(
        f"Resolution (m): {scene.resolution}; "
        f"bounds (left, bottom, right, top; m): {scene.bounds}"
    )

    for name, layer in layers.items():
        count = int(layer.valid.sum())
        print(
            f"{name}: valid={count:,}/{layer.values.size:,} "
            f"({count / layer.values.size:.6%}); invalid={layer.values.size - count:,}"
        )

    for name in ("cloud", "water"):
        layer = layers[name]
        values, counts = np.unique(layer.values, return_counts=True)
        print(
            f"{name} raw value counts: "
            + ", ".join(
                f"{value}: {count:,}"
                for value, count in zip(values, counts, strict=True)
            )
        )
        unexpected = layer.valid & ~np.isin(layer.values, [0, 1])
        print(f"{name}: unexpected valid category pixels={unexpected.sum():,}")

    et = layers["ETdaily"].values
    summary_stats("All valid ETdaily", et[selection["all"]])
    summary_stats("Land ETdaily (water == 0)", et[selection["land"]])
    summary_stats("Water ETdaily (water == 1)", et[selection["water"]])
    uncertainty = layers["ETuncertainty"]
    summary_stats("ET uncertainty", uncertainty.values[uncertainty.valid])

    clear = category_mask(layers["cloud"], 0)
    print(
        "ETdaily validity vs cloud == 0 mismatch: "
        f"{np.count_nonzero(layers['ETdaily'].valid != clear):,} pixels"
    )
    print(
        "ET uncertainty validity vs clear land mismatch: "
        f"{np.count_nonzero(uncertainty.valid != (clear & category_mask(layers['water'], 0))):,} pixels"
    )


def add_map(axis, values: np.ndarray, valid: np.ndarray, extent: np.ndarray,
            title: str, **kwargs):
    image = axis.imshow(
        np.ma.array(values, mask=~valid),
        extent=extent,
        origin="upper",
        interpolation="nearest",
        aspect="equal",
        **kwargs,
    )
    axis.set(title=title, xlabel="Easting (km)", ylabel="Northing (km)")
    axis.ticklabel_format(style="plain", useOffset=False)
    return image


def render(scene: Scene, output: Path) -> None:
    layers = scene.layers
    selection = masks(scene)
    et = layers["ETdaily"].values
    all_et = et[selection["all"]]
    et_low, et_high = np.percentile(all_et, [1, 99])
    if et_low == et_high:
        et_low, et_high = et_low - 0.5, et_high + 0.5

    uncertainty = layers["ETuncertainty"]
    uncertainty_values = uncertainty.values[uncertainty.valid]
    unc_low, unc_high = np.percentile(uncertainty_values, [1, 99])
    if unc_low == unc_high:
        unc_low, unc_high = unc_low - 0.5, unc_high + 0.5

    left, bottom, right, top = scene.bounds
    extent = np.array([left, right, bottom, top]) / 1000
    figure, axes = plt.subplots(2, 3, figsize=(18, 11.5), layout="constrained")

    et_cmap = plt.get_cmap("YlGnBu").copy()
    et_cmap.set_bad(MISSING_COLOR)
    for axis, valid, title in zip(
        axes[0, :2],
        (selection["all"], selection["land"]),
        (
            "All valid daily evapotranspiration",
            "Land-only daily evapotranspiration (water = 0)",
        ),
        strict=True,
    ):
        et_image = add_map(
            axis,
            et,
            valid,
            extent,
            f"{title}\n{valid.sum():,} pixels",
            cmap=et_cmap,
            vmin=et_low,
            vmax=et_high,
        )
    figure.colorbar(
        et_image,
        ax=list(axes[0, :2]),
        label=f"Daily evapotranspiration ({ET_UNIT})",
        extend="both",
        shrink=0.85,
        pad=0.025,
    )

    uncertainty_cmap = plt.get_cmap("magma").copy()
    uncertainty_cmap.set_bad(MISSING_COLOR)
    uncertainty_image = add_map(
        axes[0, 2],
        uncertainty.values,
        uncertainty.valid,
        extent,
        f"Daily ET uncertainty\n{uncertainty.valid.sum():,} clear-land pixels",
        cmap=uncertainty_cmap,
        vmin=unc_low,
        vmax=unc_high,
    )
    figure.colorbar(
        uncertainty_image,
        ax=axes[0, 2],
        label=f"Daily ET uncertainty ({ET_UNIT})",
        extend="both",
        shrink=0.85,
        pad=0.025,
    )

    category_specs = (
        (
            axes[1, 0],
            "cloud",
            "Cloud mask",
            ("Clear (0)", "Cloud (1)", "NoData / unknown"),
            ("#93c5fd", "#6b7280", MISSING_COLOR),
        ),
        (
            axes[1, 1],
            "water",
            "Water mask",
            ("Land (0)", "Water (1)", "NoData / unknown"),
            ("#d6c6a5", "#2563eb", MISSING_COLOR),
        ),
    )
    for axis, name, title, labels, colors in category_specs:
        layer = layers[name]
        categories = np.full(layer.values.shape, 2, dtype=np.uint8)
        for value in (0, 1):
            categories[category_mask(layer, value)] = value
        cmap = ListedColormap(colors)
        add_map(
            axis,
            categories,
            np.ones(categories.shape, dtype=bool),
            extent,
            title,
            cmap=cmap,
            norm=BoundaryNorm([-0.5, 0.5, 1.5, 2.5], 3),
        )
        axis.legend(
            handles=[
                Patch(facecolor=color, label=label)
                for color, label in zip(colors, labels, strict=True)
            ],
            loc="upper center",
            bbox_to_anchor=(0.5, -0.17),
            ncol=2,
            frameon=False,
            fontsize=9,
        )

    distributions = (
        ("All valid ET", all_et, "#0072b2", "-"),
        ("Land ET", et[selection["land"]], "#009e73", "-"),
        ("Water ET", et[selection["water"]], "#d55e00", "-"),
        ("ET uncertainty", uncertainty_values, "#7b3294", "--"),
    )
    histogram = axes[1, 2]
    minimum = min(float(values.min()) for _, values, _, _ in distributions)
    maximum = max(float(values.max()) for _, values, _, _ in distributions)
    bins = np.linspace(minimum, maximum, 81)
    for label, values, color, linestyle in distributions:
        counts, edges = np.histogram(values, bins=bins)
        if int(counts.sum()) != values.size:
            raise ValueError(f"Histogram did not include every {label} pixel")
        histogram.stairs(
            counts / values.size * 100,
            edges,
            label=f"{label} (n={values.size:,})",
            color=color,
            linestyle=linestyle,
            linewidth=1.6,
        )
        print(f"Histogram {label}: {counts.sum():,} pixels (all valid values included)")
    histogram.set(
        title="Full-resolution normalized distributions",
        xlabel=f"Daily evapotranspiration or uncertainty ({ET_UNIT})",
        ylabel="Pixels per bin (%)",
        xlim=(minimum, maximum),
    )
    histogram.grid(axis="y", alpha=0.25)
    histogram.legend(frameon=False, fontsize=8.5)

    identity = re.search(r"_(\d{2}[A-Z]{3})_(\d{8}T\d{6})_", scene.prefix)
    if identity:
        tile, timestamp = identity.groups()
        readable = datetime.strptime(timestamp, "%Y%m%dT%H%M%S").strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        subtitle = f"Tile {tile} | Filename time: {timestamp} ({readable})"
    else:
        subtitle = f"Filename scene identifier: {scene.prefix}"

    figure.suptitle(
        f"ECOSTRESS ECO_L3T_JET — single-scene overview\n{subtitle}", fontsize=16
    )
    figure.supxlabel(
        f"Native {scene.crs}; {scene.resolution[0]:g} m pixels. Gray: NoData. "
        "ET map limits: all-valid 1st–99th percentiles.\n"
        "Full-resolution statistics; no reprojection or interpolation. "
        "ETdaily is integrated between sunrise and sunset.",
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
        help="Directory containing exactly one set of four ECO_L3T_JET GeoTIFF layers",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output PNG (default: <scene>_overview.png beside this script)",
    )
    args = parser.parse_args()

    try:
        scene = read_scene(args.input_dir)
        output = args.output or Path(__file__).resolve().parent / f"{scene.prefix}_overview.png"
        if output.suffix.lower() != ".png":
            raise ValueError("Output must use a .png extension")
        report(scene)
        render(scene, output)
    except (ValueError, OSError, rasterio.errors.RasterioError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
