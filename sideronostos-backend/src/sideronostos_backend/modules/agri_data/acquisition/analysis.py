"""Read-only analysis of acquired POWER, GPM, SRTM, and GRACE data."""

# Generated SVG/HTML fragments intentionally contain long literal lines.
# ruff: noqa: E501

from __future__ import annotations

import base64
import csv
import hashlib
import html
import json
import math
import struct
import zipfile
import zlib
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import h5py  # type: ignore[import-untyped]
import numpy as np
from pyproj import Transformer

from .config import PipelineConfig

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
ANALYSIS_SCHEMA = "sideronostos-non-appeears-analysis-v1"
_WEB_MERCATOR = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def aggregate_weather(
    power_rows: list[dict[str, str]], gpm_rows: list[dict[str, str]], start: date, end: date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    power_daily: dict[date, dict[str, float]] = {}
    for row in power_rows:
        day = date.fromisoformat(row["date"])
        if not start <= day <= end:
            continue
        try:
            tmean = (float(row["tmin_c"]) + float(row["tmax_c"])) / 2
            et0 = float(row["et0_mm"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(tmean) and math.isfinite(et0):
            power_daily[day] = {"tmean_c": tmean, "et0_mm": et0}

    gpm_grid: dict[tuple[date, float, float], list[float]] = defaultdict(list)
    for row in gpm_rows:
        day = date.fromisoformat(row["date"])
        if not start <= day <= end:
            continue
        try:
            value = float(row["rain_mm"])
            longitude = float(row["longitude"])
            latitude = float(row["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(value):
            gpm_grid[(day, longitude, latitude)].append(value)

    gpm_daily_grid: dict[date, dict[tuple[float, float], float]] = defaultdict(dict)
    for (day, longitude, latitude), values in gpm_grid.items():
        gpm_daily_grid[day][(longitude, latitude)] = sum(values) / len(values)
    expected_dates = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    observed_cells = [len(gpm_daily_grid[day]) for day in expected_dates]
    expected_cell_count = max(observed_cells, default=0)

    monthly_acc: dict[str, dict[str, Any]] = {}
    for day in expected_dates:
        key = day.strftime("%Y-%m")
        bucket = monthly_acc.setdefault(
            key,
            {
                "year": day.year,
                "month": day.month,
                "expected_days": 0,
                "power_days": 0,
                "gpm_days": 0,
                "rain_mm": 0.0,
                "tmean_sum": 0.0,
                "et0_mm": 0.0,
            },
        )
        bucket["expected_days"] += 1
        power = power_daily.get(day)
        if power:
            bucket["power_days"] += 1
            bucket["tmean_sum"] += power["tmean_c"]
            bucket["et0_mm"] += power["et0_mm"]
        cells = gpm_daily_grid.get(day, {})
        if expected_cell_count and len(cells) == expected_cell_count:
            bucket["gpm_days"] += 1
            bucket["rain_mm"] += sum(cells.values()) / len(cells)

    monthly: list[dict[str, Any]] = []
    for key in sorted(monthly_acc):
        row = monthly_acc[key]
        power_complete = row["power_days"] == row["expected_days"]
        gpm_complete = row["gpm_days"] == row["expected_days"]
        monthly.append(
            {
                "month": key,
                "year": row["year"],
                "month_number": row["month"],
                "expected_days": row["expected_days"],
                "power_days": row["power_days"],
                "gpm_days": row["gpm_days"],
                "power_complete": power_complete,
                "gpm_complete": gpm_complete,
                "tmean_c": (
                    float(row["tmean_sum"]) / int(row["power_days"]) if row["power_days"] else None
                ),
                "et0_mm": row["et0_mm"] if power_complete else None,
                "rain_mm": row["rain_mm"] if gpm_complete else None,
                "rain_minus_et0_mm": (
                    float(row["rain_mm"]) - float(row["et0_mm"])
                    if gpm_complete and power_complete
                    else None
                ),
            }
        )

    annual: list[dict[str, Any]] = []
    for year in range(start.year, end.year + 1):
        months = [row for row in monthly if row["year"] == year]
        expected = sum(row["expected_days"] for row in months)
        p_days = sum(row["power_days"] for row in months)
        g_days = sum(row["gpm_days"] for row in months)
        full_period = date(year, 1, 1) >= start and date(year, 12, 31) <= end
        annual.append(
            {
                "year": year,
                "expected_days": expected,
                "power_days": p_days,
                "gpm_days": g_days,
                "power_complete": p_days == expected,
                "gpm_complete": g_days == expected,
                "tmean_c": (
                    sum(
                        row["tmean_c"] * row["power_days"]
                        for row in months
                        if row["tmean_c"] is not None
                    )
                    / p_days
                    if p_days
                    else None
                ),
                "et0_mm": sum(row["et0_mm"] or 0 for row in months) if p_days == expected else None,
                "rain_mm": sum(row["rain_mm"] or 0 for row in months)
                if g_days == expected
                else None,
                "rain_minus_et0_mm": (
                    sum(row["rain_mm"] or 0 for row in months)
                    - sum(row["et0_mm"] or 0 for row in months)
                    if g_days == expected and p_days == expected
                    else None
                ),
                "partial_period": not full_period,
            }
        )

    coverage = {
        "expected_days": len(expected_dates),
        "power_days": len(power_daily),
        "gpm_days_with_full_grid": sum(
            len(gpm_daily_grid.get(day, {})) == expected_cell_count and expected_cell_count > 0
            for day in expected_dates
        ),
        "gpm_cells_per_day": expected_cell_count,
        "gpm_input_rows": sum(len(values) for values in gpm_grid.values()),
        "gpm_unique_cells": len({(lon, lat) for _, lon, lat in gpm_grid}),
    }
    return monthly, annual, coverage


def _read_grace(
    path: Path, start: date, end: date, latitude: float, longitude: float
) -> dict[str, Any]:
    with h5py.File(path, "r") as dataset:
        latitudes = dataset["lat"][:]
        longitudes = dataset["lon"][:]
        times = dataset["time"][:]
        lat_index = int(np.abs(latitudes - latitude).argmin())
        target_lon = longitude % 360
        lon_delta = np.abs((longitudes - target_lon + 180) % 360 - 180)
        lon_index = int(lon_delta.argmin())
        time_units = dataset["time"].attrs["units"]
        units = time_units.decode() if isinstance(time_units, bytes) else str(time_units)
        origin = date.fromisoformat(units.split("since", 1)[1].strip().split("T", 1)[0])
        monthly_rows: list[dict[str, Any]] = []
        for index, days in enumerate(times):
            timestamp = origin + timedelta(days=float(days))
            if not start <= timestamp <= end:
                continue
            raw_value = float(dataset["lwe_thickness"][index, lat_index, lon_index])
            raw_error = float(dataset["uncertainty"][index, lat_index, lon_index])
            value = raw_value if math.isfinite(raw_value) and raw_value != -99999.0 else None
            error = raw_error if math.isfinite(raw_error) and raw_error != -99999.0 else None
            monthly_rows.append(
                {"date": timestamp.isoformat(), "lwe_cm": value, "uncertainty_cm": error}
            )
    return {
        "coordinates": {
            "requested_latitude": latitude,
            "requested_longitude": longitude,
            "nearest_grid_latitude": float(latitudes[lat_index]),
            "nearest_grid_longitude": float(longitudes[lon_index]),
            "effective_mascon_resolution_degrees": 3.0,
        },
        "rows": monthly_rows,
        "units": "cm liquid water equivalent",
        "caveat": "GRACE uncertainty describes the approximately 3-degree mascon, not individual 0.5-degree cells or a farm.",
    }


def _month_ticks(left: int, right: int, count: int) -> str:
    parts = []
    for i in range(count):
        if i % 12 == 0:
            x = left + (right - left) * i / max(count - 1, 1)
            parts.append(f'<text x="{x:.1f}" y="245" text-anchor="middle">{2022 + i // 12}</text>')
    return "".join(parts)


def _weather_chart(monthly: list[dict[str, Any]]) -> str:
    width, height, left, right, top, bottom = 960, 280, 72, 932, 28, 220
    max_value = max((max(row["rain_mm"] or 0, row["et0_mm"] or 0) for row in monthly), default=1)
    max_value = max(50, math.ceil(max_value / 50) * 50)
    group_width = (right - left) / max(len(monthly), 1)
    bar_width = group_width * 0.34
    marks = []
    for i, row in enumerate(monthly):
        center = left + group_width * (i + 0.5)
        for value_key, offset, color, label in (
            ("rain_mm", -bar_width / 2, "#227b9e", "GPM 降水"),
            ("et0_mm", bar_width / 2, "#b46a27", "POWER 参考 ET0"),
        ):
            value = row[value_key]
            if value is None:
                continue
            bar_h = (bottom - top) * value / max_value
            marks.append(
                f'<rect x="{center + offset - bar_width / 2:.2f}" y="{bottom - bar_h:.2f}" '
                f'width="{bar_width:.2f}" height="{bar_h:.2f}" fill="{color}">'
                f"<title>{html.escape(row['month'])} {label}: {value:.1f} mm</title></rect>"
            )
    ticks = []
    for value in range(0, max_value + 1, max(50, math.ceil(max_value / 4 / 50) * 50)):
        y = bottom - (bottom - top) * value / max_value
        ticks.append(
            f'<line x1="{left}" x2="{right}" y1="{y:.1f}" y2="{y:.1f}" stroke="#d8dedb"/>'
            f'<text x="{left - 10}" y="{y + 4:.1f}" text-anchor="end">{value}</text>'
        )
    year_ticks = _month_ticks(left, right, len(monthly))
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="月降水量与参考蒸散量">'
        f'<text x="{left}" y="16">毫米/月</text>{"".join(ticks)}{"".join(marks)}'
        f'<line x1="{left}" x2="{right}" y1="{bottom}" y2="{bottom}" stroke="#52625a"/>'
        f'{year_ticks}<g transform="translate(560 270)"><rect width="10" height="10" fill="#227b9e"/><text x="15" y="9">GPM 降水</text>'
        f'<rect x="180" width="10" height="10" fill="#b46a27"/><text x="195" y="9">POWER 参考 ET0</text></g></svg>'
    )


def _line_chart(
    rows: list[dict[str, Any]],
    *,
    value_key: str,
    uncertainty_key: str | None,
    label: str,
    unit: str,
) -> str:
    width, height, left, right, top, bottom = 960, 280, 72, 932, 28, 220
    values = [row[value_key] for row in rows if row.get(value_key) is not None]
    errors = [row.get(uncertainty_key) or 0 for row in rows] if uncertainty_key else [0] * len(rows)
    if not values:
        return f"<p>No valid {html.escape(label)} observations in the selected period.</p>"
    low = min(
        float(row[value_key]) - errors[i]
        for i, row in enumerate(rows)
        if row.get(value_key) is not None
    )
    high = max(
        float(row[value_key]) + errors[i]
        for i, row in enumerate(rows)
        if row.get(value_key) is not None
    )
    span = max(high - low, 1.0)
    low -= span * 0.08
    high += span * 0.08
    points = []
    for i, row in enumerate(rows):
        value = row.get(value_key)
        if value is None:
            continue
        x = left + (right - left) * i / max(len(rows) - 1, 1)
        y = bottom - (bottom - top) * (float(value) - low) / (high - low)
        points.append((x, y, float(value), i))
    line = " ".join(f"{x:.2f},{y:.2f}" for x, y, _, _ in points)
    marks = []
    if uncertainty_key:
        for x, y, _value, index in points:
            error = errors[index]
            delta = (bottom - top) * error / (high - low)
            marks.append(
                f'<line x1="{x:.2f}" x2="{x:.2f}" y1="{y - delta:.2f}" y2="{y + delta:.2f}" stroke="#70a28d"/>'
            )
    dots = "".join(
        f'<circle cx="{x:.2f}" cy="{y:.2f}" r="3"><title>{html.escape(rows[i].get("date", rows[i].get("month", "")))}: {value:.2f} {html.escape(unit)}</title></circle>'
        for x, y, value, i in points
    )
    tick_rows = []
    for fraction in (0, 0.25, 0.5, 0.75, 1):
        value = low + span * fraction
        y = bottom - (bottom - top) * (value - low) / (high - low)
        tick_rows.append(
            f'<line x1="{left}" x2="{right}" y1="{y:.1f}" y2="{y:.1f}" stroke="#d8dedb"/>'
            f'<text x="{left - 10}" y="{y + 4:.1f}" text-anchor="end">{value:.1f}</text>'
        )
    ticks = _month_ticks(left, right, len(rows))
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(label)}">'
        f'<text x="{left}" y="16">{html.escape(unit)}</text>{"".join(tick_rows)}'
        f'<polyline points="{line}" fill="none" stroke="#257a60" stroke-width="2.5"/>'
        f'{"".join(marks)}{dots}<line x1="{left}" x2="{right}" y1="{bottom}" y2="{bottom}" stroke="#52625a"/>'
        f"{ticks}</svg>"
    )


def _mercator(longitude: float, latitude: float) -> tuple[float, float]:
    clipped_lat = max(min(latitude, 85.05112878), -85.05112878)
    x, y = _WEB_MERCATOR.transform(longitude, clipped_lat)
    return float(x), float(y)


def _gpm_map(gpm_rows: list[dict[str, str]], fields_path: Path) -> str:
    annual_cells: dict[tuple[int, float, float], float] = defaultdict(float)
    for row in gpm_rows:
        day = date.fromisoformat(row["date"])
        annual_cells[(day.year, float(row["longitude"]), float(row["latitude"]))] += float(
            row["rain_mm"]
        )
    locations = sorted({(lon, lat) for _, lon, lat in annual_cells})
    longitudes = sorted({lon for lon, _ in locations})
    latitudes = sorted({lat for _, lat in locations})
    lon_step = min((b - a for a, b in zip(longitudes, longitudes[1:], strict=False)), default=0.1)
    lat_step = min((b - a for a, b in zip(latitudes, latitudes[1:], strict=False)), default=0.1)
    cell_values: dict[tuple[float, float], float] = {}
    for lon, lat in locations:
        annual_totals = [annual_cells.get((year, lon, lat)) for year in range(2022, 2025)]
        available_totals = [value for value in annual_totals if value is not None]
        if len(available_totals) == 3:
            cell_values[(lon, lat)] = sum(available_totals) / 3
    projected = {
        (lon, lat): (_mercator(lon, lat), _mercator(lon + lon_step, lat + lat_step))
        for lon, lat in locations
    }
    geometries = json.loads(fields_path.read_text(encoding="utf-8"))["features"]
    all_points = [point for pair in projected.values() for point in pair]
    for feature in geometries:
        all_points.extend(_mercator(lon, lat) for lon, lat in feature["geometry"]["coordinates"][0])
    min_x = min(point[0] for point in all_points)
    max_x = max(point[0] for point in all_points)
    min_y = min(point[1] for point in all_points)
    max_y = max(point[1] for point in all_points)
    pad_x, pad_y = (max_x - min_x) * 0.06, (max_y - min_y) * 0.12
    min_x, max_x, min_y, max_y = min_x - pad_x, max_x + pad_x, min_y - pad_y, max_y + pad_y
    width, height = 760, 420
    left, right, top, bottom = 76, 742, 34, 365
    sx = (right - left) / (max_x - min_x)
    sy = (bottom - top) / (max_y - min_y)

    def px(x: float) -> float:
        return left + (x - min_x) * sx

    def py(y: float) -> float:
        return bottom - (y - min_y) * sy

    vals = list(cell_values.values())
    vmin, vmax = min(vals, default=0), max(vals, default=1)
    vmax = max(vmax, vmin + 1)
    palette = ((241, 248, 236), (184, 217, 161), (102, 174, 145), (36, 117, 145), (28, 68, 112))

    def color(value: float) -> str:
        fraction = (value - vmin) / (vmax - vmin)
        position = fraction * (len(palette) - 1)
        index = min(int(position), len(palette) - 2)
        ratio = position - index
        rgb = tuple(
            round(palette[index][i] * (1 - ratio) + palette[index + 1][i] * ratio) for i in range(3)
        )
        return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"

    cells = []
    for (lon, lat), value in cell_values.items():
        (x0, y0), (x1, y1) = projected[(lon, lat)]
        x, y = px(x0), py(y1)
        w, h = px(x1) - px(x0), py(y0) - py(y1)
        cells.append(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{color(value)}" stroke="#f8faf7" stroke-width="1">'
            f"<title>像元中心 {lon:.2f}° W, {lat:.2f}° N：2022–2024 年均值 {value:.0f} 毫米/年</title></rect>"
        )
    farm_paths = []
    for feature in geometries:
        coords = [_mercator(lon, lat) for lon, lat in feature["geometry"]["coordinates"][0]]
        path = (
            " ".join(
                ("M" if i == 0 else "L") + f"{px(x):.2f},{py(y):.2f}"
                for i, (x, y) in enumerate(coords)
            )
            + " Z"
        )
        farm_paths.append(
            f'<path d="{path}" fill="#e9f4ef" fill-opacity="0.28" stroke="#173f32" stroke-width="2"><title>{html.escape(feature["properties"].get("field_id", "field"))}; synthetic 32-ha benchmark field</title></path>'
        )
    legend = []
    for i in range(5):
        value = vmin + (vmax - vmin) * i / 4
        legend.append(
            f'<rect x="{left + i * 118}" y="389" width="118" height="12" fill="{color(value)}"/>'
        )
        legend.append(f'<text x="{left + i * 118}" y="414">{value:.0f}</text>')
    lon_labels = []
    for lon in longitudes:
        x, _ = _mercator(lon, (min(latitudes) + max(latitudes)) / 2)
        lon_labels.append(f'<text x="{px(x):.2f}" y="382" text-anchor="middle">{lon:.2f}°</text>')
    lat_labels = []
    for lat in latitudes:
        _, y = _mercator((min(longitudes) + max(longitudes)) / 2, lat)
        lat_labels.append(f'<text x="66" y="{py(y) + 4:.2f}" text-anchor="end">{lat:.2f}°</text>')
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="NASA GPM 三年平均年降水网格和合成田块边界">'
        f'<text x="{left}" y="20">GPM IMERG 0.1° 网格 · 年均降水量（毫米/年）</text>'
        f"{''.join(cells)}{''.join(farm_paths)}{''.join(lon_labels)}{''.join(lat_labels)}{''.join(legend)}"
        f'<text x="{right}" y="414" text-anchor="end">合成田块边界</text></svg>'
    )


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _write_png(path: Path, rgb: np.ndarray) -> None:
    height, width, _ = rgb.shape
    scanlines = b"".join(b"\x00" + row.tobytes() for row in rgb.astype(np.uint8))
    data = b"\x89PNG\r\n\x1a\n"
    data += _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    data += _png_chunk(b"IDAT", zlib.compress(scanlines, 6))
    data += _png_chunk(b"IEND", b"")
    path.write_bytes(data)


def _srtm_image(config: PipelineConfig, fields_path: Path, output: Path) -> dict[str, Any]:
    west, south, east, north = config.bbox
    west -= 0.12
    east += 0.12
    south -= 0.08
    north += 0.08
    tile_west = -94.0
    col0 = max(0, int(round((west - tile_west) * 3600)))
    col1 = min(3601, int(round((east - tile_west) * 3600)) + 1)
    tile_arrays = []
    for tile_north in (42, 41):
        zip_path = config.root / "raw" / "srtm" / f"N{tile_north}W094.SRTMGL1.hgt.zip"
        with zipfile.ZipFile(zip_path) as archive:
            name = next(name for name in archive.namelist() if name.lower().endswith(".hgt"))
            raw = archive.read(name)
        tile = np.frombuffer(raw, dtype=">i2").reshape((3601, 3601))
        upper = tile_north + 1
        row0 = max(0, int(round((upper - north) * 3600)))
        row1 = min(3601, int(round((upper - max(south, tile_north)) * 3600)) + 1)
        if tile_north == 41:
            row0 = max(1, row0)
        tile_arrays.append(tile[row0:row1, col0:col1].astype(np.float32))
    elevation = np.concatenate(tile_arrays, axis=0)
    elevation = np.where(elevation < -1000, np.nan, elevation)
    valid = elevation[np.isfinite(elevation)]
    if valid.size == 0:
        raise RuntimeError("SRTM crop contains no valid elevation values")
    min_elevation, max_elevation = float(valid.min()), float(valid.max())
    scale = max(max_elevation - min_elevation, 1.0)
    stride = max(1, int(math.ceil(max(elevation.shape) / 720)))
    sampled = elevation[::stride, ::stride]
    quantiles = np.nan_to_num((sampled - min_elevation) / scale, nan=0.0).clip(0, 1)
    stops = np.array(
        ((41, 91, 68), (105, 143, 79), (181, 169, 91), (215, 203, 155)), dtype=np.float32
    )
    positions = quantiles * (len(stops) - 1)
    index = np.minimum(positions.astype(int), len(stops) - 2)
    ratio = (positions - index)[..., None]
    rgb = (stops[index] * (1 - ratio) + stops[index + 1] * ratio).astype(np.uint8)
    rgb[~np.isfinite(sampled)] = (220, 224, 220)
    _write_png(output, rgb)
    return {
        "min_elevation_m": min_elevation,
        "max_elevation_m": max_elevation,
        "mean_elevation_m": float(valid.mean()),
        "valid_samples": int(valid.size),
        "image_width": int(sampled.shape[1]),
        "image_height": int(sampled.shape[0]),
        "bounds": [west, south, east, north],
    }


def _terrain_svg(image_path: Path, terrain: dict[str, Any], fields_path: Path) -> str:
    width, height = 820, 480
    left, right, top, bottom = 76, 790, 36, 414
    west, south, east, north = terrain["bounds"]
    mid_lat, mid_lon = (south + north) / 2, (west + east) / 2
    min_x, _ = _mercator(west, mid_lat)
    max_x, _ = _mercator(east, mid_lat)
    _, min_y = _mercator(mid_lon, south)
    _, max_y = _mercator(mid_lon, north)
    scale = min((right - left) / (max_x - min_x), (bottom - top) / (max_y - min_y))
    plot_width, plot_height = (max_x - min_x) * scale, (max_y - min_y) * scale
    plot_left = left + ((right - left) - plot_width) / 2
    plot_top = top + ((bottom - top) - plot_height) / 2
    plot_bottom = plot_top + plot_height

    def px(longitude: float) -> float:
        x, _ = _mercator(longitude, mid_lat)
        return plot_left + (x - min_x) * scale

    def py(latitude: float) -> float:
        _, y = _mercator(mid_lon, latitude)
        return plot_bottom - (y - min_y) * scale

    features = json.loads(fields_path.read_text(encoding="utf-8"))["features"]
    paths = []
    for feature in features:
        coords = feature["geometry"]["coordinates"][0]
        path = (
            " ".join(
                ("M" if i == 0 else "L") + f"{px(lon):.2f},{py(lat):.2f}"
                for i, (lon, lat) in enumerate(coords)
            )
            + " Z"
        )
        paths.append(
            f'<path d="{path}" fill="#f1f7f3" fill-opacity="0.22" stroke="#173f32" stroke-width="2"><title>{html.escape(feature["properties"].get("field_id", "field"))}, synthetic 32-ha benchmark field</title></path>'
        )
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    lon_ticks = []
    for value in (west, (west + east) / 2, east):
        lon_ticks.append(
            f'<text x="{px(value):.1f}" y="440" text-anchor="middle">{value:.2f}°</text>'
        )
    lat_ticks = []
    for value in (south, (south + north) / 2, north):
        lat_ticks.append(
            f'<text x="66" y="{py(value) + 4:.1f}" text-anchor="end">{value:.2f}°</text>'
        )
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="SRTM elevation surrounding Iowa benchmark fields">'
        f'<text x="{left}" y="20">SRTMGL1.003 elevation · {terrain["min_elevation_m"]:.0f}–{terrain["max_elevation_m"]:.0f} m</text>'
        f'<image x="{plot_left}" y="{plot_top}" width="{plot_width}" height="{plot_height}" preserveAspectRatio="none" href="data:image/png;base64,{encoded}"/>'
        f"{''.join(paths)}{''.join(lon_ticks)}{''.join(lat_ticks)}"
        f'<text x="{left}" y="466">Field outlines are synthetic benchmark polygons, not cadastral boundaries.</text></svg>'
    )


def _report_html(
    *,
    monthly: list[dict[str, Any]],
    annual: list[dict[str, Any]],
    coverage: dict[str, Any],
    grace: dict[str, Any],
    gpm_map: str,
    terrain_map: str,
    output: Path,
) -> str:
    table = "".join(
        "<tr>"
        + "".join(
            f"<td>{html.escape(str(value))}</td>"
            for value in (
                row["year"],
                f"{row['tmean_c']:.1f}" if row["tmean_c"] is not None else "Missing",
                f"{row['rain_mm']:.0f}" if row["rain_mm"] is not None else "Incomplete",
                f"{row['et0_mm']:.0f}" if row["et0_mm"] is not None else "Incomplete",
                f"{row['rain_minus_et0_mm']:.0f}"
                if row["rain_minus_et0_mm"] is not None
                else "Incomplete",
                f"{row['gpm_days']}/{row['expected_days']}",
                f"{row['power_days']}/{row['expected_days']}",
            )
        )
        + "</tr>"
        for row in annual
    )
    grace_rows = grace["rows"]
    return f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NASA 非 AppEEARS 数据分析 · Iowa 2022–2024</title>
<style>
:root{{color-scheme:light dark;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
body{{max-width:1120px;margin:32px auto;padding:0 20px;color:CanvasText;background:Canvas}}
h1,h2{{font-weight:550;line-height:1.2}}h1{{font-size:26px}}h2{{font-size:19px;margin-top:32px}}
section{{margin:24px 0}}svg{{display:block;width:100%;height:auto;overflow:visible}}svg text{{font:12px system-ui;fill:currentColor}}
table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;display:block;overflow-x:auto}}th,td{{padding:8px 10px;border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent);text-align:right}}th:first-child,td:first-child{{text-align:left}}
.legend{{display:flex;gap:18px;flex-wrap:wrap}}.swatch{{display:inline-block;width:10px;height:10px;margin-right:6px}}.muted{{opacity:.75}}.caveat{{border-left:3px solid #b46a27;padding-left:12px}}
a{{color:LinkText}}@media(max-width:600px){{body{{margin:20px auto;padding:0 12px}}th,td{{padding:6px 4px;font-size:12px}}}}
</style>
<body>
<h1>Iowa NASA 数据分析</h1>
<p class="muted">非 AppEEARS 数据 · {html.escape(monthly[0]["month"] if monthly else "")} 至 {html.escape(monthly[-1]["month"] if monthly else "")} · 历史观测，不是预测</p>
<section><h2>年度气候汇总</h2><table><thead><tr><th>年份</th><th>平均气温 °C</th><th>GPM 降水 mm</th><th>POWER ET0 mm</th><th>降水 − ET0 mm</th><th>GPM 日覆盖</th><th>POWER 日覆盖</th></tr></thead><tbody>{table}</tbody></table>
<p class="muted">降水 − 参考 ET0 仅为宏观气候水量平衡指标，不代表作物灌溉需求或模拟土壤水分亏缺。</p></section>
<section><h2>月降水量与参考蒸散量</h2>{_weather_chart(monthly)}
<p class="muted">GPM 降水为每天 {coverage["gpm_cells_per_day"]} 个原生网格像元的空间平均值；仅展示完整月份。POWER ET0 为参考蒸散量。</p></section>
<section><h2>月平均气温</h2>{_line_chart(monthly, value_key="tmean_c", uncertainty_key=None, label="NASA POWER 月平均气温", unit="°C")}
<p class="muted">先由 POWER Tmin/Tmax 计算日均温，再按月求平均。</p></section>
<section><h2>GPM 空间分辨率与田块</h2>{gpm_map}
<p class="muted">每个色块是约 0.1° 的 IMERG 网格像元。合成田块远小于降水像元，不应把像元值解读为单田块实测值。</p></section>
<section><h2>基准田块周边地形</h2>{terrain_map}
<p class="muted">SRTMGL1.003 原生间距约 30 米。高程和坡度描述地形，不代表土壤属性。</p></section>
<section><h2>GRACE/GRACE-FO 水储量异常</h2>{_line_chart(grace_rows, value_key="lwe_cm", uncertainty_key="uncertainty_cm", label="GRACE 最近 mascon 液态水当量异常", unit="厘米 LWE")}
<p class="caveat">最近网格中心：{grace["coordinates"]["nearest_grid_latitude"]:.2f}° N，{grace["coordinates"]["nearest_grid_longitude"]:.2f}° E。GRACE 有效 mascon 尺度约 3°，仅作区域水文背景，不代表田块土壤水分。</p></section>
<section><h2>可在 GIS 中打开的源图层</h2><ul>
<li><a href="../../layers/srtm-elevation-m.tif">SRTM 高程 COG</a></li><li><a href="../../layers/srtm-slope-degrees.tif">SRTM 坡度 COG</a></li>
<li><a href="../../layers/gpm-2022-precipitation-mm.tif">GPM 2022 降水 COG</a></li><li><a href="../../layers/gpm-2023-precipitation-mm.tif">GPM 2023 降水 COG</a></li>
<li><a href="../../layers/gpm-2024-precipitation-mm.tif">GPM 2024 降水 COG</a></li><li><a href="../../layers/grace-2024-water-storage-anomaly.tif">GRACE 2024 全球异常 COG</a></li>
<li><a href="../../processed/power-daily.csv">NASA POWER 日序列</a></li></ul>
<p class="muted">栅格保持 EPSG:4326 和原生空间支撑；不将全球 GRACE 或粗分辨率 GPM 上采样伪装成田块尺度细节。</p></section>
<section><h2>覆盖度与来源</h2><p>期望 {coverage["expected_days"]} 个日值；POWER 完整覆盖 {coverage["power_days"]} 天；GPM 完整空间网格覆盖 {coverage["gpm_days_with_full_grid"]} 天。GRACE 提供 {sum(row["lwe_cm"] is not None for row in grace_rows)} 个区域月度观测。数据校验和及月度明细见 <code>summary.json</code> 和 <code>monthly.csv</code>。</p></section>
</body></html>"""


def analyze_non_appeears(config: PipelineConfig) -> dict[str, Any]:
    """Create an isolated analysis report without mutating acquisition or AppEEARS data."""
    source_root = config.root
    power_path = source_root / "processed" / "power-daily.csv"
    gpm_path = source_root / "processed" / "gpm-daily-aoi.csv"
    fields_path = source_root / "aoi" / "fields.geojson"
    grace_paths = sorted((source_root / "raw" / "grace").glob("*.nc"))
    required = (power_path, gpm_path, fields_path)
    missing = [str(path) for path in required if not path.is_file()]
    if not grace_paths:
        missing.append(str(source_root / "raw" / "grace" / "*.nc"))
    if missing:
        raise FileNotFoundError("Missing required non-AppEEARS input(s): " + ", ".join(missing))

    power_rows = _read_csv(power_path)
    gpm_rows = _read_csv(gpm_path)
    monthly, annual, coverage = aggregate_weather(power_rows, gpm_rows, config.start, config.end)
    grace = _read_grace(grace_paths[0], config.start, config.end, config.latitude, config.longitude)
    output = source_root / "analysis" / "non-appeears"
    output.mkdir(parents=True, exist_ok=True)
    terrain_png = output / "srtm-terrain.png"
    terrain = _srtm_image(config, fields_path, terrain_png)
    gpm_map = _gpm_map(gpm_rows, fields_path)
    terrain_map = _terrain_svg(terrain_png, terrain, fields_path)

    with (output / "monthly.csv").open("w", newline="", encoding="utf-8") as stream:
        fields = list(monthly[0]) if monthly else []
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(monthly)
    provenance = {
        "schema": ANALYSIS_SCHEMA,
        "created_at_utc": datetime.now(UTC).isoformat(),
        "period": {"start": config.start.isoformat(), "end": config.end.isoformat()},
        "source_files": {
            "power_daily_csv": {"path": str(power_path), "sha256": _sha256(power_path)},
            "gpm_daily_aoi_csv": {"path": str(gpm_path), "sha256": _sha256(gpm_path)},
            "srtm_tiles": [
                {"path": str(path), "sha256": _sha256(path)}
                for path in sorted((source_root / "raw" / "srtm").glob("*.zip"))
            ],
            "grace_netcdf": {"path": str(grace_paths[0]), "sha256": _sha256(grace_paths[0])},
        },
        "coverage": coverage,
        "annual": annual,
        "monthly": monthly,
        "terrain": terrain,
        "grace": grace,
        "interpretation_limits": [
            "Synthetic field polygons are not cadastral boundaries.",
            "GPM 0.1-degree pixels do not resolve individual 32-ha fields.",
            "GRACE mascon data are regional water-storage context, not farm soil moisture.",
            "Precipitation minus reference ET0 is not irrigation demand or crop water stress.",
            "POWER is point support and is not interpolated to a raster.",
            "Historical engineering benchmark results are not future planting recommendations.",
        ],
    }
    (output / "summary.json").write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False) + "\n"
    )
    report = _report_html(
        monthly=monthly,
        annual=annual,
        coverage=coverage,
        grace=grace,
        gpm_map=gpm_map,
        terrain_map=terrain_map,
        output=output,
    )
    (output / "report.html").write_text(report, encoding="utf-8")
    return {
        "output_dir": str(output),
        "report": str(output / "report.html"),
        "summary": str(output / "summary.json"),
        "monthly_csv": str(output / "monthly.csv"),
        "coverage": coverage,
        "grace_months": len(grace["rows"]),
        "terrain": terrain,
        "sources": ["NASA POWER", "GPM IMERG Final Daily", "SRTMGL1.003", "GRACE/GRACE-FO Mascon"],
    }
