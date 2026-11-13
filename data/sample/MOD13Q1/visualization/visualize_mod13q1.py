#!/usr/bin/env python3
"""Visualize MOD13Q1 vegetation indices or diagnose an empty HDF4 granule."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Patch
from pyhdf.SD import SD, SDC

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


NDVI_NAME = "250m 16 days NDVI"
EVI_NAME = "250m 16 days EVI"
QA_NAME = "250m 16 days VI Quality"
RELIABILITY_NAME = "250m 16 days pixel reliability"
REQUIRED_DATASETS = (NDVI_NAME, EVI_NAME, QA_NAME, RELIABILITY_NAME)
EXPECTED_SHAPE = (4800, 4800)


@dataclass(frozen=True)
class IndexLayer:
    name: str
    raw: np.ndarray
    fill_value: int
    valid_min: int
    valid_max: int
    divisor: float

    @property
    def source_valid(self) -> np.ndarray:
        return (
            (self.raw != self.fill_value)
            & (self.raw >= self.valid_min)
            & (self.raw <= self.valid_max)
        )

    def scaled(self, mask: np.ndarray | None = None) -> np.ma.MaskedArray:
        valid = self.source_valid.copy()
        if mask is not None:
            if mask.shape != self.raw.shape:
                raise ValueError(
                    f"Mask shape {mask.shape} does not match {self.name} {self.raw.shape}"
                )
            valid &= mask
        values = self.raw.astype(np.float32) / self.divisor
        return np.ma.array(values, mask=~valid)


@dataclass(frozen=True)
class Granule:
    product_id: str
    tile_id: str
    start_date: str
    end_date: str
    upper_left: tuple[float, float]
    lower_right: tuple[float, float]
    ndvi: IndexLayer
    evi: IndexLayer
    qa: np.ndarray
    reliability: np.ndarray
    reliability_fill: int
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
        rf"{re.escape(key)}=\(([-+0-9.eE]+),([-+0-9.eE]+)\)",
        struct_metadata,
    )
    if not match:
        raise ValueError(f"Could not parse {key} from StructMetadata.0")
    return float(match.group(1)), float(match.group(2))


def make_index_layer(name: str, raw: np.ndarray, attributes: dict[str, object]) -> IndexLayer:
    required = ("_FillValue", "valid_range", "scale_factor")
    missing = [key for key in required if key not in attributes]
    if missing:
        raise ValueError(f"{name} is missing attributes: {', '.join(missing)}")
    valid_range = attributes["valid_range"]
    if not isinstance(valid_range, (list, tuple)) or len(valid_range) != 2:
        raise ValueError(f"Unexpected valid_range for {name}: {valid_range!r}")
    divisor = float(attributes["scale_factor"])
    if divisor == 0:
        raise ValueError(f"Invalid zero scale_factor for {name}")
    return IndexLayer(
        name=name,
        raw=raw,
        fill_value=int(attributes["_FillValue"]),
        valid_min=int(valid_range[0]),
        valid_max=int(valid_range[1]),
        divisor=divisor,
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

        file_attributes = hdf.attributes()
        core_metadata = str(file_attributes.get("CoreMetadata.0", ""))
        struct_metadata = str(file_attributes.get("StructMetadata.0", ""))

        arrays: dict[str, np.ndarray] = {}
        attributes: dict[str, dict[str, object]] = {}
        for name in REQUIRED_DATASETS:
            dataset = hdf.select(name)
            arrays[name] = np.asarray(dataset[:])
            attributes[name] = dataset.attributes()

        shapes = {name: array.shape for name, array in arrays.items()}
        if len(set(shapes.values())) != 1:
            raise ValueError(f"Core dataset shape mismatch: {shapes}")
        if shapes[NDVI_NAME] != EXPECTED_SHAPE:
            raise ValueError(
                f"Expected MOD13Q1 core shape {EXPECTED_SHAPE}, got {shapes[NDVI_NAME]}"
            )

        tile_match = re.search(r"\.(h\d{2}v\d{2})\.", input_path.name)
        tile_id = tile_match.group(1) if tile_match else "unknown tile"
        return Granule(
            product_id=input_path.stem,
            tile_id=tile_id,
            start_date=metadata_value(core_metadata, "RANGEBEGINNINGDATE"),
            end_date=metadata_value(core_metadata, "RANGEENDINGDATE"),
            upper_left=grid_point(struct_metadata, "UpperLeftPointMtrs"),
            lower_right=grid_point(struct_metadata, "LowerRightMtrs"),
            ndvi=make_index_layer(
                NDVI_NAME, arrays[NDVI_NAME], attributes[NDVI_NAME]
            ),
            evi=make_index_layer(EVI_NAME, arrays[EVI_NAME], attributes[EVI_NAME]),
            qa=arrays[QA_NAME].astype(np.uint16, copy=False),
            reliability=arrays[RELIABILITY_NAME].astype(np.int8, copy=False),
            reliability_fill=int(attributes[RELIABILITY_NAME].get("_FillValue", -1)),
            dataset_count=len(datasets),
        )
    finally:
        hdf.end()


def reliable_mask(reliability: np.ndarray) -> np.ndarray:
    return (reliability == 0) | (reliability == 1)


def class_counts(values: np.ndarray) -> dict[int, int]:
    unique, counts = np.unique(values, return_counts=True)
    return {int(value): int(count) for value, count in zip(unique, counts, strict=True)}


def index_statistics(layer: IndexLayer, quality_mask: np.ndarray) -> dict[str, float | int]:
    source_count = int(np.count_nonzero(layer.source_valid))
    data = layer.scaled(quality_mask).compressed()
    stats: dict[str, float | int] = {
        "source_valid": source_count,
        "quality_valid": int(data.size),
        "fill": int(layer.raw.size - source_count),
    }
    if data.size:
        p05, median, p95 = np.percentile(data, [5, 50, 95])
        stats.update(
            mean=float(np.mean(data)),
            median=float(median),
            p05=float(p05),
            p95=float(p95),
        )
    return stats


def print_statistics(granule: Granule) -> tuple[dict[str, float | int], dict[str, float | int]]:
    quality_mask = reliable_mask(granule.reliability)
    ndvi_stats = index_statistics(granule.ndvi, quality_mask)
    evi_stats = index_statistics(granule.evi, quality_mask)
    total = granule.reliability.size

    print(f"Product: {granule.product_id}")
    print(f"Tile: {granule.tile_id}")
    print(f"Composite period: {granule.start_date} to {granule.end_date}")
    print(f"Core grid: {granule.ndvi.raw.shape[0]} x {granule.ndvi.raw.shape[1]}")
    print(f"HDF4 scientific datasets: {granule.dataset_count}")

    reliability_counts = class_counts(granule.reliability)
    labels = {-1: "Fill", 0: "Good", 1: "Marginal", 2: "Snow/ice", 3: "Cloudy"}
    print("Pixel Reliability:")
    for value in (-1, 0, 1, 2, 3):
        count = reliability_counts.get(value, 0)
        print(f"  {labels[value]}: {count:,} ({count / total * 100.0:.2f}%)")

    for label, stats in (("NDVI", ndvi_stats), ("EVI", evi_stats)):
        print(
            f"{label}: source-valid={int(stats['source_valid']):,} "
            f"({int(stats['source_valid']) / total * 100.0:.2f}%), "
            f"quality-valid={int(stats['quality_valid']):,}"
        )
        if int(stats["quality_valid"]):
            print(
                f"  mean={stats['mean']:.4f}, median={stats['median']:.4f}, "
                f"p05={stats['p05']:.4f}, p95={stats['p95']:.4f}"
            )
    return ndvi_stats, evi_stats


def map_extent_km(granule: Granule) -> tuple[float, float, float, float]:
    left, top = granule.upper_left
    right, bottom = granule.lower_right
    return left / 1000, right / 1000, bottom / 1000, top / 1000


def style_map_axis(axis: plt.Axes) -> None:
    axis.set_xlabel("Sinusoidal X (km)")
    axis.set_ylabel("Sinusoidal Y (km)")
    axis.ticklabel_format(style="plain", useOffset=False)


def reliability_classes(reliability: np.ndarray) -> np.ndarray:
    classes = np.zeros(reliability.shape, dtype=np.uint8)
    classes[reliability == 0] = 1
    classes[reliability == 1] = 2
    classes[reliability == 2] = 3
    classes[reliability == 3] = 4
    return classes


def add_title(figure: plt.Figure, granule: Granule, suffix: str) -> None:
    figure.suptitle(
        f"MOD13Q1 V061 - {granule.tile_id} - {suffix}\n"
        f"{granule.start_date} to {granule.end_date} | 250 m | 16-day composite",
        fontsize=15,
    )


def create_standard_figure(granule: Granule, output_path: Path, stride: int) -> None:
    quality_mask = reliable_mask(granule.reliability)
    ndvi = granule.ndvi.scaled(quality_mask)
    evi = granule.evi.scaled(quality_mask)
    extent = map_extent_km(granule)

    figure, axes = plt.subplots(2, 2, figsize=(15, 11), constrained_layout=True)
    vi_cmap = matplotlib.colormaps["RdYlGn"].copy()
    vi_cmap.set_bad("#e6e6e6")
    for axis, data, title in (
        (axes[0, 0], ndvi, "NDVI - Good and Marginal pixels"),
        (axes[0, 1], evi, "EVI - Good and Marginal pixels"),
    ):
        image = axis.imshow(
            data[::stride, ::stride],
            extent=extent,
            origin="upper",
            interpolation="nearest",
            cmap=vi_cmap,
            vmin=-0.2,
            vmax=1.0,
        )
        axis.set_title(title)
        style_map_axis(axis)
        figure.colorbar(image, ax=axis, shrink=0.82, label=title.split()[0])

    reliability = reliability_classes(granule.reliability[::stride, ::stride])
    reliability_colors = ["#d9d9d9", "#238b45", "#fdae6b", "#9ecae1", "#636363"]
    reliability_labels = ["Fill", "Good", "Marginal", "Snow/ice", "Cloudy"]
    reliability_cmap = ListedColormap(reliability_colors)
    axes[1, 0].imshow(
        reliability,
        extent=extent,
        origin="upper",
        interpolation="nearest",
        cmap=reliability_cmap,
        norm=BoundaryNorm(np.arange(-0.5, 5.5), reliability_cmap.N),
    )
    axes[1, 0].set_title("Pixel Reliability")
    style_map_axis(axes[1, 0])
    axes[1, 0].legend(
        handles=[
            Patch(facecolor=color, edgecolor="#666666", linewidth=0.4, label=label)
            for color, label in zip(reliability_colors, reliability_labels, strict=True)
        ],
        loc="lower left",
        framealpha=0.9,
    )

    bins = np.linspace(-0.2, 1.0, 61)
    for values, label, color in (
        (ndvi.compressed(), "NDVI", "#238b45"),
        (evi.compressed(), "EVI", "#756bb1"),
    ):
        weights = np.full(values.shape, 100.0 / values.size)
        axes[1, 1].hist(
            values,
            bins=bins,
            weights=weights,
            histtype="step",
            linewidth=1.8,
            label=label,
            color=color,
        )
    axes[1, 1].set_title("Quality-filtered vegetation index distributions")
    axes[1, 1].set_xlabel("Vegetation index")
    axes[1, 1].set_ylabel("Pixels per bin (%)")
    axes[1, 1].grid(axis="y", color="0.85", linewidth=0.6)
    axes[1, 1].legend(frameon=False)

    add_title(figure, granule, "vegetation indices")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=170, facecolor="white")
    plt.close(figure)


def create_empty_diagnostic(
    granule: Granule,
    ndvi_stats: dict[str, float | int],
    evi_stats: dict[str, float | int],
    output_path: Path,
) -> None:
    total = granule.ndvi.raw.size
    figure, axes = plt.subplots(2, 2, figsize=(14, 9), constrained_layout=True)

    labels = ["NDVI", "EVI"]
    fill_percent = [
        int(ndvi_stats["fill"]) / total * 100.0,
        int(evi_stats["fill"]) / total * 100.0,
    ]
    axes[0, 0].bar(labels, fill_percent, color="#969696")
    axes[0, 0].set_ylim(0, 105)
    axes[0, 0].set_ylabel("Fill / invalid pixels (%)")
    axes[0, 0].set_title("Vegetation-index availability")
    for index, value in enumerate(fill_percent):
        axes[0, 0].text(index, value + 1.5, f"{value:.2f}%", ha="center")
    axes[0, 0].grid(axis="y", color="0.88", linewidth=0.6)

    reliability_counts = class_counts(granule.reliability)
    reliability_labels = ["Fill", "Good", "Marginal", "Snow/ice", "Cloudy"]
    reliability_values = [-1, 0, 1, 2, 3]
    reliability_percent = [
        reliability_counts.get(value, 0) / total * 100.0 for value in reliability_values
    ]
    axes[0, 1].bar(reliability_labels, reliability_percent, color="#6baed6")
    axes[0, 1].set_ylim(0, 105)
    axes[0, 1].set_ylabel("Pixels (%)")
    axes[0, 1].set_title("Pixel Reliability distribution")
    axes[0, 1].tick_params(axis="x", rotation=25)
    axes[0, 1].grid(axis="y", color="0.88", linewidth=0.6)

    qa_counts = class_counts(granule.qa)
    qa_codes = sorted(qa_counts)
    qa_percent = [qa_counts[code] / total * 100.0 for code in qa_codes]
    axes[1, 0].bar([str(code) for code in qa_codes], qa_percent, color="#fdae6b")
    axes[1, 0].set_xlabel("Raw VI Quality code")
    axes[1, 0].set_ylabel("Pixels (%)")
    axes[1, 0].set_title("Raw VI Quality code distribution")
    axes[1, 0].grid(axis="y", color="0.88", linewidth=0.6)

    axes[1, 1].axis("off")
    summary = (
        "NO USABLE VEGETATION-INDEX DATA\n\n"
        f"Product: {granule.product_id}\n"
        f"Tile: {granule.tile_id}\n"
        f"Composite: {granule.start_date} to {granule.end_date}\n"
        f"Grid: {granule.ndvi.raw.shape[0]:,} x {granule.ndvi.raw.shape[1]:,}\n"
        f"NDVI source-valid pixels: {int(ndvi_stats['source_valid']):,}\n"
        f"EVI source-valid pixels: {int(evi_stats['source_valid']):,}\n"
        f"Pixel Reliability Fill: {reliability_counts.get(-1, 0):,} / {total:,}\n\n"
        "The HDF4 structure is valid, but its science layers contain only fill values.\n"
        "Download a MOD13Q1 tile covering the intended land study area."
    )
    axes[1, 1].text(
        0.03,
        0.97,
        summary,
        transform=axes[1, 1].transAxes,
        va="top",
        ha="left",
        fontsize=11,
        linespacing=1.4,
    )

    add_title(figure, granule, "empty-granule diagnostic")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=170, facecolor="white")
    plt.close(figure)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Visualize MOD13Q1 NDVI/EVI or diagnose an empty HDF4 granule."
    )
    parser.add_argument("--input", required=True, type=Path, help="Input MOD13Q1 HDF4 file")
    parser.add_argument("--output", required=True, type=Path, help="Output PNG path")
    parser.add_argument(
        "--stride",
        type=positive_int,
        default=4,
        help="Map sampling stride; statistics use the full grid (default: 4)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    granule = read_granule(input_path)
    ndvi_stats, evi_stats = print_statistics(granule)

    if int(ndvi_stats["quality_valid"]) == 0 and int(evi_stats["quality_valid"]) == 0:
        print("No usable NDVI/EVI pixels; generating an empty-granule diagnostic.")
        create_empty_diagnostic(granule, ndvi_stats, evi_stats, output_path)
    else:
        create_standard_figure(granule, output_path, args.stride)
    print(f"Saved visualization: {output_path}")


if __name__ == "__main__":
    main()
