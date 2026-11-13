#!/usr/bin/env python3
"""Plot global SPL4SMGP soil moisture without modifying the source granule."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import h5py
import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt


VARIABLES = (
    ("sm_surface", "Surface (0–5 cm)"),
    ("sm_rootzone", "Root zone (0–100 cm)"),
    ("sm_profile", "Profile (surface to model bedrock)"),
)


@dataclass
class Layer:
    name: str
    label: str
    values: np.ndarray
    valid: np.ndarray
    out_of_range: int
    valid_min: float
    valid_max: float


def text(value: object) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("stride must be a positive integer")
    return number


def coordinate_edges(centers: np.ndarray) -> np.ndarray:
    """Infer edges from sampled centers, preserving nonuniform latitude spacing."""
    if centers.size < 2:
        raise ValueError("At least two coordinate centers are required")
    edges = np.empty(centers.size + 1, dtype=np.float64)
    edges[1:-1] = (centers[:-1] + centers[1:]) / 2
    edges[0] = centers[0] - (centers[1] - centers[0]) / 2
    edges[-1] = centers[-1] + (centers[-1] - centers[-2]) / 2
    return edges


def read_input(path: Path) -> tuple[np.ndarray, np.ndarray, list[Layer], str, str]:
    with h5py.File(path, "r") as file:
        for name in ("cell_lon", "cell_lat", "Metadata/Extent", "Metadata/DatasetIdentification"):
            if name not in file:
                raise ValueError(f"Missing required HDF5 object: {name}")
        longitude = file["cell_lon"][...]
        latitude = file["cell_lat"][...]
        if longitude.ndim != 2 or min(longitude.shape) < 2 or latitude.shape != longitude.shape:
            raise ValueError("Coordinates must be matching 2-D grids with at least two rows/columns")
        if not np.isfinite(longitude).all() or not np.isfinite(latitude).all():
            raise ValueError("Coordinates contain nonfinite values")
        if np.any(np.abs(longitude) > 180) or np.any(np.abs(latitude) > 90):
            raise ValueError("Coordinates contain fill or out-of-range values")
        lon = longitude[0, :].astype(np.float64)
        lat = latitude[:, 0].astype(np.float64)
        if not np.allclose(longitude, lon[None, :], atol=1e-5):
            raise ValueError("Longitude is not constant along each grid column")
        if not np.allclose(latitude, lat[:, None], atol=1e-5):
            raise ValueError("Latitude is not constant along each grid row")
        for name, coord in (("longitude", lon), ("latitude", lat)):
            delta = np.diff(coord)
            if not (np.all(delta > 0) or np.all(delta < 0)):
                raise ValueError(f"{name} centers are not strictly monotonic")

        layers = []
        for name, label in VARIABLES:
            path_name = f"Geophysical_Data/{name}"
            if path_name not in file:
                raise ValueError(f"Missing required variable: {path_name}")
            dataset = file[path_name]
            if dataset.shape != longitude.shape:
                raise ValueError(f"Shape mismatch for {name}: {dataset.shape}")
            values = np.asarray(dataset[...], dtype=np.float32)
            base_valid = np.isfinite(values)
            for key in ("_FillValue", "missing_value", "fmissing_value"):
                if key in dataset.attrs:
                    base_valid &= values != dataset.attrs[key]
            lower = float(dataset.attrs["valid_min"])
            upper = float(dataset.attrs["valid_max"])
            within_range = (values >= lower) & (values <= upper)
            valid = base_valid & within_range
            if not np.any(valid):
                raise ValueError(f"No valid values for {name}")
            layers.append(Layer(name, label, values, valid,
                                int(np.count_nonzero(base_valid & ~within_range)),
                                lower, upper))

        extent = file["Metadata/Extent"].attrs
        start = datetime.fromisoformat(text(extent["rangeBeginningDateTime"]).replace("Z", "+00:00"))
        end = datetime.fromisoformat(text(extent["rangeEndingDateTime"]).replace("Z", "+00:00"))
        period = f"{start:%Y-%m-%d %H:%M} to {end:%Y-%m-%d %H:%M} UTC"
        version = text(file["Metadata/DatasetIdentification"].attrs["ECSVersionID"])
    return lon, lat, layers, version, period


def summarize(layer: Layer) -> None:
    values = layer.values[layer.valid]
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    print(f"{layer.name}: {layer.label}")
    print(f"  valid pixels: {values.size:,} / {layer.values.size:,} "
          f"({values.size / layer.values.size:.2%} of full grid)")
    print(f"  out-of-range pixels: {layer.out_of_range:,}")
    print(f"  mean={np.mean(values, dtype=np.float64):.6f}, median={median:.6f}, "
          f"p05={p05:.6f}, p95={p95:.6f} m³/m³")
    print(f"  min={values.min():.6f}, max={values.max():.6f} m³/m³")


def render(lon: np.ndarray, lat: np.ndarray, layers: list[Layer],
           version: str, period: str, stride: int, output: Path) -> None:
    if len(lon[::stride]) < 2 or len(lat[::stride]) < 2:
        raise ValueError("stride leaves fewer than two rows or columns for rendering")
    lon_edges = np.clip(coordinate_edges(lon[::stride]), -180, 180)
    lat_edges = np.clip(coordinate_edges(lat[::stride]), -85.04456, 85.04456)
    lower, upper = 0.0, 0.9
    figure = plt.figure(figsize=(18, 9), layout="constrained")
    grid = figure.add_gridspec(2, 3, height_ratios=[1.5, 1])
    axes = [figure.add_subplot(grid[0, index]) for index in range(3)]
    histogram = figure.add_subplot(grid[1, :])
    cmap = plt.get_cmap("YlGnBu").copy()
    cmap.set_bad("#eeeeee")

    for axis, layer in zip(axes, layers, strict=True):
        sampled = np.ma.array(layer.values[::stride, ::stride],
                              mask=~layer.valid[::stride, ::stride])
        mesh = axis.pcolormesh(lon_edges, lat_edges, sampled, shading="flat",
                               cmap=cmap, vmin=lower, vmax=upper, rasterized=True)
        axis.set(title=layer.label, xlabel="Longitude (°E)",
                 xlim=(-180, 180), ylim=(-85.04456, 85.04456))
        axis.set_xticks(np.arange(-180, 181, 90))
        axis.set_yticks(np.arange(-60, 61, 30))
        axis.set_ylabel("Latitude (°N)")
        axis.grid(alpha=0.25, linewidth=0.5)
    figure.colorbar(mesh, ax=axes, shrink=0.85, pad=0.015,
                    label="Volumetric soil moisture (m³/m³)")

    bins = np.linspace(lower, upper, 91)
    for layer, color in zip(layers, ("#0072b2", "#d55e00", "#009e73"), strict=True):
        data = layer.values[layer.valid]
        counts, _ = np.histogram(data, bins=bins)
        histogram.stairs(counts / data.size * 100, bins, label=layer.label,
                         color=color, linewidth=1.8)
    histogram.set(title="Distribution of all valid grid cells",
                  xlabel="Volumetric soil moisture (m³/m³)",
                  ylabel="Valid pixels per bin (%)", xlim=(lower, upper))
    histogram.grid(axis="y", alpha=0.3, linewidth=0.6)
    histogram.legend(frameon=False)
    figure.suptitle(f"SMAP SPL4SMGP V{version} — 3-hour mean soil moisture\n{period}",
                   fontsize=16)
    figure.supxlabel(f"Map sampling stride: {stride}; full-resolution statistics. "
                     "Gray: no valid data; no interpolation. QA flags not applied.", fontsize=10)
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=180, facecolor="white")
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="SPL4SMGP HDF5 granule")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG")
    parser.add_argument("--stride", type=positive_int, default=4,
                        help="Map sampling stride (default: 4); statistics use all cells")
    args = parser.parse_args()
    source, output = args.input.expanduser().resolve(), args.output.expanduser().resolve()
    if source == output:
        parser.error("output must differ from the source HDF5 file")
    if output.suffix.lower() != ".png":
        parser.error("output must have a .png extension")
    lon, lat, layers, version, period = read_input(source)
    print(f"Input: {source}\nVersion: {version}\nPeriod: {period}")
    print(f"Grid: {lat.size} x {lon.size}; map stride: {args.stride}")
    for layer in layers:
        summarize(layer)
    render(lon, lat, layers, version, period, args.stride, output)
    print(f"Saved: {output}")


if __name__ == "__main__":
    main()
