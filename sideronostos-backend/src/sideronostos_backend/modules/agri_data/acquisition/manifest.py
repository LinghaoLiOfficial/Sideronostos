"""Atomic manifest and download primitives without credential persistence."""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from .budget import StorageBudget


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def safe_url(url: str) -> str:
    parts = urlsplit(url)
    private_terms = (
        "token",
        "credential",
        "signature",
        "authorization",
        "password",
        "secret",
        "x-amz",
    )
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not any(term in key.lower() for term in private_terms)
        ]
    )
    return urlunsplit((parts.scheme, parts.hostname or "", parts.path, query, ""))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    os.replace(temporary, path)


class RunManifest:
    def __init__(self, path: Path, *, config: dict[str, Any]) -> None:
        self.path = path
        if path.exists():
            self.data = json.loads(path.read_text())
        else:
            self.data = {
                "schema": "sideronostos-nasa-run-v1",
                "created_at": utc_now(),
                "status": "running",
                "config": config,
                "records": [],
                "failures": [],
            }
            self.save()

    def add(self, record: dict[str, Any]) -> None:
        normalized = dict(record)
        if "url" in normalized:
            normalized["url"] = safe_url(str(normalized["url"]))
        normalized.setdefault("recorded_at", utc_now())
        key = normalized.get("key")
        if key and any(item.get("key") == key for item in self.data["records"]):
            return
        self.data["records"].append(normalized)
        self.save()

    def failure(self, *, stage: str, reason: str) -> None:
        self.data["failures"].append({"stage": stage, "reason": reason, "recorded_at": utc_now()})
        self.save()

    def finish(self, status: str = "complete") -> None:
        self.data.update(status=status, finished_at=utc_now())
        self.save()

    def save(self) -> None:
        atomic_json(self.path, self.data)


def download(
    client: httpx.Client,
    *,
    url: str,
    destination: Path,
    budget: StorageBudget,
    product: str,
    expected_size: int | None = None,
    expected_sha256: str | None = None,
    max_retries: int = 6,
) -> dict[str, Any]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        digest = sha256_file(destination)
        if expected_sha256 is None or digest.lower() == expected_sha256.lower():
            return {
                "path": str(destination),
                "size": destination.stat().st_size,
                "sha256": digest,
                "resumed": True,
            }
        raise ValueError(f"Existing file checksum mismatch: {destination}")
    if expected_size is not None:
        part_size = (
            destination.with_suffix(destination.suffix + ".part").stat().st_size
            if destination.with_suffix(destination.suffix + ".part").exists()
            else 0
        )
        budget.check(additional_bytes=max(0, expected_size - part_size), product=product)
    part = destination.with_suffix(destination.suffix + ".part")
    offset = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    for attempt in range(max_retries + 1):
        try:
            with client.stream(
                "GET", url, headers=headers, follow_redirects=True, timeout=120
            ) as response:
                if response.status_code == 429:
                    if attempt >= max_retries:
                        response.raise_for_status()
                    retry_after = response.headers.get("retry-after")
                    delay = (
                        float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt
                    )
                    time.sleep(min(120.0, max(1.0, delay)))
                    continue
                response.raise_for_status()
                if offset and response.status_code != 206:
                    part.unlink(missing_ok=True)
                    offset = 0
                    headers = {}
                remaining = int(response.headers.get("content-length", "0"))
                budget.check(additional_bytes=remaining, product=product)
                with part.open("ab" if offset else "wb") as stream:
                    for chunk in response.iter_bytes(1024 * 1024):
                        budget.check(additional_bytes=len(chunk), product=product)
                        stream.write(chunk)
                break
        except httpx.HTTPStatusError as error:
            if error.response.status_code != 429 or attempt >= max_retries:
                raise
            time.sleep(min(120.0, float(2**attempt)))
    digest = sha256_file(part)
    if expected_sha256 and digest.lower() != expected_sha256.lower():
        raise ValueError(f"Downloaded checksum mismatch: {destination}")
    os.replace(part, destination)
    return {
        "path": str(destination),
        "size": destination.stat().st_size,
        "sha256": digest,
        "resumed": bool(offset),
    }


def combined_sha256(paths: Iterable[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.name.encode())
        digest.update(sha256_file(path).encode())
    return digest.hexdigest()
