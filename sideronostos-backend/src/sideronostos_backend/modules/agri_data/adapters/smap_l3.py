"""SPL3SMP_E/006 global grid: recommended AM and PM observations kept separate."""

import hashlib
import io
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import h5py  # type: ignore[import-untyped]
import numpy as np
from numpy.typing import NDArray
from PIL import Image
from pyproj import Transformer

RECIPE = "spl3smpe006-native-grid-qa0or8-v1"
GUIDE = "https://nsidc.org/sites/default/files/documents/user-guide/spl3smp_e-v006-userguide.pdf"
EPOCH = datetime(2000, 1, 1, 12, tzinfo=UTC)
PROJECT = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)
INVERSE = Transformer.from_crs("EPSG:6933", "EPSG:4326", always_xy=True)
PALETTE = np.array([[168, 104, 55], [218, 196, 128], [93, 170, 159], [36, 94, 151]])


def recommended_mask(values: NDArray[Any], flags: NDArray[Any]) -> NDArray[np.bool_]:
    if values.shape != flags.shape:
        raise ValueError("SMAP values and QA must use the same grid")
    return np.isfinite(values) & (values >= 0.02) & (values <= 0.50) & np.isin(flags, [0, 8])


def observation_time(seconds: float) -> str | None:
    if not np.isfinite(seconds) or seconds == -9999 or not -999999.9 <= seconds <= 940000000:
        return None
    return (EPOCH + timedelta(seconds=float(seconds))).isoformat()


def cell_index(xs: NDArray[Any], ys: NDArray[Any], x: float, y: float) -> tuple[int, int] | None:
    if not np.isfinite(x) or not np.isfinite(y):
        return None
    if len(xs) < 2 or len(ys) < 2 or not np.all(np.diff(xs) > 0) or not np.all(np.diff(ys) < 0):
        raise ValueError("Grid centers must be monotonic")
    if not (
        xs[0] - (xs[1] - xs[0]) / 2 <= x <= xs[-1] + (xs[-1] - xs[-2]) / 2
        and ys[-1] - (ys[-2] - ys[-1]) / 2 <= y <= ys[0] + (ys[0] - ys[1]) / 2
    ):
        return None
    col = int(np.searchsorted((xs[:-1] + xs[1:]) / 2, x))
    row = int(np.searchsorted(-(ys[:-1] + ys[1:]) / 2, -y))
    return row, col


def moisture_rgba(values: NDArray[Any]) -> NDArray[np.uint8]:
    valid = np.isfinite(values) & (values >= 0.02) & (values <= 0.50)
    fraction = np.clip((np.nan_to_num(values, nan=0.02) - 0.02) / 0.48, 0, 1)
    rgb = np.stack(
        [np.interp(fraction, np.linspace(0, 1, len(PALETTE)), PALETTE[:, i]) for i in range(3)],
        axis=-1,
    ).astype(np.uint8)
    return np.concatenate((rgb, (valid * 180).astype(np.uint8)[..., None]), axis=-1)


def _string(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


def grid_centers(
    latitude: NDArray[Any], longitude: NDArray[Any]
) -> tuple[NDArray[Any], NDArray[Any]]:
    """Recover the affine native grid from valid geolocation centers, not moisture.

    The granule's coordinate arrays also have fill values. Use any valid cell in
    each row/column, fit the equal-area axes, and reject non-affine coordinates.
    """
    if latitude.shape != longitude.shape or latitude.ndim != 2:
        raise ValueError("Coordinate arrays must describe one 2D grid")
    rows, columns = latitude.shape
    lat_ok = np.isfinite(latitude) & (np.abs(latitude) <= 85.045)
    lon_ok = np.isfinite(longitude) & (np.abs(longitude) <= 180)
    lat = np.where(lat_ok.any(axis=1), latitude[np.arange(rows), lat_ok.argmax(axis=1)], np.nan)
    lon = np.where(lon_ok.any(axis=0), longitude[lon_ok.argmax(axis=0), np.arange(columns)], np.nan)
    observed_x, _ = PROJECT.transform(lon, np.zeros_like(lon))
    _, observed_y = PROJECT.transform(np.zeros_like(lat), lat)
    result = []
    for values in (observed_x, observed_y):
        indices = np.arange(len(values))
        valid = np.isfinite(values)
        if valid.sum() < 2:
            raise ValueError("Insufficient native geolocation centers")
        slope, intercept = np.polyfit(indices[valid], values[valid], 1)
        centers = slope * indices + intercept
        if np.max(np.abs(centers[valid] - values[valid])) > 3:
            raise ValueError("Coordinates do not match an affine native grid")
        result.append(centers)
    xs, ys = result
    if not np.all(np.diff(xs) > 0) or not np.all(np.diff(ys) < 0):
        raise ValueError("Unexpected SMAP native grid orientation")
    return xs, ys


def prepare_smap(source: Path, destination: Path) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest: dict[str, Any] = {
        "product": "SPL3SMP_E",
        "product_version": "006",
        "recipe": RECIPE,
        "source_file": source.name,
        "sha256": digest,
        "crs": "EPSG:6933",
        "geolocation_recipe": "affine-fit-valid-granule-centers-residual-under-3m",
        "unit": "m3/m3",
        "depth_cm": [0, 5],
        "grid_spacing_label": "9 km grid; radiometer footprint approximately 36 km",
        "data_kind": "satellite_retrieval",
        "spatial_support": "regional_surface_background",
        "guide_url": GUIDE,
        "doi": "10.5067/M20OXIZHY3RJ",
        "citation": (
            "O’Neill et al. (2021), SMAP Enhanced L3 Radiometer Global and Polar Grid "
            "Daily 9 km EASE-Grid Soil Moisture, Version 6. NASA NSIDC DAAC."
        ),
        "prepared_at": datetime.now(UTC).isoformat(),
        "passes": {},
        "limitations": [
            "Single day: trends, anomalies and persistence are unavailable.",
            "Surface moisture is not root-zone storage or an irrigation prescription.",
            "AM and PM are separate passes; overlapping grids are not independent fields.",
            "No field-scale downscaling or polygon mean is inferred from these pixels.",
        ],
    }
    with h5py.File(source, "r") as document:
        identity = document["Metadata/DatasetIdentification"].attrs
        if (
            _string(identity["shortName"]) != "SPL3SMP_E"
            or _string(identity["ECSVersionID"]) != "006"
        ):
            raise ValueError("This adapter requires SPL3SMP_E collection 006")
        extent = document["Metadata/Extent"].attrs
        manifest.update(
            start=_string(extent["rangeBeginningDateTime"]),
            end=_string(extent["rangeEndingDateTime"]),
            composite_release=_string(identity["CompositeReleaseID"]),
        )
        manifest["bounds"] = [
            -180,
            float(extent["southBoundLatitude"]),
            180,
            float(extent["northBoundLatitude"]),
        ]
        for orbit in ("AM", "PM"):
            group = document[f"Soil_Moisture_Retrieval_Data_{orbit}"]
            suffix = "" if orbit == "AM" else "_pm"
            water = group[f"soil_moisture{suffix}"]
            attrs = water.attrs
            if water.shape != (1624, 3856) or _string(attrs["units"]) != "cm**3/cm**3":
                raise ValueError("Unexpected SMAP grid or unit")
            if not np.isclose(float(attrs["valid_min"]), 0.02) or not np.isclose(
                float(attrs["valid_max"]), 0.50
            ):
                raise ValueError("Unexpected SMAP physical range")
            values = np.asarray(water[:], dtype=np.float32)
            flags = np.asarray(group[f"retrieval_qual_flag{suffix}"][:], dtype=np.uint16)
            surface = np.asarray(group[f"surface_flag{suffix}"][:], dtype=np.uint16)
            seconds = np.asarray(group[f"tb_time_seconds{suffix}"][:], dtype=np.float64)
            uncertainty = np.asarray(group[f"soil_moisture_error{suffix}"][:], dtype=np.float32)
            valid_range = (
                np.isfinite(values)
                & (values >= float(attrs["valid_min"]))
                & (values <= float(attrs["valid_max"]))
            )
            mask = recommended_mask(values, flags)
            error_ok = np.isfinite(uncertainty) & (uncertainty >= 0) & (uncertainty <= 0.2)
            xs, ys = grid_centers(
                np.asarray(group[f"latitude{suffix}"][:], dtype=np.float64),
                np.asarray(group[f"longitude{suffix}"][:], dtype=np.float64),
            )
            values[~mask] = np.nan
            uncertainty[~error_ok] = np.nan
            seconds[(seconds == -9999) | ~np.isfinite(seconds)] = np.nan
            target = destination / f"{orbit.lower()}.npz"
            np.savez_compressed(
                target,
                moisture=values,
                retrieval_qa=flags,
                surface_qa=surface,
                time_seconds=seconds,
                uncertainty=uncertainty,
                x_centers=xs,
                y_centers=ys,
            )
            with target.open("rb") as stream:
                asset_digest = hashlib.file_digest(stream, "sha256").hexdigest()
            manifest["passes"][orbit] = {
                "asset": target.name,
                "asset_sha256": asset_digest,
                "total_grid_cells": int(values.size),
                "range_valid_count": int(valid_range.sum()),
                "recommended_count": int(mask.sum()),
                "recommended_share_of_range_valid": float(mask.sum() / valid_range.sum()),
                "uncertainty_valid_count": int(error_ok.sum()),
                "uncertainty_status": "available" if error_ok.any() else "not_provided",
                "x_spacing_median_m": float(np.median(np.diff(xs))),
                "y_spacing_median_m": float(np.median(-np.diff(ys))),
                "shape": list(values.shape),
            }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    return manifest


def point_fact(grid: dict[str, Any], longitude: float, latitude: float) -> dict[str, Any]:
    if not -180 <= longitude <= 180 or not -85.0445 <= latitude <= 85.0445:
        return {"status": "outside_coverage", "value": None}
    x, y = PROJECT.transform(longitude, latitude)
    cell = cell_index(grid["x_centers"], grid["y_centers"], x, y)
    if cell is None:
        return {"status": "outside_coverage", "value": None}
    row, col = cell
    value = float(grid["moisture"][row, col])
    uncertainty = float(grid["uncertainty"][row, col])
    center_lon, center_lat = INVERSE.transform(grid["x_centers"][col], grid["y_centers"][row])
    return {
        "status": "available" if np.isfinite(value) else "no_recommended_retrieval",
        "value": value if np.isfinite(value) else None,
        "unit": "m3/m3",
        "row": row,
        "column": col,
        "center": [center_lon, center_lat],
        "acquired_at": observation_time(float(grid["time_seconds"][row, col])),
        "retrieval_qual_flag": int(grid["retrieval_qa"][row, col]),
        "surface_flag": int(grid["surface_qa"][row, col]),
        "uncertainty": uncertainty if np.isfinite(uncertainty) else None,
        "spatial_support": "native_grid_background",
        "not_field_measurement": True,
    }


def raster_tile(grid: dict[str, Any], z: int, x: int, y: int) -> bytes:
    if not 0 <= z <= 12 or not 0 <= x < 2**z or not 0 <= y < 2**z:
        raise ValueError("Unsupported tile coordinate")
    axis = (np.arange(256) + 0.5) / 256
    lon = (x + axis) / (2**z) * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + axis) / (2**z)))))
    xs, _ = PROJECT.transform(lon, np.zeros_like(lon))
    _, ys = PROJECT.transform(np.zeros_like(lat), lat)
    gx, gy = grid["x_centers"], grid["y_centers"]
    columns = np.searchsorted((gx[:-1] + gx[1:]) / 2, xs)
    rows = np.searchsorted(-(gy[:-1] + gy[1:]) / 2, -ys)
    values = grid["moisture"][np.ix_(rows, columns)].copy()
    values[(lat < -85.0445) | (lat > 85.0445), :] = np.nan
    output = io.BytesIO()
    Image.fromarray(moisture_rgba(values)).save(output, format="PNG")
    return output.getvalue()
