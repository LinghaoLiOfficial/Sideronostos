#!/usr/bin/env python3
"""Visualize global AM/PM soil moisture from a SPL3SMP_E HDF5 granule."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import h5py
import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


AM_GROUP = "Soil_Moisture_Retrieval_Data_AM"
PM_GROUP = "Soil_Moisture_Retrieval_Data_PM"
DEFAULT_MIN = 0.02
DEFAULT_MAX = 0.5


@dataclass(frozen=True)
class Layer:
    label: str
    values: np.ndarray
    valid: np.ndarray
    plot_values: np.ma.MaskedArray
    plot_longitude: np.ndarray
    plot_latitude: np.ndarray
    units: str
    valid_min: float
    valid_max: float


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("stride must be at least 1")
    return parsed


def decode_attribute(value: object, default: str) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if value is None:
        return default
    return str(value).replace("cm**3/cm**3", "cm³/cm³")


def read_layer(
    h5_file: h5py.File,
    *,
    group_name: str,
    value_name: str,
    longitude_name: str,
    latitude_name: str,
    label: str,
    stride: int,
) -> Layer:
    required_paths = [
        f"{group_name}/{value_name}",
        f"{group_name}/{longitude_name}",
        f"{group_name}/{latitude_name}",
    ]
    missing = [path for path in required_paths if path not in h5_file]
    if missing:
        raise KeyError(f"Missing required HDF5 dataset(s): {', '.join(missing)}")

    group = h5_file[group_name]
    dataset = group[value_name]
    longitude_dataset = group[longitude_name]
    latitude_dataset = group[latitude_name]

    if dataset.ndim != 2:
        raise ValueError(f"{dataset.name} must be 2-D, got shape {dataset.shape}")
    if longitude_dataset.shape != dataset.shape or latitude_dataset.shape != dataset.shape:
        raise ValueError(
            f"Coordinate shape mismatch in {group_name}: values={dataset.shape}, "
            f"longitude={longitude_dataset.shape}, latitude={latitude_dataset.shape}"
        )

    fill_value = float(dataset.attrs.get("_FillValue", -9999.0))
    valid_min = float(dataset.attrs.get("valid_min", DEFAULT_MIN))
    valid_max = float(dataset.attrs.get("valid_max", DEFAULT_MAX))
    units = decode_attribute(dataset.attrs.get("units"), "cm^3/cm^3")

    values = np.asarray(dataset[...], dtype=np.float32)
    valid = (
        np.isfinite(values)
        & (values != fill_value)
        & (values >= valid_min)
        & (values <= valid_max)
    )

    plot_values_raw = values[::stride, ::stride]
    plot_valid = valid[::stride, ::stride]
    plot_values = np.ma.array(plot_values_raw, mask=~plot_valid, copy=False)
    plot_longitude = np.asarray(
        longitude_dataset[::stride, ::stride], dtype=np.float32
    )
    plot_latitude = np.asarray(latitude_dataset[::stride, ::stride], dtype=np.float32)

    return Layer(
        label=label,
        values=values,
        valid=valid,
        plot_values=plot_values,
        plot_longitude=plot_longitude,
        plot_latitude=plot_latitude,
        units=units,
        valid_min=valid_min,
        valid_max=valid_max,
    )


def statistics(layer: Layer) -> dict[str, float | int]:
    data = layer.values[layer.valid]
    if data.size == 0:
        raise ValueError(f"{layer.label} contains no values in the valid range")

    percentiles = np.percentile(data, [5, 50, 95])
    return {
        "valid_pixels": int(data.size),
        "total_pixels": int(layer.values.size),
        "coverage_percent": float(data.size / layer.values.size * 100.0),
        "mean": float(np.mean(data)),
        "median": float(percentiles[1]),
        "p05": float(percentiles[0]),
        "p95": float(percentiles[2]),
        "minimum": float(np.min(data)),
        "maximum": float(np.max(data)),
    }


def print_statistics(layer: Layer, stats: dict[str, float | int]) -> None:
    print(f"{layer.label} soil moisture ({layer.units})")
    print(
        f"  valid pixels: {stats['valid_pixels']:,} / {stats['total_pixels']:,} "
        f"({stats['coverage_percent']:.2f}%)"
    )
    print(
        f"  mean={stats['mean']:.4f}, median={stats['median']:.4f}, "
        f"p05={stats['p05']:.4f}, p95={stats['p95']:.4f}"
    )
    print(f"  min={stats['minimum']:.4f}, max={stats['maximum']:.4f}")


def plot_map(
    axis: plt.Axes,
    layer: Layer,
    *,
    title: str,
    vmin: float,
    vmax: float,
) -> matplotlib.collections.PathCollection:
    valid = ~np.ma.getmaskarray(layer.plot_values)
    mesh = axis.scatter(
        layer.plot_longitude[valid],
        layer.plot_latitude[valid],
        c=np.asarray(layer.plot_values)[valid],
        cmap="YlGnBu",
        vmin=vmin,
        vmax=vmax,
        marker="s",
        s=2.2,
        linewidths=0,
        rasterized=True,
    )
    axis.set_title(title)
    axis.set_xlim(-180, 180)
    axis.set_ylim(-85.1, 85.1)
    axis.set_xlabel("Longitude (degrees east)")
    axis.set_ylabel("Latitude (degrees north)")
    axis.set_xticks(np.arange(-180, 181, 60))
    axis.set_yticks(np.arange(-60, 61, 30))
    axis.grid(color="0.82", linewidth=0.5, alpha=0.7)
    return mesh


def create_figure(
    am: Layer,
    pm: Layer,
    *,
    source_name: str,
    output_path: Path,
) -> None:
    vmin = max(am.valid_min, pm.valid_min)
    vmax = min(am.valid_max, pm.valid_max)
    if vmin >= vmax:
        raise ValueError("AM and PM valid ranges do not overlap")

    figure = plt.figure(figsize=(15, 9), constrained_layout=True)
    grid = figure.add_gridspec(2, 2, height_ratios=[2.1, 1.0])
    am_axis = figure.add_subplot(grid[0, 0])
    pm_axis = figure.add_subplot(grid[0, 1])
    histogram_axis = figure.add_subplot(grid[1, :])

    mesh = plot_map(
        am_axis,
        am,
        title="AM retrieval",
        vmin=vmin,
        vmax=vmax,
    )
    plot_map(
        pm_axis,
        pm,
        title="PM retrieval",
        vmin=vmin,
        vmax=vmax,
    )

    colorbar = figure.colorbar(mesh, ax=[am_axis, pm_axis], shrink=0.88, pad=0.02)
    colorbar.set_label(f"Volumetric soil moisture ({am.units})")

    bins = np.linspace(vmin, vmax, 61)
    for layer, color in ((am, "#1f77b4"), (pm, "#d95f02")):
        data = layer.values[layer.valid]
        weights = np.full(data.shape, 100.0 / data.size, dtype=np.float64)
        histogram_axis.hist(
            data,
            bins=bins,
            weights=weights,
            histtype="step",
            linewidth=1.8,
            label=layer.label,
            color=color,
        )

    histogram_axis.set_title("Distribution of all valid global-grid values")
    histogram_axis.set_xlabel(f"Volumetric soil moisture ({am.units})")
    histogram_axis.set_ylabel("Valid pixels per bin (%)")
    histogram_axis.set_xlim(vmin, vmax)
    histogram_axis.grid(axis="y", color="0.85", linewidth=0.6)
    histogram_axis.legend(frameon=False)

    figure.suptitle(f"SMAP SPL3SMP_E V006 soil moisture - {source_name}", fontsize=15)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, facecolor="white")
    plt.close(figure)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Visualize global AM/PM soil moisture from SPL3SMP_E V006."
    )
    parser.add_argument("--input", required=True, type=Path, help="Input HDF5 granule")
    parser.add_argument("--output", required=True, type=Path, help="Output PNG path")
    parser.add_argument(
        "--stride",
        type=positive_int,
        default=4,
        help="Map sampling stride; statistics always use every grid cell (default: 4)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()

    if not input_path.is_file():
        raise FileNotFoundError(f"Input HDF5 file does not exist: {input_path}")

    with h5py.File(input_path, "r") as h5_file:
        am = read_layer(
            h5_file,
            group_name=AM_GROUP,
            value_name="soil_moisture",
            longitude_name="longitude",
            latitude_name="latitude",
            label="AM",
            stride=args.stride,
        )
        pm = read_layer(
            h5_file,
            group_name=PM_GROUP,
            value_name="soil_moisture_pm",
            longitude_name="longitude_pm",
            latitude_name="latitude_pm",
            label="PM",
            stride=args.stride,
        )

    if am.values.shape != pm.values.shape:
        raise ValueError(f"AM/PM shape mismatch: AM={am.values.shape}, PM={pm.values.shape}")

    print(f"Input: {input_path}")
    print(f"Grid shape: {am.values.shape[0]} x {am.values.shape[1]}")
    print(f"Map sampling stride: {args.stride}")
    print_statistics(am, statistics(am))
    print_statistics(pm, statistics(pm))

    create_figure(am, pm, source_name=input_path.name, output_path=output_path)
    print(f"Saved visualization: {output_path}")


if __name__ == "__main__":
    main()
