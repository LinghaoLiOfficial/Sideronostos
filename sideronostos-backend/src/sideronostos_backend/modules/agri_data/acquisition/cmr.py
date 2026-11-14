"""NASA CMR collection/granule discovery; metadata is never treated as science data."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

CMR = "https://cmr.earthdata.nasa.gov/search"


@dataclass(frozen=True)
class Collection:
    key: str
    concept_id: str
    short_name: str
    version: str
    provider: str


COLLECTIONS = {
    "gpm": Collection("gpm", "C2723754864-GES_DISC", "GPM_3IMERGDF", "07", "GES_DISC"),
    "smap": Collection("smap", "C3480440870-NSIDC_CPRD", "SPL4SMGP", "008", "NSIDC_CPRD"),
    "hlsl30": Collection("hlsl30", "C2021957657-LPCLOUD", "HLSL30", "2.0", "LPCLOUD"),
    "hlss30": Collection("hlss30", "C2021957295-LPCLOUD", "HLSS30", "2.0", "LPCLOUD"),
    "ecostress_lst_v2": Collection(
        "ecostress_lst_v2", "C2076090826-LPCLOUD", "ECO_L2T_LSTE", "002", "LPCLOUD"
    ),
    "ecostress_et_v2": Collection(
        "ecostress_et_v2", "C2076106409-LPCLOUD", "ECO_L3T_JET", "002", "LPCLOUD"
    ),
    "srtm": Collection("srtm", "C2763266360-LPCLOUD", "SRTMGL1", "003", "LPCLOUD"),
    "grace": Collection(
        "grace",
        "C3195527175-POCLOUD",
        "TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4",
        "4",
        "POCLOUD",
    ),
}


class CMRClient:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self.client = client or httpx.Client(
            headers={"User-Agent": "Sideronostos-NASA/1.0"}, timeout=60
        )

    def granules(
        self,
        collection: Collection,
        *,
        start: date | None,
        end: date | None,
        bbox: tuple[float, float, float, float] | None,
        page_size: int = 2000,
        page_num: int = 1,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "collection_concept_id": collection.concept_id,
            "page_size": page_size,
            "page_num": page_num,
        }
        if start and end:
            params["temporal"] = f"{start.isoformat()}T00:00:00Z,{end.isoformat()}T23:59:59Z"
        if bbox:
            params["bounding_box"] = ",".join(str(value) for value in bbox)
        response = self.client.get(f"{CMR}/granules.umm_json", params=params)
        response.raise_for_status()
        payload = response.json()
        return {
            "hits": int(response.headers.get("CMR-Hits", len(payload.get("items", [])))),
            "items": payload.get("items", []),
            "query_url": str(response.request.url),
        }


def related_urls(item: dict[str, Any], *, subtype: str | None = None) -> list[str]:
    urls: list[str] = []
    for relation in item.get("umm", {}).get("RelatedUrls", []):
        if subtype and relation.get("Subtype") != subtype:
            continue
        url = relation.get("URL")
        if url and isinstance(url, str):
            urls.append(url)
    return urls


def granule_size(item: dict[str, Any]) -> int | None:
    for archive in (
        item.get("umm", {}).get("DataGranule", {}).get("ArchiveAndDistributionInformation", [])
    ):
        size = archive.get("Size")
        unit = str(archive.get("SizeUnit", "Bytes")).lower()
        if isinstance(size, (float, int)):
            factor = {"bytes": 1, "kb": 1000, "mb": 1000**2, "gb": 1000**3}.get(unit)
            if factor:
                return int(size * factor)
    return None
