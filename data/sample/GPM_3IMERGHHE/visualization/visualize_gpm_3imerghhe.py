#!/usr/bin/env python3
"""Visualize one GPM IMERG Early half-hourly precipitation granule."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re

import h5py
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap, LogNorm
from matplotlib.patches import Patch
import numpy as np


VARIABLES = (
    "precipitation",
    "randomError",
    "probabilityLiquidPrecipitation",
    "precipitationQualityIndex",
)
EXPECTED_SHAPE = (1, 3600, 1800)
MISSING_COLOR = "#9ca3af"
DRY_COLOR = "#f3f4f6"


@dataclass
class Layer:
    values: np.ndarray
    valid: np.ndarray
    units: str
    long_name: str


@dataclass
class Granule:
    path: Path
    longitude: np.ndarray
    latitude: np.ndarray
    extent: tuple[float, float, float, float]
    layers: dict[str, Layer]
    header: dict[str, str]
    filename_version: str


def text(value: object) -> str:
    if isinstance(value, (bytes, np.bytes_)):
        return bytes(value).decode("utf-8")
    return str(value)


def parse_header(value: object) -> dict[str, str]:
    fields = {}
    for item in text(value).replace("\n", "").split(";"):
        if "=" in item:
            key, field_value = item.split("=", 1)
            fields[key.strip()] = field_value.strip()
    return fields


def read_layer(grid: h5py.Group, name: str) -> Layer:
    if name not in grid:
        raise ValueError(f"Missing required dataset: Grid/{name}")
    dataset = grid[name]
    if dataset.shape != EXPECTED_SHAPE:
        raise ValueError(
            f"Grid/{name}: expected shape {EXPECTED_SHAPE}, found {dataset.shape}"
        )
    dimension_names = text(dataset.attrs.get("DimensionNames", ""))
    if dimension_names.replace(" ", "") != "time,lon,lat":
        raise ValueError(
            f"Grid/{name}: expected dimensions time,lon,lat, found {dimension_names!r}"
        )
    if "_FillValue" not in dataset.attrs:
        raise ValueError(f"Grid/{name}: missing _FillValue attribute")

    source_values = dataset[0]
    fill_value = dataset.attrs["_FillValue"]
    source_valid = np.isfinite(source_values) & (source_values != fill_value)

    # IMERG stores each time slice as (lon, lat); image rows must be latitude.
    values = source_values.T
    valid = source_valid.T
    return Layer(
        values=values,
        valid=valid,
        units=text(dataset.attrs.get("units", dataset.attrs.get("Units", ""))),
        long_name=" ".join(text(dataset.attrs.get("LongName", name)).split()),
    )


def read_granule(path: Path) -> Granule:
    if not path.is_file():
        raise ValueError(f"Input file does not exist: {path}")

    with h5py.File(path, "r") as file:
        if "Grid" not in file:
            raise ValueError("Missing required group: Grid")
        grid = file["Grid"]
        for name in ("lon", "lat", "lon_bnds", "lat_bnds", "time", "time_bnds"):
            if name not in grid:
                raise ValueError(f"Missing required dataset: Grid/{name}")

        longitude = np.asarray(grid["lon"][...], dtype=np.float64)
        latitude = np.asarray(grid["lat"][...], dtype=np.float64)
        if longitude.shape != (3600,) or latitude.shape != (1800,):
            raise ValueError(
                "Expected 3600 longitude centers and 1800 latitude centers, found "
                f"{longitude.shape} and {latitude.shape}"
            )
        for label, coordinates in (("longitude", longitude), ("latitude", latitude)):
            if not np.isfinite(coordinates).all() or not np.all(np.diff(coordinates) > 0):
                raise ValueError(f"{label} centers must be finite and strictly increasing")
            if not np.allclose(np.diff(coordinates), 0.1, rtol=0, atol=2e-5):
                raise ValueError(f"{label} grid spacing is not consistently 0.1 degrees")

        lon_bounds = np.asarray(grid["lon_bnds"][...], dtype=np.float64)
        lat_bounds = np.asarray(grid["lat_bnds"][...], dtype=np.float64)
        if lon_bounds.shape != (3600, 2) or lat_bounds.shape != (1800, 2):
            raise ValueError("Longitude/latitude bounds have unexpected shapes")
        extent = (
            float(lon_bounds[0, 0]),
            float(lon_bounds[-1, 1]),
            float(lat_bounds[0, 0]),
            float(lat_bounds[-1, 1]),
        )
        if not np.allclose(extent, (-180, 180, -90, 90), atol=2e-5):
            raise ValueError(f"Expected global bounds (-180, 180, -90, 90), found {extent}")

        layers = {name: read_layer(grid, name) for name in VARIABLES}
        expected_units = {
            "precipitation": "mm/hr",
            "randomError": "mm/hr",
            "probabilityLiquidPrecipitation": "percent",
        }
        for name, expected in expected_units.items():
            if layers[name].units != expected:
                raise ValueError(
                    f"Grid/{name}: expected units {expected!r}, found {layers[name].units!r}"
                )

        header = parse_header(file.attrs.get("FileHeader", ""))
        if header.get("TimeInterval") != "HALF_HOUR":
            raise ValueError(
                f"Expected HALF_HOUR granule, found {header.get('TimeInterval')!r}"
            )
        time_bounds = np.asarray(grid["time_bnds"][...])
        if time_bounds.shape != (1, 2) or int(time_bounds[0, 1] - time_bounds[0, 0]) != 1800:
            raise ValueError("Grid/time_bnds does not describe one 30-minute interval")

    version_match = re.search(r"\.(V\d+[A-Z])\.HDF5$", path.name, re.IGNORECASE)
    filename_version = version_match.group(1).upper() if version_match else "unknown"
    return Granule(path, longitude, latitude, extent, layers, header, filename_version)


def summary_stats(label: str, values: np.ndarray, units: str) -> None:
    if not values.size:
        print(f"{label}: no values")
        return
    p05, median, p95 = np.percentile(values, [5, 50, 95])
    print(
        f"{label}: n={values.size:,}; min={values.min():.6f}, "
        f"max={values.max():.6f}, mean={np.mean(values, dtype=np.float64):.6f}, "
        f"median={median:.6f}, p05={p05:.6f}, p95={p95:.6f} {units}"
    )


def report(granule: Granule) -> None:
    precipitation = granule.layers["precipitation"]
    rain = precipitation.valid & (precipitation.values > 0)
    dry = precipitation.valid & ~rain
    total = precipitation.values.size
    print(f"Input: {granule.path.resolve()}")
    print(f"Grid: latitude={granule.latitude.size}, longitude={granule.longitude.size}; 0.1° global")
    print(
        f"Time: {granule.header.get('StartGranuleDateTime', 'unknown')} to "
        f"{granule.header.get('StopGranuleDateTime', 'unknown')}"
    )
    print(
        f"Filename revision: {granule.filename_version}; "
        f"header ProductVersion: {granule.header.get('ProductVersion', 'unknown')}"
    )
    print(
        f"Precipitation pixels: valid={precipitation.valid.sum():,}/{total:,} "
        f"({precipitation.valid.mean():.6%}), missing={(~precipitation.valid).sum():,}, "
        f"dry={dry.sum():,}, rain={rain.sum():,} "
        f"({rain.sum() / precipitation.valid.sum():.6%} of valid)"
    )
    summary_stats(
        "Precipitation rate (all valid)",
        precipitation.values[precipitation.valid],
        "mm/hr",
    )
    summary_stats("Precipitation rate (rain only)", precipitation.values[rain], "mm/hr")
    summary_stats("Half-hour accumulation (rain only)", precipitation.values[rain] * 0.5, "mm")

    for name, label in (
        ("randomError", "Random error"),
        ("probabilityLiquidPrecipitation", "Probability of liquid precipitation"),
        ("precipitationQualityIndex", "Precipitation quality index"),
    ):
        layer = granule.layers[name]
        units = layer.units or "unitless"
        summary_stats(label, layer.values[layer.valid], units)


def configure_map(axis: plt.Axes, title: str) -> None:
    axis.set(
        title=title,
        xlabel="Longitude (°E)",
        ylabel="Latitude (°N)",
        xlim=(-180, 180),
        ylim=(-90, 90),
        aspect="equal",
    )
    axis.set_xticks(np.arange(-180, 181, 60))
    axis.set_yticks(np.arange(-90, 91, 30))
    axis.grid(color="#ffffff", alpha=0.18, linewidth=0.4)


def render(granule: Granule, output: Path) -> None:
    layers = granule.layers
    precipitation = layers["precipitation"]
    rain = precipitation.valid & (precipitation.values > 0)
    dry = precipitation.valid & ~rain
    rain_values = precipitation.values[rain]
    extent = granule.extent

    figure, axes = plt.subplots(2, 3, figsize=(18, 10.5), layout="constrained")

    base = np.zeros(precipitation.values.shape, dtype=np.uint8)
    base[dry] = 1
    base_cmap = ListedColormap((MISSING_COLOR, DRY_COLOR))
    axes[0, 0].imshow(
        base,
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=base_cmap,
        norm=BoundaryNorm([-0.5, 0.5, 1.5], 2),
    )
    rain_cmap = plt.get_cmap("YlGnBu").copy()
    rain_image = axes[0, 0].imshow(
        np.ma.array(precipitation.values, mask=~rain),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=rain_cmap,
        norm=LogNorm(vmin=max(0.01, float(rain_values.min())),
                     vmax=float(np.percentile(rain_values, 99.9))),
    )
    configure_map(axes[0, 0], f"Precipitation rate\n{rain.sum():,} raining grid cells")
    figure.colorbar(
        rain_image,
        ax=axes[0, 0],
        label="Precipitation rate (mm/hr)",
        extend="max",
        shrink=0.86,
        pad=0.02,
    )
    axes[0, 0].legend(
        handles=(
            Patch(facecolor=DRY_COLOR, edgecolor="#d1d5db", label="Valid, no rain"),
            Patch(facecolor=MISSING_COLOR, label="Missing"),
        ),
        loc="lower left",
        frameon=True,
        fontsize=8,
    )

    error = layers["randomError"]
    error_values = error.values[error.valid]
    error_cmap = plt.get_cmap("magma").copy()
    error_cmap.set_bad(MISSING_COLOR)
    error_image = axes[0, 1].imshow(
        np.ma.array(error.values, mask=~error.valid),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=error_cmap,
        norm=LogNorm(
            vmin=float(np.percentile(error_values, 1)),
            vmax=float(np.percentile(error_values, 99)),
        ),
    )
    configure_map(axes[0, 1], "Random error estimate")
    figure.colorbar(
        error_image,
        ax=axes[0, 1],
        label="Random error (mm/hr)",
        extend="max",
        shrink=0.86,
        pad=0.02,
    )

    liquid = layers["probabilityLiquidPrecipitation"]
    liquid_rain = liquid.valid & rain
    liquid_cmap = plt.get_cmap("coolwarm").copy()
    liquid_cmap.set_bad(DRY_COLOR)
    liquid_image = axes[0, 2].imshow(
        np.ma.array(liquid.values, mask=~liquid_rain),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=liquid_cmap,
        vmin=0,
        vmax=100,
    )
    configure_map(axes[0, 2], "Probability of liquid precipitation\n(raining grid cells only)")
    figure.colorbar(
        liquid_image,
        ax=axes[0, 2],
        label="Probability (%)",
        shrink=0.86,
        pad=0.02,
    )

    quality = layers["precipitationQualityIndex"]
    quality_cmap = plt.get_cmap("viridis").copy()
    quality_cmap.set_bad(MISSING_COLOR)
    quality_image = axes[1, 0].imshow(
        np.ma.array(quality.values, mask=~quality.valid),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=quality_cmap,
        vmin=0,
        vmax=1,
    )
    configure_map(axes[1, 0], "Precipitation quality index\n(qualitative; no threshold applied)")
    figure.colorbar(
        quality_image,
        ax=axes[1, 0],
        label="Quality index",
        shrink=0.86,
        pad=0.02,
    )

    histogram = axes[1, 1]
    bins = np.geomspace(float(rain_values.min()), float(rain_values.max()), 81)
    counts, edges = np.histogram(rain_values, bins=bins)
    if int(counts.sum()) != rain_values.size:
        raise ValueError("Rain-rate histogram did not include every raining pixel")
    histogram.stairs(counts / rain_values.size * 100, edges, color="#0072b2", linewidth=1.7)
    histogram.set_xscale("log")
    histogram.set(
        title="Rain-rate distribution",
        xlabel="Precipitation rate (mm/hr, logarithmic scale)",
        ylabel="Raining grid cells per bin (%)",
        xlim=(edges[0], edges[-1]),
    )
    histogram.grid(alpha=0.25, which="both", linewidth=0.5)
    histogram.text(
        0.98,
        0.95,
        f"Rain: {rain_values.size:,}\nDry: {dry.sum():,}\n"
        f"Half-hour max: {rain_values.max() * 0.5:.2f} mm",
        transform=histogram.transAxes,
        ha="right",
        va="top",
        fontsize=9,
    )
    print(f"Histogram rain rate: {counts.sum():,} pixels (all raining values included)")

    zonal = axes[1, 2]
    source_values = precipitation.values
    valid_count = precipitation.valid.sum(axis=1)
    zonal_total = np.where(precipitation.valid, source_values, 0).sum(axis=1, dtype=np.float64)
    zonal_mean = np.divide(
        zonal_total,
        valid_count,
        out=np.full(granule.latitude.shape, np.nan),
        where=valid_count > 0,
    )
    zonal_rain_fraction = np.divide(
        rain.sum(axis=1) * 100,
        valid_count,
        out=np.full(granule.latitude.shape, np.nan),
        where=valid_count > 0,
    )
    mean_line = zonal.plot(
        granule.latitude,
        zonal_mean,
        color="#0072b2",
        linewidth=1.4,
        label="Mean precipitation rate",
    )[0]
    coverage_axis = zonal.twinx()
    coverage_line = coverage_axis.plot(
        granule.latitude,
        zonal_rain_fraction,
        color="#d55e00",
        linewidth=1.2,
        label="Raining coverage",
    )[0]
    zonal.set(
        title="Zonal precipitation and rain coverage",
        xlabel="Latitude (°N)",
        ylabel="Mean precipitation rate (mm/hr)",
        xlim=(-90, 90),
    )
    zonal.set_xticks(np.arange(-90, 91, 30))
    coverage_axis.set_ylabel("Raining grid cells (%)")
    coverage_axis.set_ylim(bottom=0)
    zonal.grid(alpha=0.25, linewidth=0.5)
    zonal.legend(
        (mean_line, coverage_line),
        (mean_line.get_label(), coverage_line.get_label()),
        loc="upper left",
        frameon=False,
        fontsize=8.5,
    )

    start = granule.header.get("StartGranuleDateTime", "unknown")
    stop = granule.header.get("StopGranuleDateTime", "unknown")
    try:
        start_text = datetime.fromisoformat(start.replace("Z", "+00:00")).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        stop_text = datetime.fromisoformat(stop.replace("Z", "+00:00")).strftime(
            "%H:%M:%S UTC"
        )
        period = f"{start_text}–{stop_text}"
    except ValueError:
        period = f"{start}–{stop}"

    figure.suptitle(
        f"GPM IMERG Early half-hourly precipitation — {period}\n"
        f"Filename {granule.filename_version}; metadata ProductVersion "
        f"{granule.header.get('ProductVersion', 'unknown')}",
        fontsize=16,
    )
    figure.supxlabel(
        "Global 0.1° grid. Precipitation is a rate in mm/hr; half-hour accumulation = rate × 0.5 hr. "
        "No spatial interpolation.",
        fontsize=10,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=180, facecolor="white")
    plt.close(figure)
    print(f"Saved: {output.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="IMERG half-hourly HDF5 granule")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG")
    args = parser.parse_args()

    try:
        if args.output.suffix.lower() != ".png":
            raise ValueError("Output must use a .png extension")
        granule = read_granule(args.input)
        report(granule)
        render(granule, args.output)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
