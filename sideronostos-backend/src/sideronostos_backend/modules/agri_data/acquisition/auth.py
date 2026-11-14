"""Earthdata authentication checks that never expose credential material."""

from __future__ import annotations

import netrc
from pathlib import Path
from typing import Any

import earthaccess


def earthdata_auth() -> Any:
    auth = earthaccess.login(strategy="netrc", persist=False)
    if not bool(auth.authenticated):
        raise RuntimeError("Earthdata authentication failed; configure ~/.netrc")
    return auth


def earthdata_credentials() -> tuple[str, str]:
    """Read credentials only for an in-memory Basic-auth exchange with AppEEARS."""
    entry = netrc.netrc(Path.home() / ".netrc").authenticators("urs.earthdata.nasa.gov")
    if entry is None or not entry[0] or not entry[2]:
        raise RuntimeError("Earthdata credentials are missing from ~/.netrc")
    return entry[0], entry[2]


def auth_summary() -> dict[str, object]:
    auth = earthdata_auth()
    return {
        "authenticated": bool(auth.authenticated),
        "strategy": "netrc",
        "credential_output": "suppressed",
    }
