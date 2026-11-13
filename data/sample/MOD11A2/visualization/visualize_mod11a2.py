#!/usr/bin/env python3
"""Visualize MOD11A2 daytime and nighttime land-surface temperature."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
from pyhdf.SD import SD, SDC

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


DAY_LST = "LST_Day_1km"
NIGHT_LST = "LST_Night_1km"
DAY_QC = "QC_Day"
NIGHT_QC = "QC_Night"
CLEAR_DAYS = "Clear_sky_days"
CLEAR_NIGHTS = "Clear_sky_nights"
REQUIRED_DATASETS = (DAY_LST, NIGHT_LST, DAY_QC, NIGHT_QC, CLEAR_DAYS, CLEAR_NIGHTS)
EXPECTED_SHAPE = (1200, 1200)
MISSING_COLOR = "#e5e7eb"


@dataclass(frozen=True)
class TemperatureLayer:
    raw: np.ndarray
    qc: np.ndarray
    fill_value: int
    valid_min: int
    valid_max: int
    scale_factor: float
    add_offset: float

    @property
    def source_valid(self) -> np.ndarray:
        return (
            (self.raw != self.fill_value)
            & (self.raw >= self.valid_min)
            & (self.raw <= self.valid_max)
        )

    @property
    def mandatory_qa(self) -> np.ndarray:
        return self.qc & np.uint8(0b11)

    @property
    def usable(self) -> np.ndarray:
        return self.source_valid & (self.mandatory_qa <= 1)

    def celsius(self) -> np.ndarray:
        kelvin = self.raw.astype(np.float32) * self.scale_factor + self.add_offset
        return kelvin - np.float32(273.15)


@dataclass(frozen=True)
class Granule:
    product_id: str
    tile_id: str
    start_date: str
    end_date: str
    upper_left: tuple[float, float]
    lower_right: tuple[float, float]
    day: TemperatureLayer
    night: TemperatureLayer
    clear_days: np.ndarray
    clear_nights: np.ndarray
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


def temperature_attributes(name: str, attributes: dict[str, object]) -> tuple[int, int, int, float, float]:
    required = ("_FillValue", "valid_range", "scale_factor", "add_offset")
    missing = [key for key in required if key not in attributes]
    if missing:
        raise ValueError(f"{name} is missing attributes: {', '.join(missing)}")
    valid_range = attributes["valid_range"]
    if not isinstance(valid_range, (list, tuple)) or len(valid_range) != 2:
        raise ValueError(f"Unexpected valid_range for {name}: {valid_range!r}")
    scale_factor = float(attributes["scale_factor"])
    if scale_factor <= 0:
        raise ValueError(f"Invalid scale_factor for {name}: {scale_factor}")
    return (
        int(attributes["_FillValue"]),
        int(valid_range[0]),
        int(valid_range[1]),
        scale_factor,
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
        if shapes[DAY_LST] != EXPECTED_SHAPE:
            raise ValueError(
                f"Expected MOD11A2 grid {EXPECTED_SHAPE}, got {shapes[DAY_LST]}"
            )

        file_attributes = hdf.attributes()
        core_metadata = str(file_attributes.get("CoreMetadata.0", ""))
        struct_metadata = str(file_attributes.get("StructMetadata.0", ""))
        tile_match = re.search(r"\.(h\d{2}v\d{2})\.", input_path.name)

        day_attrs = temperature_attributes(DAY_LST, attributes[DAY_LST])
        night_attrs = temperature_attributes(NIGHT_LST, attributes[NIGHT_LST])
        day = TemperatureLayer(
            arrays[DAY_LST].astype(np.uint16, copy=False),
            arrays[DAY_QC].astype(np.uint8, copy=False),
            *day_attrs,
        )
        night = TemperatureLayer(
            arrays[NIGHT_LST].astype(np.uint16, copy=False),
            arrays[NIGHT_QC].astype(np.uint8, copy=False),
            *night_attrs,
        )
        if not day.usable.any() or not night.usable.any():
            raise ValueError("No QA-usable daytime or nighttime LST pixels")

        return Granule(
            product_id=input_path.stem,
            tile_id=tile_match.group(1) if tile_match else "unknown tile",
            start_date=metadata_value(core_metadata, "RANGEBEGINNINGDATE"),
            end_date=metadata_value(core_metadata, "RANGEENDINGDATE"),
            upper_left=grid_point(struct_metadata, "UpperLeftPointMtrs"),
            lower_right=grid_point(struct_metadata, "LowerRightMtrs"),
            day=day,
            night=night,
            clear_days=arrays[CLEAR_DAYS].astype(np.uint8, copy=False),
            clear_nights=arrays[CLEAR_NIGHTS].astype(np.uint8, copy=False),
            dataset_count=len(datasets),
        )
    finally:
        hdf.end()


def bit_counts(values: np.ndarray) -> np.ndarray:
    lookup = np.array([int(value).bit_count() for value in range(256)], dtype=np.uint8)
    return lookup[values]


def summary_statistics(values: np.ndarray) -> dict[str, float | int]:
    if not values.size:
        raise ValueError("Cannot summarize an empty array")
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    return {
        "count": int(values.size),
        "mean": float(np.mean(values, dtype=np.float64)),
        "median": float(median),
        "p05": float(p05),
        "p95": float(p95),
        "min": float(np.min(values)),
        "max": float(np.max(values)),
    }


def print_layer_statistics(label: str, layer: TemperatureLayer) -> dict[str, float | int]:
    total = layer.raw.size
    source_count = int(np.count_nonzero(layer.source_valid))
    usable_count = int(np.count_nonzero(layer.usable))
    print(
        f"{label}: source-valid={source_count:,}/{total:,} "
        f"({source_count / total * 100.0:.2f}%), QA-usable={usable_count:,}"
    )
    print("  Mandatory QA among source-valid pixels:")
    labels = {
        0: "LST produced, good quality",
        1: "LST produced, other quality",
        2: "LST not produced, cloud",
        3: "LST not produced, other reason",
    }
    for value in range(4):
        count = int(np.count_nonzero(layer.source_valid & (layer.mandatory_qa == value)))
        percentage = count / source_count * 100.0 if source_count else 0.0
        print(f"    {value:02b} {labels[value]}: {count:,} ({percentage:.2f}%)")

    stats = summary_statistics(layer.celsius()[layer.usable])
    print(
        f"  LST (deg C): mean={stats['mean']:.3f}, median={stats['median']:.3f}, "
        f"p05={stats['p05']:.3f}, p95={stats['p95']:.3f}, "
        f"range={stats['min']:.3f} to {stats['max']:.3f}"
    )
    return stats


def print_clear_sky_distribution(label: str, flags: np.ndarray, valid: np.ndarray) -> None:
    counts = bit_counts(flags[valid])
    distribution = np.bincount(counts, minlength=9)
    print(f"{label} clear-sky observation count (set bits across the 8-day composite):")
    for days, count in enumerate(distribution):
        print(f"  {days} day(s): {int(count):,} ({count / counts.size * 100.0:.2f}%)")


def report(granule: Granule) -> None:
    print(f"Product: {granule.product_id}")
    print(f"Tile: {granule.tile_id}")
    print(f"Composite period: {granule.start_date} to {granule.end_date}")
    print(f"Core grid: {EXPECTED_SHAPE[0]} x {EXPECTED_SHAPE[1]}")
    print(f"HDF4 scientific datasets: {granule.dataset_count}")
    print_layer_statistics("Daytime", granule.day)
    print_layer_statistics("Nighttime", granule.night)

    common = granule.day.usable & granule.night.usable
    difference = granule.day.celsius()[common] - granule.night.celsius()[common]
    diff_stats = summary_statistics(difference)
    print(
        f"Day - night LST: common pixels={diff_stats['count']:,}, "
        f"mean={diff_stats['mean']:.3f}, median={diff_stats['median']:.3f}, "
        f"p05={diff_stats['p05']:.3f}, p95={diff_stats['p95']:.3f}, "
        f"range={diff_stats['min']:.3f} to {diff_stats['max']:.3f} deg C"
    )
    print_clear_sky_distribution("Daytime", granule.clear_days, granule.day.source_valid)
    print_clear_sky_distribution("Nighttime", granule.clear_nights, granule.night.source_valid)


def map_extent_km(granule: Granule) -> tuple[float, float, float, float]:
    left, top = granule.upper_left
    right, bottom = granule.lower_right
    return left / 1000.0, right / 1000.0, bottom / 1000.0, top / 1000.0


def style_map_axis(axis: plt.Axes) -> None:
    axis.set_xlabel("Sinusoidal X (km)")
    axis.set_ylabel("Sinusoidal Y (km)")
    axis.ticklabel_format(style="plain", useOffset=False)


def render(granule: Granule, output_path: Path, stride: int) -> None:
    day_c = granule.day.celsius()
    night_c = granule.night.celsius()
    common = granule.day.usable & granule.night.usable
    difference = day_c - night_c

    day_values = day_c[granule.day.usable]
    night_values = night_c[granule.night.usable]
    difference_values = difference[common]
    combined = np.concatenate((day_values, night_values))
    temp_low, temp_high = np.percentile(combined, [2, 98])
    if temp_low == temp_high:
        temp_low, temp_high = temp_low - 0.5, temp_high + 0.5
    diff_limit = float(np.percentile(np.abs(difference_values), 98))
    if diff_limit == 0:
        diff_limit = 0.5

    extent = map_extent_km(granule)
    figure, axes = plt.subplots(2, 2, figsize=(15, 11), layout="constrained")

    temperature_cmap = matplotlib.colormaps["inferno"].copy()
    temperature_cmap.set_bad(MISSING_COLOR)
    temperature_images = []
    for axis, values, valid, title in (
        (axes[0, 0], day_c, granule.day.usable, "Daytime land-surface temperature"),
        (axes[0, 1], night_c, granule.night.usable, "Nighttime land-surface temperature"),
    ):
        image = axis.imshow(
            np.ma.array(values[::stride, ::stride], mask=~valid[::stride, ::stride]),
            extent=extent,
            origin="upper",
            interpolation="nearest",
            cmap=temperature_cmap,
            vmin=temp_low,
            vmax=temp_high,
        )
        temperature_images.append(image)
        axis.set_title(f"{title}\nMandatory QA = 00 or 01")
        style_map_axis(axis)
    figure.colorbar(
        temperature_images[0],
        ax=list(axes[0, :]),
        label="Land-surface temperature (deg C)",
        extend="both",
        shrink=0.86,
        pad=0.02,
    )

    difference_cmap = matplotlib.colormaps["RdBu_r"].copy()
    difference_cmap.set_bad(MISSING_COLOR)
    difference_image = axes[1, 0].imshow(
        np.ma.array(difference[::stride, ::stride], mask=~common[::stride, ::stride]),
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=difference_cmap,
        vmin=-diff_limit,
        vmax=diff_limit,
    )
    axes[1, 0].set_title("Diurnal temperature difference (day - night)\nCommon QA-usable pixels")
    style_map_axis(axes[1, 0])
    figure.colorbar(
        difference_image,
        ax=axes[1, 0],
        label="Temperature difference (deg C)",
        extend="both",
        shrink=0.86,
        pad=0.02,
    )

    histogram = axes[1, 1]
    temp_bins = np.linspace(float(np.min(combined)), float(np.max(combined)), 81)
    histogram.hist(
        day_values,
        bins=temp_bins,
        histtype="step",
        linewidth=1.8,
        color="#d95f02",
        label=f"Daytime (n={day_values.size:,})",
    )
    histogram.hist(
        night_values,
        bins=temp_bins,
        histtype="step",
        linewidth=1.8,
        color="#1f78b4",
        label=f"Nighttime (n={night_values.size:,})",
    )
    difference_axis = histogram.twinx()
    diff_bins = np.linspace(float(np.min(difference_values)), float(np.max(difference_values)), 81)
    difference_axis.hist(
        difference_values,
        bins=diff_bins,
        histtype="step",
        linewidth=1.5,
        linestyle="--",
        color="#5e3c99",
        label=f"Day - night (n={difference_values.size:,})",
    )
    histogram.set_title("Full-resolution temperature distributions")
    histogram.set_xlabel("Temperature / temperature difference (deg C)")
    histogram.set_ylabel("Day/night pixel count")
    difference_axis.set_ylabel("Difference pixel count", color="#5e3c99")
    histogram.grid(axis="y", alpha=0.2)
    lines = histogram.get_lines() + difference_axis.get_lines()
    histogram.legend(lines, [line.get_label() for line in lines], frameon=False, fontsize=9)

    figure.suptitle(
        f"MOD11A2 V061 - {granule.tile_id} - 8-day land-surface temperature\n"
        f"{granule.start_date} to {granule.end_date} | 1 km | MODIS Sinusoidal",
        fontsize=15,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    print(f"Saved visualization: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Input MOD11A2 HDF4 file")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG path")
    parser.add_argument(
        "--stride",
        type=positive_int,
        default=1,
        help="Map sampling stride; statistics always use the full grid (default: 1)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    granule = read_granule(args.input)
    report(granule)
    render(granule, args.output, args.stride)


if __name__ == "__main__":
    main()
