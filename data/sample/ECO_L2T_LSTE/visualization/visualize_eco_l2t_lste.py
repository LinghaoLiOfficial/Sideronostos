#!/usr/bin/env python3
"""Visualize one ECOSTRESS L2T LSTE scene on its native GeoTIFF grid."""

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


LAYERS = ("LST", "LST_err", "QC", "cloud", "water")
FILE_PATTERN = re.compile(r"^(ECO.+_L2T_LSTE_.+)_(LST_err|LST|QC|cloud|water)\.tif$")
MISSING_COLOR = "#e5e7eb"


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
    if not input_dir.is_dir():
        raise ValueError(f"Input directory does not exist: {input_dir}")
    groups: dict[str, dict[str, Path]] = {}
    for path in sorted(input_dir.glob("*.tif")):
        match = FILE_PATTERN.fullmatch(path.name)
        if match:
            prefix, name = match.groups()
            groups.setdefault(prefix, {})[name] = path
    if len(groups) != 1:
        raise ValueError(f"Expected exactly one scene group, found {len(groups)}: "
                         + ", ".join(groups))
    prefix, paths = next(iter(groups.items()))
    missing = set(LAYERS) - paths.keys()
    if missing:
        raise ValueError(f"Missing layers for {prefix}: {', '.join(sorted(missing))}")
    return prefix, paths


def read_scene(input_dir: Path) -> Scene:
    prefix, paths = find_scene(input_dir)
    layers = {}
    reference = None
    for name in LAYERS:
        with rasterio.open(paths[name]) as src:
            if src.count != 1 or src.crs is None:
                raise ValueError(f"{name}: expected a single-band raster with a CRS")
            if not src.crs.is_projected or src.crs.linear_units != "metre":
                raise ValueError(f"{name}: expected a projected CRS with metre units")
            transform = src.transform
            if transform.b != 0 or transform.d != 0 or transform.a <= 0 or transform.e >= 0:
                raise ValueError(f"{name}: expected an unrotated, north-up raster")
            signature = (src.shape, src.crs, transform)
            if reference is None:
                reference = signature
                bounds = tuple(src.bounds)
                resolution = tuple(src.res)
                crs = src.crs.to_string()
            elif signature != reference:
                raise ValueError(f"{name}: shape, CRS or affine transform differs from LST")
            if name in ("LST", "LST_err"):
                unit = src.tags().get("units") or src.units[0]
                if unit not in ("K", "Kelvin", "kelvin"):
                    raise ValueError(f"{name}: expected Kelvin units, found {unit!r}")
            if src.scales != (1.0,) or src.offsets != (0.0,):
                raise ValueError(f"{name}: unexpected scale/offset; physical values required")
            values = src.read(1)
            valid = (src.read_masks(1) > 0) & np.isfinite(values)
            if src.nodata is not None:
                valid &= values != src.nodata
            # Scalar valid_range tags in these TIFFs are not usable physical bounds.
            layers[name] = Layer(values, valid)
    for name in ("LST", "LST_err"):
        if not layers[name].valid.any():
            raise ValueError(f"{name}: no valid pixels")
    return Scene(prefix, layers, crs, bounds, resolution)


def clear_mask(scene: Scene) -> np.ndarray:
    layers = scene.layers
    return layers["LST"].valid & layers["cloud"].valid & (layers["cloud"].values == 0)


def summary_stats(label: str, values: np.ndarray, unit: str) -> None:
    if not values.size:
        print(f"{label}: no valid pixels")
        return
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    print(f"{label}: n={values.size:,}; min={values.min():.6f}, "
          f"max={values.max():.6f}, mean={np.mean(values, dtype=np.float64):.6f}, "
          f"median={median:.6f}, p05={p05:.6f}, p95={p95:.6f} {unit}")


def report(scene: Scene) -> None:
    layers = scene.layers
    print(f"Scene: {scene.prefix}")
    print(f"Grid: {layers['LST'].values.shape}; CRS: {scene.crs}")
    print(f"Resolution (m): {scene.resolution}; bounds (left, bottom, right, top; m): {scene.bounds}")
    for name, layer in layers.items():
        count = int(layer.valid.sum())
        print(f"{name}: valid={count:,}/{layer.values.size:,} ({count/layer.values.size:.6%}); "
              f"invalid={layer.values.size-count:,}")
    clear = clear_mask(scene)
    print(f"Clear-sky valid LST (cloud == 0): {clear.sum():,}")
    for name in ("cloud", "water"):
        layer = layers[name]
        values, counts = np.unique(layer.values, return_counts=True)
        print(f"{name} raw value counts: " + ", ".join(
            f"{value}: {count:,}" for value, count in zip(values, counts, strict=True)))
        unexpected = layer.valid & ~np.isin(layer.values, [0, 1])
        print(f"{name}: unexpected valid category pixels={unexpected.sum():,}")
    temperature = layers["LST"].values.astype(np.float64) - 273.15
    summary_stats("Raw-valid LST", temperature[layers["LST"].valid], "°C")
    summary_stats("Clear-sky LST", temperature[clear], "°C")
    error = layers["LST_err"]
    summary_stats("LST uncertainty", error.values[error.valid], "K")
    qc = layers["QC"]
    values, counts = np.unique(qc.values[qc.valid], return_counts=True)
    order = np.argsort(-counts, kind="stable")[:15]
    print("QC top raw values (no bit interpretation or QC filtering):")
    for index in order:
        print(f"  {values[index]}: {counts[index]:,}")


def render(scene: Scene, output: Path) -> None:
    layers = scene.layers
    lst = layers["LST"]
    temperature = lst.values.astype(np.float64) - 273.15
    clear = clear_mask(scene)
    raw_values = temperature[lst.valid]
    low, high = np.percentile(raw_values, [1, 99])
    if low == high:
        low, high = low - 0.5, high + 0.5
    left, bottom, right, top = scene.bounds
    extent = np.array([left, right, bottom, top]) / 1000
    fig, axes = plt.subplots(2, 3, figsize=(17, 11.5), layout="constrained")

    def map_image(axis, values, valid, title, **kwargs):
        result = axis.imshow(np.ma.array(values, mask=~valid), extent=extent,
                             origin="upper", interpolation="nearest", aspect="equal", **kwargs)
        axis.set(title=title, xlabel="Easting (km)", ylabel="Northing (km)")
        axis.ticklabel_format(style="plain", useOffset=False)
        return result

    temperature_cmap = plt.get_cmap("inferno").copy()
    temperature_cmap.set_bad(MISSING_COLOR)
    for axis, valid, title in zip(axes[0, :2], (lst.valid, clear),
                                  ("Raw-valid land surface temperature", "Clear-sky temperature (cloud = 0)"),
                                  strict=True):
        image = map_image(axis, temperature, valid,
                          f"{title}\n{valid.sum():,} pixels", cmap=temperature_cmap,
                          vmin=low, vmax=high)
    fig.colorbar(image, ax=list(axes[0, :2]), label="Land surface temperature (°C)",
                 extend="both", shrink=0.85, pad=0.025)

    error = layers["LST_err"]
    error_cmap = plt.get_cmap("viridis").copy()
    error_cmap.set_bad(MISSING_COLOR)
    image = map_image(axes[0, 2], error.values, error.valid,
                      "LST uncertainty\nKelvin difference; no temperature offset", cmap=error_cmap)
    fig.colorbar(image, ax=axes[0, 2], label="LST uncertainty (K)", shrink=0.85, pad=0.025)

    for axis, name, labels, colors in (
        (axes[1, 0], "cloud", ("Clear (0)", "Cloud (1)", "NoData / unknown"),
         ("#93c5fd", "#6b7280", MISSING_COLOR)),
        (axes[1, 1], "water", ("Land (0)", "Water (1)", "NoData / unknown"),
         ("#d6c6a5", "#2563eb", MISSING_COLOR)),
    ):
        layer = layers[name]
        categories = np.full(layer.values.shape, 2, dtype=np.uint8)
        for value in (0, 1):
            categories[layer.valid & (layer.values == value)] = value
        title = "Cloud mask (255 = NoData)" if name == "cloud" else "Water mask (water retained in LST)"
        cmap = ListedColormap(colors)
        map_image(axis, categories, np.ones(categories.shape, dtype=bool), title,
                  cmap=cmap, norm=BoundaryNorm([-0.5, 0.5, 1.5, 2.5], 3))
        axis.legend(handles=[Patch(facecolor=color, label=label)
                             for color, label in zip(colors, labels, strict=True)],
                    loc="upper center", bbox_to_anchor=(0.5, -0.17), ncol=2,
                    frameon=False, fontsize=9)

    bins = np.histogram_bin_edges(raw_values, bins=80)
    histogram = axes[1, 2]
    for label, values, color, linestyle in (
        ("Raw valid", raw_values, "#c2410c", "-"),
        ("Clear sky", temperature[clear], "#0369a1", "--"),
    ):
        counts, edges = np.histogram(values, bins=bins)
        if int(counts.sum()) != values.size:
            raise ValueError(f"Histogram did not include every {label} pixel")
        histogram.stairs(counts, edges, label=f"{label} (n={values.size:,})",
                         color=color, linestyle=linestyle, linewidth=1.7)
        print(f"Histogram {label}: {counts.sum():,} pixels (all valid values included)")
    histogram.set(title="Full-resolution temperature distributions",
                  xlabel="Land surface temperature (°C)", ylabel="Pixels per bin")
    histogram.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))
    histogram.grid(axis="y", alpha=0.2)
    histogram.legend(frameon=False, fontsize=9)
    histogram.text(0.03, 0.97, "Curves nearly overlap.\nOnly "
                   f"{int(lst.valid.sum()-clear.sum()):,} pixels differ.",
                   transform=histogram.transAxes, va="top", fontsize=9)

    identity = re.search(r"_(\d{2}[A-Z]{3})_(\d{8}T\d{6})_", scene.prefix)
    if identity:
        tile, timestamp = identity.groups()
        readable = datetime.strptime(timestamp, "%Y%m%dT%H%M%S").strftime("%Y-%m-%d %H:%M:%S")
        subtitle = f"Tile {tile} | Filename time: {timestamp} ({readable})"
    else:
        subtitle = f"Filename scene identifier: {scene.prefix}"
    fig.suptitle(f"ECOSTRESS ECO_L2T_LSTE — single-scene overview\n{subtitle}", fontsize=16)
    fig.supxlabel(f"Native {scene.crs}; {scene.resolution[0]:g} m pixels. Gray: NoData. "
                  "Temperature color limits: raw-valid 1st–99th percentiles.\n"
                  "Full-resolution statistics; no interpolation or QC bit filtering; water retained.",
                  fontsize=10)
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=180, facecolor="white")
    plt.close(fig)
    print(f"Saved: {output.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path,
                        default=Path(__file__).resolve().parent.parent / "raw",
                        help="Directory containing exactly one set of five GeoTIFF layers")
    parser.add_argument("--output", type=Path,
                        help="Output PNG (default: <scene>_overview.png beside this script)")
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
