#!/usr/bin/env python3
"""Visualize an MCD43A4 NBAR granule on its native MODIS grid."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib
import numpy as np
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Patch
from pyhdf.SD import SD, SDC

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


EXPECTED_SHAPE = (2400, 2400)
EXPECTED_SCALE = 0.0001
REFLECTANCE_NAMES = tuple(f"Nadir_Reflectance_Band{band}" for band in range(1, 8))
QUALITY_NAMES = tuple(
    f"BRDF_Albedo_Band_Mandatory_Quality_Band{band}" for band in range(1, 8)
)
REQUIRED_DATASETS = QUALITY_NAMES + REFLECTANCE_NAMES
MISSING_COLOR = np.array([229, 231, 235], dtype=np.uint8)


@dataclass(frozen=True)
class ReflectanceBand:
    number: int
    raw: np.ndarray
    quality: np.ndarray
    fill_value: int
    valid_min: int
    valid_max: int
    scale_factor: float
    add_offset: float
    quality_fill: int

    @property
    def source_valid(self) -> np.ndarray:
        return (
            (self.raw != self.fill_value)
            & (self.raw >= self.valid_min)
            & (self.raw <= self.valid_max)
        )

    @property
    def usable(self) -> np.ndarray:
        return self.source_valid & ((self.quality == 0) | (self.quality == 1))

    def reflectance(self) -> np.ndarray:
        return self.raw.astype(np.float32) * self.scale_factor + self.add_offset


@dataclass(frozen=True)
class Granule:
    product_id: str
    tile_id: str
    nominal_date: str
    start_date: str
    end_date: str
    upper_left: tuple[float, float]
    lower_right: tuple[float, float]
    bands: dict[int, ReflectanceBand]
    dataset_count: int


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("stride must be at least 1")
    return parsed


def metadata_value(metadata: str, key: str, default: str = "unknown") -> str:
    pattern = rf"OBJECT\s*=\s*{re.escape(key)}.*?VALUE\s*=\s*\"?([^\"\n]+)"
    match = re.search(pattern, metadata, flags=re.DOTALL)
    return match.group(1).strip() if match else default


def grid_point(struct_metadata: str, key: str) -> tuple[float, float]:
    match = re.search(
        rf"{re.escape(key)}=\(([-+0-9.eE]+),([-+0-9.eE]+)\)", struct_metadata
    )
    if not match:
        raise ValueError(f"Could not parse {key} from StructMetadata.0")
    return float(match.group(1)), float(match.group(2))


def nominal_date_from_name(filename: str) -> str:
    match = re.search(r"\.A(\d{4})(\d{3})\.", filename)
    if not match:
        return "unknown"
    year, day_of_year = (int(value) for value in match.groups())
    return (datetime(year, 1, 1) + timedelta(days=day_of_year - 1)).date().isoformat()


def validate_reflectance_attributes(
    name: str, attributes: dict[str, object]
) -> tuple[int, int, int, float, float]:
    required = ("_FillValue", "valid_range", "scale_factor", "add_offset")
    missing = [key for key in required if key not in attributes]
    if missing:
        raise ValueError(f"{name} is missing attributes: {', '.join(missing)}")
    valid_range = attributes["valid_range"]
    if not isinstance(valid_range, (list, tuple)) or len(valid_range) != 2:
        raise ValueError(f"Unexpected valid_range for {name}: {valid_range!r}")
    scale = float(attributes["scale_factor"])
    if not np.isclose(scale, EXPECTED_SCALE):
        raise ValueError(f"Unexpected scale_factor for {name}: {scale}")
    return (
        int(attributes["_FillValue"]),
        int(valid_range[0]),
        int(valid_range[1]),
        scale,
        float(attributes["add_offset"]),
    )


def read_granule(input_path: Path) -> Granule:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input HDF file does not exist: {input_path}")

    hdf = SD(str(input_path), SDC.READ)
    try:
        datasets = hdf.datasets()
        missing = [name for name in REQUIRED_DATASETS if name not in datasets]
        if missing:
            raise KeyError(f"Missing required dataset(s): {', '.join(missing)}")

        arrays: dict[str, np.ndarray] = {}
        attributes: dict[str, dict[str, object]] = {}
        for name in REQUIRED_DATASETS:
            dataset = hdf.select(name)
            arrays[name] = np.asarray(dataset[:])
            attributes[name] = dataset.attributes()

        shapes = {name: array.shape for name, array in arrays.items()}
        if len(set(shapes.values())) != 1:
            raise ValueError(f"Required dataset shape mismatch: {shapes}")
        if shapes[REFLECTANCE_NAMES[0]] != EXPECTED_SHAPE:
            raise ValueError(
                f"Expected MCD43A4 grid {EXPECTED_SHAPE}, got {shapes[REFLECTANCE_NAMES[0]]}"
            )

        bands: dict[int, ReflectanceBand] = {}
        for band_number in range(1, 8):
            reflectance_name = f"Nadir_Reflectance_Band{band_number}"
            quality_name = f"BRDF_Albedo_Band_Mandatory_Quality_Band{band_number}"
            reflectance_attributes = validate_reflectance_attributes(
                reflectance_name, attributes[reflectance_name]
            )
            quality_fill = int(attributes[quality_name].get("_FillValue", 255))
            if quality_fill != 255:
                raise ValueError(f"Unexpected QA fill for {quality_name}: {quality_fill}")
            bands[band_number] = ReflectanceBand(
                number=band_number,
                raw=arrays[reflectance_name].astype(np.int16, copy=False),
                quality=arrays[quality_name].astype(np.uint8, copy=False),
                fill_value=reflectance_attributes[0],
                valid_min=reflectance_attributes[1],
                valid_max=reflectance_attributes[2],
                scale_factor=reflectance_attributes[3],
                add_offset=reflectance_attributes[4],
                quality_fill=quality_fill,
            )

        file_attributes = hdf.attributes()
        core_metadata = str(file_attributes.get("CoreMetadata.0", ""))
        struct_metadata = str(file_attributes.get("StructMetadata.0", ""))
        tile_match = re.search(r"\.(h\d{2}v\d{2})\.", input_path.name)
        return Granule(
            product_id=input_path.stem,
            tile_id=tile_match.group(1) if tile_match else "unknown tile",
            nominal_date=nominal_date_from_name(input_path.name),
            start_date=metadata_value(core_metadata, "RANGEBEGINNINGDATE"),
            end_date=metadata_value(core_metadata, "RANGEENDINGDATE"),
            upper_left=grid_point(struct_metadata, "UpperLeftPointMtrs"),
            lower_right=grid_point(struct_metadata, "LowerRightMtrs"),
            bands=bands,
            dataset_count=len(datasets),
        )
    finally:
        hdf.end()


def common_mask(granule: Granule, band_numbers: tuple[int, ...]) -> np.ndarray:
    mask = np.ones(EXPECTED_SHAPE, dtype=bool)
    for band_number in band_numbers:
        mask &= granule.bands[band_number].usable
    return mask


def calculate_ndvi(granule: Granule) -> tuple[np.ndarray, np.ndarray]:
    red = granule.bands[1].reflectance()
    nir = granule.bands[2].reflectance()
    denominator = nir + red
    valid = common_mask(granule, (1, 2)) & (denominator != 0)
    ndvi = np.full(EXPECTED_SHAPE, np.nan, dtype=np.float32)
    np.divide(nir - red, denominator, out=ndvi, where=valid)
    valid &= np.isfinite(ndvi) & (ndvi >= -1.0) & (ndvi <= 1.0)
    return ndvi, valid


def robust_rgb(
    granule: Granule, band_numbers: tuple[int, int, int], valid: np.ndarray
) -> np.ndarray:
    image = np.empty((*EXPECTED_SHAPE, 3), dtype=np.uint8)
    image[:] = MISSING_COLOR
    for channel, band_number in enumerate(band_numbers):
        reflectance = granule.bands[band_number].reflectance()
        low, high = np.percentile(reflectance[valid], [2, 98])
        if low == high:
            high = low + 1e-6
        stretched = np.clip((reflectance - low) / (high - low), 0.0, 1.0)
        image[..., channel][valid] = np.round(stretched[valid] * 255).astype(np.uint8)
    return image


def map_extent_km(granule: Granule) -> tuple[float, float, float, float]:
    left, top = granule.upper_left
    right, bottom = granule.lower_right
    return left / 1000.0, right / 1000.0, bottom / 1000.0, top / 1000.0


def style_map_axis(axis: plt.Axes) -> None:
    axis.set_xlabel("Sinusoidal X (km)")
    axis.set_ylabel("Sinusoidal Y (km)")
    axis.ticklabel_format(style="plain", useOffset=False)


def report(granule: Granule) -> None:
    total = EXPECTED_SHAPE[0] * EXPECTED_SHAPE[1]
    print(f"Product: {granule.product_id}")
    print(f"Tile: {granule.tile_id}")
    print(f"Nominal product date: {granule.nominal_date}")
    print(f"BRDF retrieval support period: {granule.start_date} to {granule.end_date}")
    print(f"Core grid: {EXPECTED_SHAPE[0]} x {EXPECTED_SHAPE[1]} at 500 m")
    print(f"HDF4 scientific datasets: {granule.dataset_count}")
    print(
        "Bounds (left, bottom, right, top; sinusoidal metres): "
        f"{granule.upper_left[0]:.3f}, {granule.lower_right[1]:.3f}, "
        f"{granule.lower_right[0]:.3f}, {granule.upper_left[1]:.3f}"
    )
    for band_number, band in granule.bands.items():
        source_count = int(np.count_nonzero(band.source_valid))
        full_count = int(np.count_nonzero(band.source_valid & (band.quality == 0)))
        magnitude_count = int(np.count_nonzero(band.source_valid & (band.quality == 1)))
        print(
            f"Band {band_number}: source-valid={source_count:,} "
            f"({source_count / total * 100.0:.2f}%), full inversion={full_count:,}, "
            f"magnitude inversion={magnitude_count:,}"
        )

    true_color = common_mask(granule, (1, 4, 3))
    false_color = common_mask(granule, (2, 1, 4))
    ndvi, ndvi_valid = calculate_ndvi(granule)
    full_inversion = ndvi_valid & (granule.bands[1].quality == 0) & (
        granule.bands[2].quality == 0
    )
    ndvi_values = ndvi[ndvi_valid]
    p05, median, p95 = np.percentile(ndvi_values, [5, 50, 95])
    print(
        f"True-color common pixels: {int(true_color.sum()):,} "
        f"({true_color.mean() * 100.0:.2f}%)"
    )
    print(
        f"False-color common pixels: {int(false_color.sum()):,} "
        f"({false_color.mean() * 100.0:.2f}%)"
    )
    print(
        f"NDVI: valid={ndvi_values.size:,} ({ndvi_valid.mean() * 100.0:.2f}%), "
        f"mean={np.mean(ndvi_values, dtype=np.float64):.4f}, median={median:.4f}, "
        f"p05={p05:.4f}, p95={p95:.4f}"
    )
    print(
        f"Band 1/2 both full inversion: {int(full_inversion.sum()):,} "
        f"({full_inversion.mean() * 100.0:.4f}% of grid, "
        f"{full_inversion.sum() / ndvi_values.size * 100.0:.2f}% of valid NDVI)"
    )


def render(granule: Granule, output_path: Path, stride: int) -> None:
    true_valid = common_mask(granule, (1, 4, 3))
    false_valid = common_mask(granule, (2, 1, 4))
    ndvi, ndvi_valid = calculate_ndvi(granule)
    if not true_valid.any() or not false_valid.any() or not ndvi_valid.any():
        raise ValueError("No usable true-color, false-color, or NDVI pixels")

    true_rgb = robust_rgb(granule, (1, 4, 3), true_valid)
    false_rgb = robust_rgb(granule, (2, 1, 4), false_valid)
    extent = map_extent_km(granule)
    figure, axes = plt.subplots(2, 2, figsize=(15, 11), layout="constrained")

    for axis, image, title in (
        (axes[0, 0], true_rgb, "True color (Band 1 / 4 / 3)"),
        (axes[0, 1], false_rgb, "Vegetation false color (Band 2 / 1 / 4)"),
    ):
        axis.imshow(
            image[::stride, ::stride],
            extent=extent,
            origin="upper",
            interpolation="nearest",
        )
        axis.set_title(f"{title}\nPer-channel 2-98 percentile stretch")
        style_map_axis(axis)

    ndvi_cmap = matplotlib.colormaps["RdYlGn"].copy()
    ndvi_cmap.set_bad("#e5e7eb")
    ndvi_image = axes[1, 0].imshow(
        np.ma.array(
            ndvi[::stride, ::stride], mask=~ndvi_valid[::stride, ::stride]
        ),
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=ndvi_cmap,
        vmin=-1.0,
        vmax=1.0,
    )
    axes[1, 0].set_title("NDVI from NBAR Band 2 and Band 1\nMandatory QA = 0 or 1")
    style_map_axis(axes[1, 0])
    figure.colorbar(
        ndvi_image, ax=axes[1, 0], label="NDVI", shrink=0.86, pad=0.02
    )

    band1 = granule.bands[1]
    band2 = granule.bands[2]
    quality = np.zeros(EXPECTED_SHAPE, dtype=np.uint8)
    quality[ndvi_valid] = 1
    quality[ndvi_valid & (band1.quality == 0) & (band2.quality == 0)] = 2
    quality_colors = ("#e5e7eb", "#f59e0b", "#15803d")
    quality_labels = (
        "NoData / unusable",
        "Magnitude or mixed inversion",
        "Full inversion in Bands 1 and 2",
    )
    axes[1, 1].imshow(
        quality[::stride, ::stride],
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=ListedColormap(quality_colors),
        norm=BoundaryNorm([-0.5, 0.5, 1.5, 2.5], 3),
    )
    axes[1, 1].set_title("Band 1/2 joint Mandatory QA\nQuality used for NDVI")
    style_map_axis(axes[1, 1])
    axes[1, 1].legend(
        handles=[
            Patch(facecolor=color, label=label)
            for color, label in zip(quality_colors, quality_labels, strict=True)
        ],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.14),
        frameon=False,
        fontsize=9,
    )

    figure.suptitle(
        f"MCD43A4 V061 - {granule.tile_id} - Nadir BRDF-Adjusted Reflectance\n"
        f"Nominal date {granule.nominal_date} | retrieval window "
        f"{granule.start_date} to {granule.end_date} | 500 m | MODIS Sinusoidal",
        fontsize=15,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    print(f"Saved visualization: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Input MCD43A4 HDF4 file")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG path")
    parser.add_argument(
        "--stride",
        type=positive_int,
        default=2,
        help="Map sampling stride; statistics always use the full grid (default: 2)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    granule = read_granule(args.input)
    report(granule)
    render(granule, args.output, args.stride)


if __name__ == "__main__":
    main()
