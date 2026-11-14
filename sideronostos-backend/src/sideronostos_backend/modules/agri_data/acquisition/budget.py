"""Storage guards applied before planning and before each write."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path


class BudgetExceeded(RuntimeError):
    """A planned write violates a product, run, or free-space limit."""


def tree_size(path: Path) -> int:
    return (
        sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
        if path.exists()
        else 0
    )


@dataclass(frozen=True)
class StorageBudget:
    root: Path
    hard_limit_bytes: int
    min_free_bytes: int
    product_limits: dict[str, int]

    def check(self, *, additional_bytes: int = 0, product: str | None = None) -> dict[str, int]:
        if additional_bytes < 0:
            raise ValueError("additional_bytes must be nonnegative")
        current = tree_size(self.root)
        free = shutil.disk_usage(self.root.parent if self.root.parent.exists() else Path.cwd()).free
        if current + additional_bytes > self.hard_limit_bytes:
            raise BudgetExceeded("NASA run would exceed the 12 GiB hard limit")
        if free - additional_bytes < self.min_free_bytes:
            raise BudgetExceeded("NASA write would leave less than 50 GiB free")
        if product is not None:
            if product not in self.product_limits:
                raise ValueError(f"Unknown product budget: {product}")
            product_root = self.root / "raw" / product
            appeears_root = self.root / "raw" / "appeears" / product
            if appeears_root.exists():
                product_root = appeears_root
            used = tree_size(product_root)
            if used + additional_bytes > self.product_limits[product]:
                raise BudgetExceeded(f"{product} would exceed its product budget")
        return {"current_bytes": current, "free_bytes": free, "additional_bytes": additional_bytes}
