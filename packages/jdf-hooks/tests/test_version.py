"""Guard against the package version drifting from pyproject.toml."""

import tomllib
from pathlib import Path

import jdf_hooks

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_version_matches_pyproject():
    with PYPROJECT.open("rb") as f:
        declared = tomllib.load(f)["project"]["version"]
    assert jdf_hooks.__version__ == declared
