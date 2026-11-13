#!/usr/bin/env python3
"""Create an RGB, NDVI, and Fmask overview for one HLS S30 granule."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
import rasterio
from affine import Affine
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Patch
from rasterio.enums import Resampling

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


REQUIRED_LAYERS = ("B02", "B03", "B04", "B8A", "Fmask")
REFLECTANCE_LAYERS = ("B02", "B03", "B04", "B8A")
QUALITY_BITS = {
    "Cirrus": 0,
    "Cloud": 1,
    "Adjacent cloud": 2,
    "Cloud shadow": 3,
    "Snow/ice": 4,
    "Water": 5,
}


@dataclass(frozen=True)
class GridSpec:
    width: int
    height: int
    crs: rasterio.crs.CRS
    transform: Affine
    bounds: rasterio.coords.BoundingBox


@dataclass(frozen=True)
class PlotData:
    arrays: dict[str, np.ma.MaskedArray]
    fmask: np.ma.MaskedArray
    transform: Affine
    width: int
    height: int


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be at least 1")
    return parsed


def discover_layers(input_dir: Path) -> tuple[str, dict[str, Path]]:
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")

    files: dict[str, Path] = {}
    prefixes: set[str] = set()
    for layer in REQUIRED_LAYERS:
        matches = sorted(input_dir.glob(f"*.{layer}.tif"))
        if not matches:
            raise FileNotFoundError(f"Missing required {layer} GeoTIFF in {input_dir}")
        if len(matches) > 1:
            names = ", ".join(path.name for path in matches)
            raise ValueError(f"Multiple {layer} files found; expected one granule: {names}")
        path = matches[0]
        prefixes.add(path.name[: -len(f".{layer}.tif")])
        files[layer] = path

    if len(prefixes) != 1:
        raise ValueError(
            "Required layers do not belong to the same product: "
            + ", ".join(sorted(prefixes))
        )
    return prefixes.pop(), files


def get_grid(path: Path) -> GridSpec:
    with rasterio.open(path) as dataset:
        if dataset.count != 1:
            raise ValueError(f"Expected one band in {path}, found {dataset.count}")
        if dataset.crs is None:
            raise ValueError(f"Missing CRS in {path}")
        return GridSpec(
            width=dataset.width,
            height=dataset.height,
            crs=dataset.crs,
            transform=dataset.transform,
            bounds=dataset.bounds,
        )


def validate_grids(files: dict[str, Path]) -> GridSpec:
    reference = get_grid(files["B02"])
    for layer, path in files.items():
        grid = get_grid(path)
        if (
            grid.width != reference.width
            or grid.height != reference.height
            or grid.crs != reference.crs
            or not grid.transform.almost_equals(reference.transform)
            or not np.allclose(tuple(grid.bounds), tuple(reference.bounds))
        ):
            raise ValueError(f"Grid mismatch for {layer}: {path}")
    return reference


def output_shape(grid: GridSpec, max_size: int) -> tuple[int, int]:
    scale = min(1.0, max_size / max(grid.width, grid.height))
    return max(1, round(grid.height * scale)), max(1, round(grid.width * scale))


def scaled_transform(
    source_transform: Affine,
    source_width: int,
    source_height: int,
    output_width: int,
    output_height: int,
) -> Affine:
    return source_transform * Affine.scale(
        source_width / output_width,
        source_height / output_height,
    )


def reflectance_scale(dataset: rasterio.io.DatasetReader) -> float:
    if dataset.scales and dataset.scales[0] not in (None, 1.0):
        return float(dataset.scales[0])
    return float(dataset.tags().get("scale_factor", 0.0001))


def read_reflectance(
    path: Path,
    *,
    out_height: int | None = None,
    out_width: int | None = None,
) -> np.ma.MaskedArray:
    with rasterio.open(path) as dataset:
        kwargs: dict[str, object] = {"masked": True}
        if out_height is not None and out_width is not None:
            kwargs.update(
                out_shape=(out_height, out_width),
                resampling=Resampling.bilinear,
            )
        values = dataset.read(1, **kwargs).astype(np.float32)
        values *= reflectance_scale(dataset)
        return np.ma.masked_invalid(values)


def read_fmask(
    path: Path,
    *,
    out_height: int | None = None,
    out_width: int | None = None,
) -> np.ma.MaskedArray:
    with rasterio.open(path) as dataset:
        kwargs: dict[str, object] = {"masked": True}
        if out_height is not None and out_width is not None:
            kwargs.update(
                out_shape=(out_height, out_width),
                resampling=Resampling.nearest,
            )
        return dataset.read(1, **kwargs)


def read_plot_data(files: dict[str, Path], grid: GridSpec, max_size: int) -> PlotData:
    out_height, out_width = output_shape(grid, max_size)
    arrays = {
        layer: read_reflectance(
            files[layer], out_height=out_height, out_width=out_width
        )
        for layer in REFLECTANCE_LAYERS
    }
    fmask = read_fmask(files["Fmask"], out_height=out_height, out_width=out_width)
    transform = scaled_transform(
        grid.transform,
        grid.width,
        grid.height,
        out_width,
        out_height,
    )
    return PlotData(
        arrays=arrays,
        fmask=fmask,
        transform=transform,
        width=out_width,
        height=out_height,
    )


def stretch_rgb(channels: list[np.ma.MaskedArray]) -> np.ndarray:
    rgb = np.ma.stack(channels, axis=-1)
    common_mask = np.any(np.ma.getmaskarray(rgb), axis=-1)
    output = np.full(rgb.shape, 0.92, dtype=np.float32)

    for index in range(3):
        channel = np.ma.array(rgb[..., index], mask=common_mask)
        valid = channel.compressed()
        if valid.size == 0:
            raise ValueError("RGB composite contains no valid pixels")
        low, high = np.percentile(valid, [2, 98])
        if not np.isfinite(low) or not np.isfinite(high) or high <= low:
            raise ValueError("Cannot calculate a valid RGB contrast stretch")
        stretched = np.clip((channel.filled(low) - low) / (high - low), 0, 1)
        output[..., index] = np.where(common_mask, 0.92, stretched)
    return output


def bit_is_set(values: np.ndarray, bit: int) -> np.ndarray:
    return (values & (1 << bit)) != 0


def clear_land_mask(fmask: np.ma.MaskedArray) -> np.ndarray:
    mask = np.ma.getmaskarray(fmask)
    values = fmask.filled(0).astype(np.uint8)
    excluded_bits = sum(1 << bit for bit in QUALITY_BITS.values())
    return ~mask & ((values & excluded_bits) == 0)


def calculate_ndvi(
    nir: np.ma.MaskedArray,
    red: np.ma.MaskedArray,
    clear_land: np.ndarray,
) -> np.ma.MaskedArray:
    nir_data = nir.filled(np.nan).astype(np.float32)
    red_data = red.filled(np.nan).astype(np.float32)
    denominator = nir_data + red_data
    valid = (
        clear_land
        & ~np.ma.getmaskarray(nir)
        & ~np.ma.getmaskarray(red)
        & np.isfinite(denominator)
        & (np.abs(denominator) > 1e-6)
    )
    result = np.full(nir.shape, np.nan, dtype=np.float32)
    np.divide(nir_data - red_data, denominator, out=result, where=valid)
    valid &= np.isfinite(result) & (result >= -1) & (result <= 1)
    return np.ma.array(result, mask=~valid)


def classify_fmask(fmask: np.ma.MaskedArray) -> np.ndarray:
    """Map overlapping flags to one display class using increasing risk priority."""
    nodata = np.ma.getmaskarray(fmask)
    values = fmask.filled(0).astype(np.uint8)
    classes = np.ones(values.shape, dtype=np.uint8)  # Clear
    priority = [
        ("Water", 2),
        ("Snow/ice", 3),
        ("Cloud shadow", 4),
        ("Adjacent cloud", 5),
        ("Cirrus", 6),
        ("Cloud", 7),
    ]
    for name, class_id in priority:
        classes[bit_is_set(values, QUALITY_BITS[name])] = class_id
    classes[nodata] = 0
    return classes


def quality_statistics(fmask: np.ma.MaskedArray) -> dict[str, int | float]:
    nodata = np.ma.getmaskarray(fmask)
    values = fmask.filled(0).astype(np.uint8)
    valid = ~nodata
    valid_count = int(np.count_nonzero(valid))
    if valid_count == 0:
        raise ValueError("Fmask contains no valid pixels")

    stats: dict[str, int | float] = {
        "total": int(values.size),
        "valid": valid_count,
        "coverage_percent": valid_count / values.size * 100.0,
    }
    for name, bit in QUALITY_BITS.items():
        stats[name] = int(np.count_nonzero(valid & bit_is_set(values, bit)))
    clear_land = clear_land_mask(fmask)
    stats["Clear land"] = int(np.count_nonzero(clear_land))
    return stats


def print_statistics(
    product_id: str,
    grid: GridSpec,
    tags: dict[str, str],
    quality: dict[str, int | float],
    ndvi: np.ma.MaskedArray,
) -> None:
    valid = int(quality["valid"])
    print(f"Product: {product_id}")
    print(f"Sensing time: {tags.get('SENSING_TIME', 'unknown')}")
    print(f"Grid: {grid.width} x {grid.height}, CRS={grid.crs}, pixel=30 m")
    print(
        f"Spatial coverage: {valid:,} / {int(quality['total']):,} "
        f"({float(quality['coverage_percent']):.2f}%)"
    )
    print("Fmask flags (categories can overlap):")
    for name in QUALITY_BITS:
        count = int(quality[name])
        print(f"  {name}: {count:,} ({count / valid * 100.0:.2f}%)")
    clear_count = int(quality["Clear land"])
    print(f"  Clear land: {clear_count:,} ({clear_count / valid * 100.0:.2f}%)")

    values = ndvi.compressed()
    if values.size == 0:
        raise ValueError("No clear-land NDVI pixels remain after quality filtering")
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    print(
        f"Clear-land NDVI: pixels={values.size:,}, mean={np.mean(values):.4f}, "
        f"median={median:.4f}, p05={p05:.4f}, p95={p95:.4f}"
    )


def plot_extent(transform: Affine, width: int, height: int) -> tuple[float, ...]:
    left = transform.c
    top = transform.f
    right = left + transform.a * width
    bottom = top + transform.e * height
    return left / 1000, right / 1000, bottom / 1000, top / 1000


def style_map_axis(axis: plt.Axes) -> None:
    axis.set_xlabel("Easting (km)")
    axis.set_ylabel("Northing (km)")
    axis.ticklabel_format(style="plain", useOffset=False)


def create_figure(
    product_id: str,
    grid: GridSpec,
    tags: dict[str, str],
    plot_data: PlotData,
    full_ndvi: np.ma.MaskedArray,
    output_path: Path,
) -> None:
    true_color = stretch_rgb(
        [plot_data.arrays["B04"], plot_data.arrays["B03"], plot_data.arrays["B02"]]
    )
    false_color = stretch_rgb(
        [plot_data.arrays["B8A"], plot_data.arrays["B04"], plot_data.arrays["B03"]]
    )
    fmask_classes = classify_fmask(plot_data.fmask)
    extent = plot_extent(
        plot_data.transform, plot_data.width, plot_data.height
    )

    figure, axes = plt.subplots(2, 2, figsize=(15, 12), constrained_layout=True)
    panels = [
        (axes[0, 0], true_color, "True color (B04 / B03 / B02)"),
        (axes[0, 1], false_color, "Vegetation false color (B8A / B04 / B03)"),
    ]
    for axis, image, title in panels:
        axis.imshow(image, extent=extent, origin="upper", interpolation="nearest")
        axis.set_title(title)
        style_map_axis(axis)

    ndvi_cmap = matplotlib.colormaps["RdYlGn"].copy()
    ndvi_cmap.set_bad("#ededed")
    ndvi_image = axes[1, 0].imshow(
        full_ndvi,
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=ndvi_cmap,
        vmin=-1,
        vmax=1,
    )
    axes[1, 0].set_title(
        f"NDVI - clear land only ({full_ndvi.count():,} valid pixels)"
    )
    style_map_axis(axes[1, 0])
    figure.colorbar(ndvi_image, ax=axes[1, 0], shrink=0.83, label="NDVI")

    fmask_colors = [
        "#d9d9d9",  # NoData
        "#f7f7f7",  # Clear
        "#3182bd",  # Water
        "#bdbdbd",  # Snow/ice
        "#636363",  # Cloud shadow
        "#fdae6b",  # Adjacent cloud
        "#9ecae1",  # Cirrus
        "#ffffff",  # Cloud
    ]
    fmask_labels = [
        "NoData",
        "Clear",
        "Water",
        "Snow/ice",
        "Cloud shadow",
        "Adjacent cloud",
        "Cirrus",
        "Cloud",
    ]
    fmask_cmap = ListedColormap(fmask_colors)
    axes[1, 1].imshow(
        fmask_classes,
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=fmask_cmap,
        norm=BoundaryNorm(np.arange(-0.5, 8.5, 1), fmask_cmap.N),
    )
    axes[1, 1].set_title("Fmask dominant class")
    style_map_axis(axes[1, 1])
    handles = [
        Patch(facecolor=color, edgecolor="#777777", linewidth=0.4, label=label)
        for color, label in zip(fmask_colors, fmask_labels, strict=True)
    ]
    axes[1, 1].legend(
        handles=handles,
        loc="lower left",
        ncol=2,
        framealpha=0.9,
        fontsize=8,
    )

    sensing_time = tags.get("SENSING_TIME", "unknown time")
    crs_name = tags.get("HORIZONTAL_CS_NAME", str(grid.crs))
    figure.suptitle(
        f"HLS S30 v2.0 - {product_id}\n{sensing_time} | 30 m | {crs_name}",
        fontsize=15,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=170, facecolor="white")
    plt.close(figure)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Visualize one HLS S30 granule from its GeoTIFF layers."
    )
    parser.add_argument(
        "--input-dir", required=True, type=Path, help="Directory containing HLS layers"
    )
    parser.add_argument("--output", required=True, type=Path, help="Output PNG path")
    parser.add_argument(
        "--max-size",
        type=positive_int,
        default=1600,
        help="Maximum width or height read for plotting (default: 1600)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_dir = args.input_dir.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    product_id, files = discover_layers(input_dir)
    grid = validate_grids(files)

    with rasterio.open(files["B02"]) as dataset:
        tags = dataset.tags()

    full_fmask = read_fmask(files["Fmask"])
    full_red = read_reflectance(files["B04"])
    full_nir = read_reflectance(files["B8A"])
    quality = quality_statistics(full_fmask)
    full_ndvi = calculate_ndvi(full_nir, full_red, clear_land_mask(full_fmask))
    print_statistics(product_id, grid, tags, quality, full_ndvi)

    plot_data = read_plot_data(files, grid, args.max_size)
    create_figure(product_id, grid, tags, plot_data, full_ndvi, output_path)
    print(f"Saved visualization: {output_path}")


if __name__ == "__main__":
    main()
