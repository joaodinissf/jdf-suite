"""Best-effort lookup of the newest jdf-hooks release on PyPI."""

import json
import os
import urllib.request

PYPI_JSON_URL = "https://pypi.org/pypi/jdf-hooks/json"
OFFLINE_ENV = "JDF_HOOKS_OFFLINE"


def offline_requested() -> bool:
    return os.environ.get(OFFLINE_ENV, "").strip() not in ("", "0", "false", "no")


def latest_version(timeout: float = 2.0) -> str | None:
    """Return the latest version string on PyPI, or None on any failure (never raises)."""
    try:
        with urllib.request.urlopen(PYPI_JSON_URL, timeout=timeout) as response:  # noqa: S310 — fixed https URL
            return str(json.load(response)["info"]["version"])
    except Exception:  # noqa: BLE001 — network, JSON, or schema; all mean "don't know"
        return None


def _key(version: str) -> tuple[int, ...]:
    parts: list[int] = []
    for piece in version.split("."):
        digits = ""
        for ch in piece:
            if not ch.isdigit():
                break
            digits += ch
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def is_newer(candidate: str, installed: str) -> bool:
    """True if candidate is a strictly newer release than installed (numeric dotted compare)."""
    return _key(candidate) > _key(installed)
