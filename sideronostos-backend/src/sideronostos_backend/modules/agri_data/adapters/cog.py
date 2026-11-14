"""Render a published EPSG:4326 GeoTIFF into a Web Mercator PNG tile."""

from __future__ import annotations

import io
import math
from pathlib import Path


def web_mercator_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    if not 0 <= z <= 18 or not 0 <= x < 2**z or not 0 <= y < 2**z:
        raise ValueError("Invalid tile coordinate")
    extent = 20037508.342789244
    size = 2 * extent / 2**z
    return (
        -extent + x * size,
        extent - (y + 1) * size,
        -extent + (x + 1) * size,
        extent - y * size,
    )


def raster_tile(path: Path, z: int, x: int, y: int, minimum: float, maximum: float) -> bytes:
    if not all(math.isfinite(value) for value in (minimum, maximum)) or maximum <= minimum:
        raise ValueError("Invalid raster legend")
    try:
        import numpy as np
        import rasterio  # type: ignore[import-untyped]
        from PIL import Image
        from rasterio.enums import Resampling  # type: ignore[import-untyped]
        from rasterio.transform import from_bounds  # type: ignore[import-untyped]
        from rasterio.warp import reproject  # type: ignore[import-untyped]
    except ImportError as error:
        raise RuntimeError("Raster tile dependencies are unavailable") from error
    destination = np.full((256, 256), np.nan, dtype=np.float32)
    with rasterio.open(path) as source:
        reproject(
            source=rasterio.band(source, 1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=from_bounds(*web_mercator_bounds(z, x, y), 256, 256),
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    valid = np.isfinite(destination)
    fraction = np.clip(
        (np.nan_to_num(destination, nan=minimum) - minimum) / (maximum - minimum), 0, 1
    )
    anchors = np.array([[55, 92, 62], [217, 194, 111], [70, 145, 158], [36, 84, 125]])
    rgb = np.stack(
        [
            np.interp(fraction, np.linspace(0, 1, len(anchors)), anchors[:, index])
            for index in range(3)
        ],
        axis=-1,
    ).astype(np.uint8)
    rgba = np.concatenate((rgb, (valid * 190).astype(np.uint8)[..., None]), axis=-1)
    output = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(output, format="PNG", optimize=True)
    return output.getvalue()
