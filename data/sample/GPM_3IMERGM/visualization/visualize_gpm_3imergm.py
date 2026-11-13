#!/usr/bin/env python3
"""Visualize one GPM IMERG Final monthly precipitation granule."""

from __future__ import annotations

import argparse
import calendar
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
    "gaugeRelativeWeighting",
)
EXPECTED_SHAPE = (1, 3600, 1800)
MISSING_COLOR = "#9ca3af"
ZERO_COLOR = "#f3f4f6"


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
    start: datetime
    end: datetime
    days: int
    hours: int
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


def validate_month_period(
    start: datetime, end: datetime, time_bounds: np.ndarray
) -> tuple[int, int]:
    days = calendar.monthrange(start.year, start.month)[1]
    expected_seconds = days * 86400
    actual_seconds = (end - start).total_seconds() + 0.001
    if (
        start.day != 1
        or start.hour != 0
        or start.minute != 0
        or start.second != 0
        or end.year != start.year
        or end.month != start.month
        or end.day != days
        or not np.isclose(actual_seconds, expected_seconds, atol=0.01)
    ):
        raise ValueError(
            f"Expected one complete calendar month, found {actual_seconds} seconds"
        )
    if time_bounds.shape != (1, 2):
        raise ValueError(f"Expected time_bnds shape (1, 2), found {time_bounds.shape}")
    if int(time_bounds[0, 1] - time_bounds[0, 0]) != expected_seconds:
        raise ValueError("Grid/time_bnds does not match the complete calendar month")
    return days, days * 24


def read_layer(grid: h5py.Group, name: str) -> Layer:
    if name not in grid:
        raise ValueError(f"Missing required dataset: Grid/{name}")
    dataset = grid[name]
    if dataset.shape != EXPECTED_SHAPE:
        raise ValueError(
            f"Grid/{name}: expected shape {EXPECTED_SHAPE}, found {dataset.shape}"
        )
    dimensions = text(dataset.attrs.get("DimensionNames", ""))
    if dimensions.replace(" ", "") != "time,lon,lat":
        raise ValueError(
            f"Grid/{name}: expected dimensions time,lon,lat, found {dimensions!r}"
        )
    if "_FillValue" not in dataset.attrs:
        raise ValueError(f"Grid/{name}: missing _FillValue attribute")

    source_values = dataset[0]
    fill_value = dataset.attrs["_FillValue"]
    source_valid = np.isfinite(source_values) & (source_values != fill_value)
    return Layer(
        values=source_values.T,
        valid=source_valid.T,
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
        for name in ("lon", "lat", "lon_bnds", "lat_bnds", "time_bnds"):
            if name not in grid:
                raise ValueError(f"Missing required dataset: Grid/{name}")

        header = parse_header(file.attrs.get("FileHeader", ""))
        if header.get("DOIshortName") != "3IMERGM":
            raise ValueError(
                "Expected GPM_3IMERGM V07 Final monthly product, found "
                f"DOIshortName={header.get('DOIshortName')!r}"
            )
        if header.get("ProcessingSystem") != "PPS":
            raise ValueError(
                "Expected Final Run ProcessingSystem='PPS', found "
                f"{header.get('ProcessingSystem')!r}"
            )
        if header.get("TimeInterval") != "MONTH":
            raise ValueError(
                f"Expected MONTH product, found {header.get('TimeInterval')!r}"
            )

        try:
            start = datetime.fromisoformat(
                header["StartGranuleDateTime"].replace("Z", "+00:00")
            )
            end = datetime.fromisoformat(
                header["StopGranuleDateTime"].replace("Z", "+00:00")
            )
        except (KeyError, ValueError) as exc:
            raise ValueError("Invalid or missing granule start/stop metadata") from exc
        time_bounds = np.asarray(grid["time_bnds"][...], dtype=np.int64)
        days, hours = validate_month_period(start, end, time_bounds)

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
                raise ValueError(f"{label} spacing is not consistently 0.1 degrees")

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
            "gaugeRelativeWeighting": "percent",
        }
        for name, expected in expected_units.items():
            if layers[name].units != expected:
                raise ValueError(
                    f"Grid/{name}: expected units {expected!r}, found {layers[name].units!r}"
                )

    version_match = re.search(r"\.(V\d+[A-Z])\.HDF5$", path.name, re.IGNORECASE)
    filename_version = version_match.group(1).upper() if version_match else "unknown"
    header_version = header.get("ProductVersion", "unknown")
    if filename_version != header_version:
        raise ValueError(
            f"Filename version {filename_version} differs from metadata {header_version}"
        )
    return Granule(
        path,
        longitude,
        latitude,
        extent,
        layers,
        header,
        start,
        end,
        days,
        hours,
        filename_version,
    )


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
    layers = granule.layers
    precipitation = layers["precipitation"]
    wet = precipitation.valid & (precipitation.values > 0)
    total = precipitation.values.size
    accumulation = precipitation.values * granule.hours

    print(f"Input: {granule.path.resolve()}")
    print(f"Grid: latitude={granule.latitude.size}, longitude={granule.longitude.size}; 0.1° global")
    print(f"Time: {granule.start.isoformat()} to {granule.end.isoformat()}")
    print(
        f"Version: {granule.filename_version}; period={granule.days} days / "
        f"{granule.hours} hours; generation={granule.header.get('GenerationDateTime', 'unknown')}"
    )
    print(
        f"Precipitation: valid={precipitation.valid.sum():,}/{total:,} "
        f"({precipitation.valid.mean():.6%}), missing={(~precipitation.valid).sum():,}, "
        f"positive={wet.sum():,} ({wet.sum() / precipitation.valid.sum():.6%} of valid)"
    )
    summary_stats(
        "Monthly mean precipitation rate (all valid)",
        precipitation.values[precipitation.valid],
        "mm/hr",
    )
    summary_stats(
        "Monthly mean precipitation rate (positive)",
        precipitation.values[wet],
        "mm/hr",
    )
    summary_stats("Derived monthly accumulation (positive)", accumulation[wet], "mm")

    for name, label, units in (
        ("randomError", "Monthly mean random error", "mm/hr"),
        ("probabilityLiquidPrecipitation", "Probability of liquid precipitation", "%"),
        ("gaugeRelativeWeighting", "Gauge relative weighting", "%"),
        ("precipitationQualityIndex", "Raw precipitation quality index", "unitless"),
    ):
        layer = layers[name]
        selection = layer.valid & wet if name == "probabilityLiquidPrecipitation" else layer.valid
        summary_stats(label, layer.values[selection], units)


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
    wet = precipitation.valid & (precipitation.values > 0)
    dry = precipitation.valid & ~wet
    accumulation = precipitation.values * granule.hours
    accumulation_values = accumulation[wet]
    extent = granule.extent

    figure, axes = plt.subplots(2, 3, figsize=(18, 10.5), layout="constrained")

    base = np.zeros(precipitation.values.shape, dtype=np.uint8)
    base[dry] = 1
    axes[0, 0].imshow(
        base,
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=ListedColormap((MISSING_COLOR, ZERO_COLOR)),
        norm=BoundaryNorm([-0.5, 0.5, 1.5], 2),
    )
    precipitation_cmap = plt.get_cmap("YlGnBu").copy()
    accumulation_image = axes[0, 0].imshow(
        np.ma.array(accumulation, mask=~wet),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=precipitation_cmap,
        norm=LogNorm(
            vmin=float(accumulation_values.min()),
            vmax=float(np.percentile(accumulation_values, 99.9)),
        ),
    )
    configure_map(axes[0, 0], f"Derived monthly precipitation accumulation\n{wet.sum():,} positive grid cells")
    figure.colorbar(
        accumulation_image,
        ax=axes[0, 0],
        label="Monthly precipitation accumulation (mm)",
        extend="max",
        shrink=0.86,
        pad=0.02,
    )
    axes[0, 0].legend(
        handles=(
            Patch(facecolor=ZERO_COLOR, edgecolor="#d1d5db", label="Valid, zero"),
            Patch(facecolor=MISSING_COLOR, label="Missing"),
        ),
        loc="lower left",
        frameon=True,
        fontsize=8,
    )

    error = layers["randomError"]
    positive_error = error.valid & (error.values > 0)
    error_values = error.values[positive_error]
    error_image = axes[0, 1].imshow(
        np.ma.array(error.values, mask=~positive_error),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap="magma",
        norm=LogNorm(
            vmin=float(np.percentile(error_values, 1)),
            vmax=float(np.percentile(error_values, 99)),
        ),
    )
    configure_map(axes[0, 1], "Monthly mean random error\n(logarithmic color scale)")
    figure.colorbar(
        error_image,
        ax=axes[0, 1],
        label="Random error (mm/hr)",
        extend="both",
        shrink=0.86,
        pad=0.02,
    )

    liquid = layers["probabilityLiquidPrecipitation"]
    liquid_wet = liquid.valid & wet
    liquid_cmap = plt.get_cmap("coolwarm").copy()
    liquid_cmap.set_bad(ZERO_COLOR)
    liquid_image = axes[0, 2].imshow(
        np.ma.array(liquid.values, mask=~liquid_wet),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=liquid_cmap,
        vmin=0,
        vmax=100,
    )
    configure_map(axes[0, 2], "Probability of liquid precipitation\n(positive precipitation cells only)")
    figure.colorbar(
        liquid_image,
        ax=axes[0, 2],
        label="Probability (%)",
        shrink=0.86,
        pad=0.02,
    )

    gauge = layers["gaugeRelativeWeighting"]
    gauge_cmap = plt.get_cmap("viridis").copy()
    gauge_cmap.set_bad(MISSING_COLOR)
    gauge_image = axes[1, 0].imshow(
        np.ma.array(gauge.values, mask=~gauge.valid),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=gauge_cmap,
        vmin=0,
        vmax=100,
    )
    configure_map(axes[1, 0], "Gauge relative weighting")
    figure.colorbar(
        gauge_image,
        ax=axes[1, 0],
        label="Gauge contribution weight (%)",
        shrink=0.86,
        pad=0.02,
    )

    quality = layers["precipitationQualityIndex"]
    quality_values = quality.values[quality.valid]
    quality_image = axes[1, 1].imshow(
        np.ma.array(quality.values, mask=~quality.valid),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap="plasma",
        norm=LogNorm(
            vmin=float(np.percentile(quality_values, 1)),
            vmax=float(np.percentile(quality_values, 99)),
        ),
    )
    configure_map(axes[1, 1], "Raw precipitation quality index\n(qualitative; no threshold applied)")
    figure.colorbar(
        quality_image,
        ax=axes[1, 1],
        label="Raw quality index",
        extend="both",
        shrink=0.86,
        pad=0.02,
    )

    histogram = axes[1, 2]
    bins = np.geomspace(
        float(accumulation_values.min()), float(accumulation_values.max()), 81
    )
    counts, edges = np.histogram(accumulation_values, bins=bins)
    if int(counts.sum()) != accumulation_values.size:
        raise ValueError("Histogram did not include every positive accumulation value")
    histogram.stairs(
        counts / accumulation_values.size * 100,
        edges,
        color="#0072b2",
        linewidth=1.7,
    )
    histogram.set_xscale("log")
    histogram.set(
        title="Positive monthly accumulation distribution",
        xlabel="Derived monthly precipitation accumulation (mm, logarithmic scale)",
        ylabel="Positive grid cells per bin (%)",
        xlim=(edges[0], edges[-1]),
    )
    histogram.grid(alpha=0.25, which="both", linewidth=0.5)
    histogram.text(
        0.98,
        0.95,
        f"n={accumulation_values.size:,}\nMean={np.mean(accumulation_values):.2f} mm\n"
        f"Max={accumulation_values.max():.2f} mm",
        transform=histogram.transAxes,
        ha="right",
        va="top",
        fontsize=9,
    )
    print(
        f"Histogram monthly accumulation: {counts.sum():,} pixels "
        "(all positive values included)"
    )

    period = (
        f"{granule.start:%Y-%m-%d %H:%M:%S}–"
        f"{granule.end:%Y-%m-%d %H:%M:%S UTC}"
    )
    figure.suptitle(
        f"GPM IMERG Final monthly precipitation — {period}\n"
        f"{granule.filename_version}; {granule.days} days / {granule.hours} hours",
        fontsize=16,
    )
    figure.supxlabel(
        f"Global 0.1° grid. Source precipitation is a monthly mean rate in mm/hr; "
        f"accumulation = rate × {granule.hours} hr. No spatial interpolation.",
        fontsize=10,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=180, facecolor="white")
    plt.close(figure)
    print(f"Saved: {output.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="IMERG Final monthly HDF5 granule")
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
