"""Fixed engineering-benchmark configuration and filesystem contract."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

GIB = 1024**3


@dataclass(frozen=True)
class PipelineConfig:
    root: Path
    start: date = date(2022, 1, 1)
    end: date = date(2024, 12, 31)
    latitude: float = 42.0
    longitude: float = -93.5
    bbox: tuple[float, float, float, float] = (-93.56, 41.97, -93.44, 42.05)
    hard_limit_bytes: int = 12 * GIB
    min_free_bytes: int = 50 * GIB
    product_budgets: dict[str, int] = field(
        default_factory=lambda: {
            "power": 50 * 1024**2,
            "gpm": int(1.5 * GIB),
            "smap": int(1.5 * GIB),
            "hls": 4 * GIB,
            "ecostress": 2 * GIB,
            "srtm": 256 * 1024**2,
            "grace": 256 * 1024**2,
            "derived": int(2.45 * GIB),
        }
    )

    @classmethod
    def default(cls, repo_root: Path) -> PipelineConfig:
        return cls(root=repo_root / "data" / "nasa" / "iowa-2022-2024")

    @classmethod
    def load(cls, path: Path) -> PipelineConfig:
        raw = json.loads(path.read_text())
        raw["root"] = Path(raw["root"])
        raw["start"] = date.fromisoformat(raw["start"])
        raw["end"] = date.fromisoformat(raw["end"])
        raw["bbox"] = tuple(raw["bbox"])
        return cls(**raw)

    def dump(self, path: Path) -> None:
        payload: dict[str, Any] = asdict(self)
        payload.update(root=str(self.root), start=self.start.isoformat(), end=self.end.isoformat())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    @property
    def expected_days(self) -> int:
        return (self.end - self.start).days + 1

    def ensure_directories(self) -> None:
        for relative in (
            "aoi",
            "audit",
            "raw/power",
            "raw/gpm",
            "raw/appeears",
            "raw/srtm",
            "raw/grace",
            "processed",
            "layers",
            "optimization",
        ):
            (self.root / relative).mkdir(parents=True, exist_ok=True)
