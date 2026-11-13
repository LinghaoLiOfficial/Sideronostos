#!/usr/bin/env python3
"""Visualize one GPM IMERG Final daily precipitation granule."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap, LogNorm
from matplotlib.patches import Patch
from netCDF4 import Dataset
import numpy as np


VARIABLES = (
    "precipitation",
    "MWprecipitation",
    "randomError",
    "probabilityLiquidPrecipitation",
    "precipitation_cnt",
    "precipitation_cnt_cond",
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
    layers: dict[str, Layer]
    start: datetime
    end: datetime
    production_time: str
    source_count: int
    version: str


def parse_datetime(date_value: str, time_value: str) -> datetime:
    return datetime.fromisoformat(f"{date_value}T{time_value}".replace("Z", "+00:00"))


def validate_daily_period(start: datetime, end: datetime, time_bounds: np.ndarray) -> None:
    duration = (end - start).total_seconds()
    if start.date() != end.date() or not 86399 <= duration <= 86400:
        raise ValueError(f"Expected one UTC day, found duration={duration} seconds")
    if time_bounds.shape != (1, 2) or not 0.999 <= time_bounds[0, 1] - time_bounds[0, 0] <= 1.001:
        raise ValueError("time_bnds does not describe one day")


def read_layer(dataset: Dataset, name: str) -> Layer:
    if name not in dataset.variables:
        raise ValueError(f"Missing required variable: {name}")
    variable = dataset.variables[name]
    if variable.shape != EXPECTED_SHAPE:
        raise ValueError(f"{name}: expected shape {EXPECTED_SHAPE}, found {variable.shape}")
    if variable.dimensions != ("time", "lon", "lat"):
        raise ValueError(
            f"{name}: expected dimensions ('time', 'lon', 'lat'), found {variable.dimensions}"
        )

    source = variable[0]
    source_values = np.asarray(np.ma.getdata(source))
    source_valid = ~np.ma.getmaskarray(source) & np.isfinite(source_values)
    if hasattr(variable, "_FillValue"):
        source_valid &= source_values != variable._FillValue

    # IMERG stores daily fields as (lon, lat); image rows must be latitude.
    return Layer(
        values=source_values.T,
        valid=source_valid.T,
        units=str(getattr(variable, "units", "")),
        long_name=str(getattr(variable, "long_name", name)),
    )


def read_granule(path: Path) -> Granule:
    if not path.is_file():
        raise ValueError(f"Input file does not exist: {path}")

    with Dataset(path, "r") as dataset:
        title = str(getattr(dataset, "title", ""))
        if "GPM_3IMERGDF" not in title:
            raise ValueError(f"Expected GPM_3IMERGDF daily product, found title={title!r}")

        for name in ("lon", "lat", "time", "time_bnds"):
            if name not in dataset.variables:
                raise ValueError(f"Missing required coordinate variable: {name}")
        longitude = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        latitude = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        if longitude.shape != (3600,) or latitude.shape != (1800,):
            raise ValueError(
                "Expected 3600 longitude centers and 1800 latitude centers, found "
                f"{longitude.shape} and {latitude.shape}"
            )
        for label, coordinates, expected_limits in (
            ("longitude", longitude, (-179.95, 179.95)),
            ("latitude", latitude, (-89.95, 89.95)),
        ):
            if not np.isfinite(coordinates).all() or not np.all(np.diff(coordinates) > 0):
                raise ValueError(f"{label} centers must be finite and strictly increasing")
            if not np.allclose(np.diff(coordinates), 0.1, rtol=0, atol=2e-5):
                raise ValueError(f"{label} spacing is not consistently 0.1 degrees")
            if not np.allclose((coordinates[0], coordinates[-1]), expected_limits, atol=2e-5):
                raise ValueError(f"{label} coordinates do not span the expected global grid")

        start = parse_datetime(str(dataset.BeginDate), str(dataset.BeginTime))
        end = parse_datetime(str(dataset.EndDate), str(dataset.EndTime))
        time_bounds = np.asarray(dataset.variables["time_bnds"][:], dtype=np.float64)
        validate_daily_period(start, end, time_bounds)

        layers = {name: read_layer(dataset, name) for name in VARIABLES}
        expected_units = {
            "precipitation": "mm/day",
            "MWprecipitation": "mm/day",
            "randomError": "mm/day",
            "probabilityLiquidPrecipitation": "percent",
            "precipitation_cnt": "count",
            "precipitation_cnt_cond": "count",
        }
        for name, expected in expected_units.items():
            if layers[name].units != expected:
                raise ValueError(
                    f"{name}: expected units {expected!r}, found {layers[name].units!r}"
                )

        sources = [item for item in str(dataset.InputPointer).split(";") if item.strip()]
        if len(sources) != 48:
            raise ValueError(f"Expected 48 half-hour source granules, found {len(sources)}")
        production_time = str(dataset.ProductionTime)

    version_match = re.search(r"\.(V\d+[A-Z])\.nc4$", path.name, re.IGNORECASE)
    version = version_match.group(1).upper() if version_match else "unknown"
    return Granule(
        path=path,
        longitude=longitude,
        latitude=latitude,
        layers=layers,
        start=start,
        end=end,
        production_time=production_time,
        source_count=len(sources),
        version=version,
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
    microwave = layers["MWprecipitation"]
    wet = precipitation.valid & (precipitation.values > 0)
    microwave_wet = microwave.valid & (microwave.values > 0)
    total = precipitation.values.size

    print(f"Input: {granule.path.resolve()}")
    print(f"Grid: latitude={granule.latitude.size}, longitude={granule.longitude.size}; 0.1° global")
    print(f"Time: {granule.start.isoformat()} to {granule.end.isoformat()}")
    print(f"Version: {granule.version}; production time: {granule.production_time}")
    print(f"Half-hour source granules: {granule.source_count}")
    print(
        f"Combined precipitation: valid={precipitation.valid.sum():,}/{total:,} "
        f"({precipitation.valid.mean():.6%}), missing={(~precipitation.valid).sum():,}, "
        f"wet={wet.sum():,} ({wet.sum() / precipitation.valid.sum():.6%} of valid)"
    )
    print(
        f"Microwave precipitation: valid={microwave.valid.sum():,}/{total:,}, "
        f"wet={microwave_wet.sum():,}"
    )
    summary_stats("Combined daily precipitation (all valid)", precipitation.values[precipitation.valid], "mm/day")
    summary_stats("Combined daily precipitation (positive)", precipitation.values[wet], "mm/day")
    summary_stats("Microwave daily precipitation (all valid)", microwave.values[microwave.valid], "mm/day")
    summary_stats("Microwave daily precipitation (positive)", microwave.values[microwave_wet], "mm/day")

    error = layers["randomError"]
    summary_stats("Random error", error.values[error.valid], "mm/day")
    liquid = layers["probabilityLiquidPrecipitation"]
    summary_stats("Probability of liquid precipitation (wet cells)", liquid.values[liquid.valid & wet], "%")
    for name, label in (
        ("precipitation_cnt", "Valid half-hour retrieval count"),
        ("precipitation_cnt_cond", "Raining half-hour count"),
    ):
        layer = layers[name]
        summary_stats(label, layer.values[layer.valid], "count")

    valid_count = layers["precipitation_cnt"]
    wet_count = layers["precipitation_cnt_cond"]
    print(
        "Precipitation validity vs precipitation_cnt > 0 mismatch: "
        f"{np.count_nonzero(precipitation.valid != (valid_count.values > 0)):,}"
    )
    print(
        "Positive precipitation vs precipitation_cnt_cond > 0 mismatch: "
        f"{np.count_nonzero(wet != (wet_count.values > 0)):,}"
    )


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


def precipitation_map(
    axis: plt.Axes,
    layer: Layer,
    extent: tuple[float, float, float, float],
    title: str,
    cmap,
    norm: LogNorm,
):
    wet = layer.valid & (layer.values > 0)
    dry = layer.valid & ~wet
    base = np.zeros(layer.values.shape, dtype=np.uint8)
    base[dry] = 1
    axis.imshow(
        base,
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=ListedColormap((MISSING_COLOR, DRY_COLOR)),
        norm=BoundaryNorm([-0.5, 0.5, 1.5], 2),
    )
    image = axis.imshow(
        np.ma.array(layer.values, mask=~wet),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=cmap,
        norm=norm,
    )
    configure_map(axis, f"{title}\n{wet.sum():,} positive grid cells")
    axis.legend(
        handles=(
            Patch(facecolor=DRY_COLOR, edgecolor="#d1d5db", label="Valid, zero"),
            Patch(facecolor=MISSING_COLOR, label="Missing"),
        ),
        loc="lower left",
        frameon=True,
        fontsize=8,
    )
    return image


def render(granule: Granule, output: Path) -> None:
    layers = granule.layers
    precipitation = layers["precipitation"]
    microwave = layers["MWprecipitation"]
    wet = precipitation.valid & (precipitation.values > 0)
    microwave_wet = microwave.valid & (microwave.values > 0)
    combined_values = precipitation.values[wet]
    microwave_values = microwave.values[microwave_wet]
    scale_values = np.concatenate((combined_values, microwave_values))
    precip_norm = LogNorm(
        vmin=float(scale_values.min()),
        vmax=float(np.percentile(scale_values, 99.9)),
    )
    precip_cmap = plt.get_cmap("YlGnBu").copy()
    extent = (-180.0, 180.0, -90.0, 90.0)

    figure, axes = plt.subplots(2, 3, figsize=(18, 10.5), layout="constrained")
    for axis, layer, title in (
        (axes[0, 0], precipitation, "Combined daily precipitation"),
        (axes[0, 1], microwave, "Microwave-only daily precipitation"),
    ):
        precip_image = precipitation_map(
            axis, layer, extent, title, precip_cmap, precip_norm
        )
    figure.colorbar(
        precip_image,
        ax=list(axes[0, :2]),
        label="Daily precipitation (mm/day)",
        extend="max",
        shrink=0.86,
        pad=0.02,
    )

    error = layers["randomError"]
    positive_error = error.valid & (error.values > 0)
    error_values = error.values[positive_error]
    error_cmap = plt.get_cmap("magma").copy()
    error_cmap.set_bad(MISSING_COLOR)
    error_image = axes[0, 2].imshow(
        np.ma.array(error.values, mask=~positive_error),
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
    configure_map(axes[0, 2], "Random error estimate\n(positive values; logarithmic color scale)")
    figure.colorbar(
        error_image,
        ax=axes[0, 2],
        label="Random error (mm/day)",
        extend="max",
        shrink=0.86,
        pad=0.02,
    )

    liquid = layers["probabilityLiquidPrecipitation"]
    liquid_wet = liquid.valid & wet
    liquid_cmap = plt.get_cmap("coolwarm").copy()
    liquid_cmap.set_bad(DRY_COLOR)
    liquid_image = axes[1, 0].imshow(
        np.ma.array(liquid.values, mask=~liquid_wet),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=liquid_cmap,
        vmin=0,
        vmax=100,
    )
    configure_map(axes[1, 0], "Probability of liquid precipitation\n(positive precipitation cells only)")
    figure.colorbar(
        liquid_image,
        ax=axes[1, 0],
        label="Probability (%)",
        shrink=0.86,
        pad=0.02,
    )

    wet_count = layers["precipitation_cnt_cond"]
    count_cmap = plt.get_cmap("viridis").copy()
    count_cmap.set_bad(MISSING_COLOR)
    count_image = axes[1, 1].imshow(
        np.ma.array(wet_count.values, mask=~wet_count.valid),
        extent=extent,
        origin="lower",
        interpolation="nearest",
        aspect="equal",
        cmap=count_cmap,
        vmin=0,
        vmax=48,
    )
    configure_map(axes[1, 1], "Raining half-hour retrieval count")
    figure.colorbar(
        count_image,
        ax=axes[1, 1],
        label="Half-hour intervals with precipitation (0–48)",
        shrink=0.86,
        pad=0.02,
    )

    histogram = axes[1, 2]
    minimum = float(scale_values.min())
    maximum = float(scale_values.max())
    bins = np.geomspace(minimum, maximum, 81)
    for label, values, color in (
        ("Combined", combined_values, "#0072b2"),
        ("Microwave only", microwave_values, "#d55e00"),
    ):
        counts, edges = np.histogram(values, bins=bins)
        if int(counts.sum()) != values.size:
            raise ValueError(f"Histogram did not include every positive {label} pixel")
        histogram.stairs(
            counts / values.size * 100,
            edges,
            label=f"{label} (n={values.size:,})",
            color=color,
            linewidth=1.6,
        )
        print(f"Histogram {label}: {counts.sum():,} pixels (all positive values included)")
    histogram.set_xscale("log")
    histogram.set(
        title="Positive daily precipitation distributions",
        xlabel="Daily precipitation (mm/day, logarithmic scale)",
        ylabel="Positive grid cells per bin (%)",
        xlim=(minimum, maximum),
    )
    histogram.grid(alpha=0.25, which="both", linewidth=0.5)
    histogram.legend(frameon=False, fontsize=9)

    period = f"{granule.start:%Y-%m-%d %H:%M:%S}–{granule.end:%H:%M:%S UTC}"
    figure.suptitle(
        f"GPM IMERG Final daily precipitation — {period}\n"
        f"{granule.version}; aggregated from {granule.source_count} half-hour granules",
        fontsize=16,
    )
    figure.supxlabel(
        "Global 0.1° grid. Values are daily mean rates in mm/day; for this one-day interval, "
        "the numeric value is also the equivalent daily depth in mm. No spatial interpolation.",
        fontsize=10,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=180, facecolor="white")
    plt.close(figure)
    print(f"Saved: {output.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="IMERG Final daily NetCDF4 file")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG")
    args = parser.parse_args()

    try:
        if args.output.suffix.lower() != ".png":
            raise ValueError("Output must use a .png extension")
        granule = read_granule(args.input)
        report(granule)
        render(granule, args.output)
    except (ValueError, OSError, RuntimeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
