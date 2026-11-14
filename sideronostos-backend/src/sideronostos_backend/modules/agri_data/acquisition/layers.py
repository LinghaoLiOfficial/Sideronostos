"""QA-aware preparation of map-ready EPSG:4326 Cloud Optimized GeoTIFFs."""

from __future__ import annotations

import csv
import json
import math
import re
import tempfile
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import rasterio  # type: ignore[import-untyped]
import xarray as xr
from rasterio.merge import merge  # type: ignore[import-untyped]
from rasterio.shutil import copy as rio_copy  # type: ignore[import-untyped]
from rasterio.transform import from_bounds  # type: ignore[import-untyped]
from rasterio.warp import (  # type: ignore[import-untyped]
    Resampling,
    calculate_default_transform,
    reproject,
)

from ..recipes import fao56_et0
from .config import PipelineConfig
from .manifest import RunManifest, atomic_json, sha256_file

NODATA = -9999.0


def _write_cog(
    path: Path,
    data: np.ndarray,
    *,
    transform: rasterio.Affine,
    crs: str = "EPSG:4326",
    nodata: float = NODATA,
    dtype: str = "float32",
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    array = np.asarray(data)
    if array.ndim == 2:
        array = array[np.newaxis, ...]
    with tempfile.TemporaryDirectory(dir=path.parent) as temporary:
        source = Path(temporary) / "source.tif"
        with rasterio.open(
            source,
            "w",
            driver="GTiff",
            width=array.shape[2],
            height=array.shape[1],
            count=array.shape[0],
            dtype=dtype,
            crs=crs,
            transform=transform,
            nodata=nodata,
            compress="DEFLATE",
        ) as dataset:
            dataset.write(array.astype(dtype))
        rio_copy(
            source,
            path,
            driver="COG",
            compress="DEFLATE",
            overview_resampling="average",
            blocksize=256,
        )


def _layer_record(path: Path, **metadata: Any) -> dict[str, Any]:
    with rasterio.open(path) as dataset:
        return {
            "id": path.stem,
            "path": str(path),
            "format": "COG",
            "crs": dataset.crs.to_string() if dataset.crs else None,
            "bounds": list(dataset.bounds),
            "shape": [dataset.height, dataset.width],
            "nodata": dataset.nodata,
            "overviews": dataset.overviews(1),
            "sha256": sha256_file(path),
            **metadata,
        }


def prepare_power(
    config: PipelineConfig, elevation_m: float
) -> tuple[Path, Path, list[dict[str, Any]]]:
    parsed = json.loads((config.root / "processed" / "power-daily.json").read_text())
    csv_path = config.root / "processed" / "power-daily.csv"
    fields = [
        "date",
        "tmin_c",
        "tmax_c",
        "tdew_c",
        "wind_2m_ms",
        "pressure_kpa",
        "shortwave",
        "et0_mm",
    ]
    with csv_path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in parsed["days"]:
            output = {key: row.get(key) for key in fields}
            names = ("tmin_c", "tmax_c", "tdew_c", "wind_2m_ms", "pressure_kpa", "shortwave")
            if all(output.get(name) is not None for name in names):
                output["et0_mm"] = fao56_et0(
                    day=date.fromisoformat(row["date"]),
                    latitude=config.latitude,
                    elevation_m=elevation_m,
                    **{name: float(output[name]) for name in names},
                    shortwave_unit=parsed["units"]["ALLSKY_SFC_SW_DWN"],
                )
            writer.writerow(output)
    geojson_path = config.root / "layers" / "power-point.geojson"
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "product": "NASA POWER Temporal Daily Point",
                    "start": config.start.isoformat(),
                    "end": config.end.isoformat(),
                    "support": "regional background point; not a continuous field layer",
                },
                "geometry": {"type": "Point", "coordinates": [config.longitude, config.latitude]},
            }
        ],
    }
    geojson_path.write_text(json.dumps(geojson, ensure_ascii=False, indent=2) + "\n")
    return csv_path, geojson_path, parsed["days"]


def prepare_gpm(config: PipelineConfig) -> tuple[list[dict[str, Any]], dict[str, float]]:
    source = config.root / "processed" / "gpm-daily-aoi.csv"
    rows = list(csv.DictReader(source.open()))
    grouped: dict[int, dict[tuple[float, float], float]] = defaultdict(lambda: defaultdict(float))
    daily: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        if not row["rain_mm"]:
            continue
        stamp = date.fromisoformat(row["date"])
        value = float(row["rain_mm"])
        grouped[stamp.year][(float(row["longitude"]), float(row["latitude"]))] += value
        daily[row["date"]].append(value)
    if len(daily) != config.expected_days or any(not values for values in daily.values()):
        raise RuntimeError("GPM daily AOI series is incomplete; optimization is blocked")
    coordinates = sorted(next(iter(grouped.values())))
    lons = sorted({value[0] for value in coordinates})
    lats = sorted({value[1] for value in coordinates}, reverse=True)
    transform = from_bounds(
        min(lons) - 0.05,
        min(lats) - 0.05,
        max(lons) + 0.05,
        max(lats) + 0.05,
        len(lons),
        len(lats),
    )
    stacks: dict[int, np.ndarray] = {}
    records = []
    for year, values in grouped.items():
        array = np.array([[values.get((lon, lat), NODATA) for lon in lons] for lat in lats])
        stacks[year] = array
        path = config.root / "layers" / f"gpm-{year}-precipitation-mm.tif"
        _write_cog(path, array, transform=transform)
        records.append(
            _layer_record(
                path,
                product="GPM_3IMERGDF.07",
                variable="annual precipitation",
                units="mm/year",
                time=str(year),
                native_resolution="0.1 degree",
                qa="Final Daily; finite nonnegative cells only",
            )
        )
    climatology = np.mean(np.stack(list(stacks.values())), axis=0)
    for year, array in stacks.items():
        path = config.root / "layers" / f"gpm-{year}-precipitation-anomaly-mm.tif"
        _write_cog(path, array - climatology, transform=transform)
        records.append(
            _layer_record(
                path,
                product="GPM_3IMERGDF.07",
                variable="annual precipitation anomaly versus 2022-2024 mean",
                units="mm/year",
                time=str(year),
                native_resolution="0.1 degree",
            )
        )
    return records, {stamp: sum(values) / len(values) for stamp, values in daily.items()}


def _raster_sources(paths: list[Path]) -> list[rasterio.io.DatasetReader]:
    datasets: list[rasterio.io.DatasetReader] = []
    for path in paths:
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as archive:
                member = next(
                    (
                        name
                        for name in archive.namelist()
                        if name.lower().endswith((".hgt", ".tif"))
                    ),
                    None,
                )
            if member:
                datasets.append(rasterio.open(f"zip://{path}!{member}"))
        else:
            try:
                datasets.append(rasterio.open(path))
            except rasterio.RasterioIOError:
                continue
    return datasets


def prepare_srtm(config: PipelineConfig) -> tuple[list[dict[str, Any]], float]:
    datasets = _raster_sources(list((config.root / "raw" / "srtm").glob("*")))
    if not datasets:
        raise RuntimeError("No readable SRTM raster found")
    try:
        mosaic, transform = merge(datasets, bounds=config.bbox, nodata=NODATA)
    finally:
        for dataset in datasets:
            dataset.close()
    elevation = mosaic[0].astype("float32")
    elevation[(elevation < -500) | (elevation > 9000)] = NODATA
    elevation_path = config.root / "layers" / "srtm-elevation-m.tif"
    _write_cog(elevation_path, elevation, transform=transform)
    valid = elevation != NODATA
    mean_elevation = float(elevation[valid].mean())
    latitude = (config.bbox[1] + config.bbox[3]) / 2
    x_spacing = abs(transform.a) * 111_320 * math.cos(math.radians(latitude))
    y_spacing = abs(transform.e) * 110_574
    filled = np.where(valid, elevation, mean_elevation)
    dzdy, dzdx = np.gradient(filled, y_spacing, x_spacing)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype("float32")
    slope[~valid] = NODATA
    slope_path = config.root / "layers" / "srtm-slope-degrees.tif"
    _write_cog(slope_path, slope, transform=transform)
    aspect = (90 - np.degrees(np.arctan2(-dzdy, dzdx))) % 360
    aspect = aspect.astype("float32")
    aspect[~valid] = NODATA
    aspect_path = config.root / "layers" / "srtm-aspect-degrees.tif"
    _write_cog(aspect_path, aspect, transform=transform)
    atomic_json(
        config.root / "processed" / "srtm-summary.json",
        {"mean_elevation_m": mean_elevation, "source": "SRTMGL1.003", "bounds": list(config.bbox)},
    )
    return [
        _layer_record(
            elevation_path,
            product="SRTMGL1.003",
            variable="elevation",
            units="m",
            time="static",
            native_resolution="1 arc-second",
        ),
        _layer_record(
            slope_path,
            product="SRTMGL1.003",
            variable="slope",
            units="degree",
            time="static",
            native_resolution="derived from 1 arc-second DEM",
        ),
        _layer_record(
            aspect_path,
            product="SRTMGL1.003",
            variable="aspect",
            units="degree clockwise from north",
            time="static",
            native_resolution="derived from 1 arc-second DEM",
        ),
    ], mean_elevation


def _find_date(text: str) -> date | None:
    match = re.search(r"(?:^|[._-])(20\d{2})(\d{3})T", text)
    if match:
        return date(int(match[1]), 1, 1) + timedelta(days=int(match[2]) - 1)
    match = re.search(r"(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})", text)
    if match:
        try:
            return date(int(match[1]), int(match[2]), int(match[3]))
        except ValueError:
            pass
    match = re.search(r"A(20\d{2})(\d{3})", text)
    return date(int(match[1]), 1, 1) + timedelta(days=int(match[2]) - 1) if match else None


def _classify_hls(path: Path) -> tuple[str, str] | None:
    name = path.name.upper()
    sensor = "L30" if "HLSL30" in name else "S30" if "HLSS30" in name else ""
    for band in ("FMASK", "B04", "B05", "B06", "B8A", "B11"):
        if re.search(rf"(^|[._-]){band}([._-]|$)", name):
            return sensor, band
    return None


def _read_float(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    with rasterio.open(path) as source:
        array = source.read(1).astype("float32")
        metadata = {"transform": source.transform, "crs": source.crs, "nodata": source.nodata}
        if source.nodata is not None:
            array[array == source.nodata] = np.nan
        scale = source.scales[0] if source.scales else 1.0
        offset = source.offsets[0] if source.offsets else 0.0
        array = array * scale + offset
        return array, metadata


def prepare_hls(config: PipelineConfig) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    files = list((config.root / "raw" / "appeears" / "hls").glob("*.tif"))
    scenes: dict[tuple[date, str], dict[str, Path]] = defaultdict(dict)
    for path in files:
        stamp, kind = _find_date(path.name), _classify_hls(path)
        if stamp and kind:
            sensor, band = kind
            scenes[(stamp, sensor)][band] = path
    monthly: dict[str, dict[str, list[np.ndarray]]] = defaultdict(lambda: {"ndvi": [], "ndmi": []})
    templates: dict[str, dict[str, Any]] = {}
    valid_scenes: dict[str, int] = defaultdict(int)
    for (stamp, sensor), bands in scenes.items():
        needed = (
            ("B04", "B05", "B06", "FMASK") if sensor == "L30" else ("B04", "B8A", "B11", "FMASK")
        )
        if not all(name in bands for name in needed):
            continue
        red, metadata = _read_float(bands["B04"])
        nir, _ = _read_float(bands["B05" if sensor == "L30" else "B8A"])
        swir, _ = _read_float(bands["B06" if sensor == "L30" else "B11"])
        with rasterio.open(bands["FMASK"]) as source:
            fmask = source.read(1)
        clear = (fmask & 0b00111110) == 0
        valid = clear & np.isfinite(red) & np.isfinite(nir) & np.isfinite(swir)
        if valid.mean() < 0.05:
            continue
        scale = 0.0001 if np.nanpercentile(np.abs(red), 95) > 2 else 1.0
        red, nir, swir = red * scale, nir * scale, swir * scale
        ndvi = np.where(valid & (nir + red != 0), (nir - red) / (nir + red), np.nan)
        ndmi = np.where(valid & (nir + swir != 0), (nir - swir) / (nir + swir), np.nan)
        month = stamp.strftime("%Y-%m")
        monthly[month]["ndvi"].append(ndvi)
        monthly[month]["ndmi"].append(ndmi)
        templates[month] = metadata
        valid_scenes[month] += 1
    records = []
    missing = []
    cursor = date(config.start.year, config.start.month, 1)
    while cursor <= config.end:
        month = cursor.strftime("%Y-%m")
        if valid_scenes[month] == 0:
            missing.append(month)
        else:
            for variable in ("ndvi", "ndmi"):
                with np.errstate(all="ignore"):
                    array = np.nanmedian(np.stack(monthly[month][variable]), axis=0)
                output = np.where(np.isfinite(array), array, NODATA)
                metadata = templates[month]
                temp = config.root / "processed" / f"hls-{month}-{variable}-native.tif"
                _write_cog(temp, output, transform=metadata["transform"], crs=str(metadata["crs"]))
                path = config.root / "layers" / f"hls-{month}-{variable}.tif"
                _reproject_cog(temp, path)
                temp.unlink(missing_ok=True)
                records.append(
                    _layer_record(
                        path,
                        product="HLS L30/S30 V2.0",
                        variable=variable.upper(),
                        units="1",
                        time=month,
                        native_resolution="30 m",
                        qa="Fmask cloud/adjacent/shadow/snow excluded; monthly median",
                        valid_scenes=valid_scenes[month],
                    )
                )
        cursor = date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
    report = {
        "valid_scenes_by_month": dict(valid_scenes),
        "missing_months": missing,
        "requirement": "at least one valid scene; no interpolation",
    }
    atomic_json(config.root / "processed" / "hls-availability.json", report)
    return records, report


def _reproject_cog(source: Path, destination: Path) -> None:
    with rasterio.open(source) as src:
        if src.crs and src.crs.to_string() == "EPSG:4326":
            _write_cog(
                destination,
                src.read(),
                transform=src.transform,
                crs="EPSG:4326",
                nodata=src.nodata or NODATA,
            )
            return
        transform, width, height = calculate_default_transform(
            src.crs, "EPSG:4326", src.width, src.height, *src.bounds
        )
        output = np.full((src.count, height, width), NODATA, dtype="float32")
        for band in range(src.count):
            reproject(
                source=src.read(band + 1),
                destination=output[band],
                src_transform=src.transform,
                src_crs=src.crs,
                src_nodata=src.nodata,
                dst_transform=transform,
                dst_crs="EPSG:4326",
                dst_nodata=NODATA,
                resampling=Resampling.bilinear,
            )
    _write_cog(destination, output, transform=transform)


def prepare_ecostress(config: PipelineConfig) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for source in (config.root / "raw" / "appeears" / "ecostress").glob("*.tif"):
        name = source.name.upper()
        variable = (
            "LST"
            if re.search(r"(^|[._-])LST([._-]|$)", name)
            else "ET"
            if "ETDAILY" in name
            else None
        )
        stamp = _find_date(source.name)
        if variable is None or stamp is None:
            continue
        output = (
            config.root
            / "layers"
            / f"ecostress-v002-{stamp.isoformat()}-{variable.lower()}-{len(records):04d}.tif"
        )
        _reproject_cog(source, output)
        records.append(
            _layer_record(
                output,
                product="ECO_L2T_LSTE.002" if variable == "LST" else "ECO_L3T_JET.002",
                variable=variable,
                units="product native units; inspect source metadata",
                time=stamp.isoformat(),
                native_resolution="70 m nominal",
                qa="sparse validation layer; no temporal interpolation",
            )
        )
    return records


def prepare_smap(config: PipelineConfig) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    csv_files = list((config.root / "raw" / "appeears" / "smap").glob("*.csv"))
    if not csv_files:
        return [], {"missing": "No AppEEARS SMAP CSV found"}
    rows: list[dict[str, str]] = []
    for path in csv_files:
        rows.extend(csv.DictReader(path.open()))
    date_columns = [name for name in rows[0] if "date" in name.lower()]
    value_columns = [
        name for name in rows[0] if "rootzone" in name.lower() and "pctl" not in name.lower()
    ]
    if not date_columns or not value_columns:
        raise RuntimeError("Cannot identify SMAP date/root-zone columns in AppEEARS CSV")
    groups: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        raw_date = row[date_columns[0]]
        try:
            stamp = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
        except ValueError:
            stamp = datetime.strptime(raw_date[:10], "%m/%d/%Y").date()
        try:
            value = float(row[value_columns[0]])
        except (ValueError, TypeError):
            continue
        if math.isfinite(value) and 0 <= value <= 1:
            groups[stamp.strftime("%Y-%m")].append(value)
    records = []
    availability: dict[str, Any] = {}
    for month, values in sorted(groups.items()):
        year, number = (int(value) for value in month.split("-"))
        days = (date(year + (number == 12), number % 12 + 1, 1) - date(year, number, 1)).days
        # AppEEARS may return one row per field/time. Expect four fields and eight
        # three-hour intervals per day.
        expected = days * 8 * 4
        valid_rate = min(1.0, len(values) / expected)
        available = valid_rate >= 0.70
        availability[month] = {
            "expected": expected,
            "valid": len(values),
            "valid_rate": valid_rate,
            "available": available,
        }
        if not available:
            continue
        size = 0.081
        transform = from_bounds(
            config.longitude - size / 2,
            config.latitude - size / 2,
            config.longitude + size / 2,
            config.latitude + size / 2,
            1,
            1,
        )
        path = config.root / "layers" / f"smap-{month}-rootzone-moisture.tif"
        _write_cog(path, np.array([[sum(values) / len(values)]]), transform=transform)
        records.append(
            _layer_record(
                path,
                product="SPL4SMGP.008",
                variable="monthly root-zone soil moisture",
                units="m3/m3",
                time=month,
                native_resolution="9 km; one regional support cell",
                qa="monthly valid 3-hourly sample rate >=70%; four centroid samples averaged",
            )
        )
    report = {"months": availability, "threshold": 0.70, "no_interpolation": True}
    atomic_json(config.root / "processed" / "smap-availability.json", report)
    return records, report


def _grace_variable(dataset: xr.Dataset) -> str:
    preferred = [
        str(name)
        for name in dataset.data_vars
        if "lwe" in str(name).lower() and dataset[name].ndim >= 3
    ]
    if not preferred:
        preferred = [
            str(name)
            for name in dataset.data_vars
            if {"lat", "lon"} <= set(dataset[name].dims) and dataset[name].ndim >= 3
        ]
    if not preferred:
        raise RuntimeError("Cannot identify a GRACE water-storage variable")
    return preferred[0]


def prepare_grace(config: PipelineConfig) -> list[dict[str, Any]]:
    files = [
        path
        for path in (config.root / "raw" / "grace").glob("*")
        if path.suffix.lower() in {".nc", ".nc4"}
    ]
    if not files:
        raise RuntimeError("No GRACE NetCDF found")
    dataset = xr.open_dataset(files[0], decode_times=True)
    variable = _grace_variable(dataset)
    data = dataset[variable]
    time_name = next(str(name) for name in data.dims if "time" in str(name).lower())
    lat_name = next(str(name) for name in data.dims if "lat" in str(name).lower())
    lon_name = next(str(name) for name in data.dims if "lon" in str(name).lower())
    data = data.sel({time_name: slice(config.start.isoformat(), config.end.isoformat())})
    records = []
    for year in range(config.start.year, config.end.year + 1):
        annual = (
            data.where(data[time_name].dt.year == year, drop=True)
            .mean(time_name, skipna=True)
            .transpose(lat_name, lon_name)
        )
        values = np.asarray(annual.values, dtype="float32")
        lats, lons = np.asarray(annual[lat_name].values), np.asarray(annual[lon_name].values)
        if lons.max() > 180:
            order = np.argsort((lons + 180) % 360 - 180)
            lons = (lons[order] + 180) % 360 - 180
            values = values[:, order]
        if lats[0] < lats[-1]:
            lats = lats[::-1]
            values = values[::-1]
        values = np.where(np.isfinite(values), values, NODATA)
        dx = float(np.median(np.diff(np.sort(lons))))
        dy = float(np.median(np.diff(np.sort(lats))))
        transform = from_bounds(
            float(lons.min() - dx / 2),
            float(lats.min() - dy / 2),
            float(lons.max() + dx / 2),
            float(lats.max() + dy / 2),
            len(lons),
            len(lats),
        )
        path = config.root / "layers" / f"grace-{year}-water-storage-anomaly.tif"
        _write_cog(path, values, transform=transform)
        records.append(
            _layer_record(
                path,
                product="JPL GRACE/GRACE-FO Mascon CRI RL06.3 V4",
                variable=variable,
                units=data.attrs.get("units", "product native units"),
                time=str(year),
                native_resolution="mascon; effective support hundreds of kilometres",
                qa="annual mean of available monthly anomalies; no gap extrapolation",
            )
        )
    dataset.close()
    return records


def prepare_all(config: PipelineConfig) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    srtm_records, elevation = prepare_srtm(config)
    records.extend(srtm_records)
    power_json = config.root / "processed" / "power-daily.json"
    power_csv: Path | None = None
    power_geojson: Path | None = None
    if power_json.exists():
        power_csv, power_geojson, _ = prepare_power(config, elevation)
    gpm_csv = config.root / "processed" / "gpm-daily-aoi.csv"
    gpm_records: list[dict[str, Any]] = []
    gpm_status: dict[str, Any]
    if gpm_csv.exists():
        gpm_records, _ = prepare_gpm(config)
        gpm_status = {"available": True, "path": str(gpm_csv)}
    else:
        gpm_status = {
            "available": False,
            "required_for_optimization": True,
            "reason": "GPM IMERG Final Daily AOI science data has not been acquired",
        }
    records.extend(gpm_records)
    smap_records, smap_report = prepare_smap(config)
    records.extend(smap_records)
    hls_records, hls_report = prepare_hls(config)
    records.extend(hls_records)
    records.extend(prepare_ecostress(config))
    records.extend(prepare_grace(config))
    payload = {
        "schema": "sideronostos-nasa-layer-manifest-v1",
        "crs": "EPSG:4326",
        "layers": records,
        "non_raster_layers": [],
        "availability": {"smap": smap_report, "hls": hls_report},
        "core_inputs": {"power": power_csv is not None, "gpm": gpm_status},
        "interpretation": "Historical engineering benchmark layers; not future agronomic advice",
    }
    if power_geojson is None or power_csv is None:
        payload["non_raster_layers"] = []
    else:
        payload["non_raster_layers"] = [
            {
                "id": "power-point",
                "path": str(power_geojson),
                "table": str(power_csv),
                "warning": "Point support; no interpolated raster",
            }
        ]
    atomic_json(config.root / "layers" / "layer-manifest.json", payload)
    manifest = RunManifest(
        config.root / "run-manifest.json",
        config={"credentials": "Earthdata .netrc; never persisted"},
    )
    for record in records:
        manifest.add(
            {
                "key": f"derived:{record['id']}",
                "provider": "derived NASA layer",
                "path": record["path"],
                "size": Path(record["path"]).stat().st_size,
                "sha256": record["sha256"],
                "recipe": record,
            }
        )
    return payload
