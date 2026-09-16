"""Tests for scripts/refresh_revs.py (parse + rewrite; no network)."""

import importlib.util
from pathlib import Path

from jdf_hooks.generate import get_templates_dir

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "refresh_revs.py"
spec = importlib.util.spec_from_file_location("refresh_revs", SCRIPT)
assert spec is not None and spec.loader is not None
refresh_revs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh_revs)

FRAGMENT = """# ===
# PYTHON
# ===
- repo: https://github.com/hadialqattan/pycln
  rev: v2.6.0
  hooks:
  - id: pycln
- repo: https://github.com/astral-sh/ruff-pre-commit
  rev: v0.15.5
  hooks:
  - id: ruff-format
- repo: local
  hooks:
  - id: ty
    entry: ty check
"""


def test_parse_revs():
    assert refresh_revs.parse_revs(FRAGMENT) == {
        "https://github.com/hadialqattan/pycln": "v2.6.0",
        "https://github.com/astral-sh/ruff-pre-commit": "v0.15.5",
    }


def test_rewrite_revs_only_changes_known_repos():
    revs = {
        "https://github.com/astral-sh/ruff-pre-commit": "v0.16.7",
        "https://github.com/hadialqattan/pycln": "v2.6.0",  # unchanged
        "https://github.com/somewhere/else": "v9",  # not in fragment
    }
    new_text, changes = refresh_revs.rewrite_revs(FRAGMENT, revs)
    assert changes == [("https://github.com/astral-sh/ruff-pre-commit", "v0.15.5", "v0.16.7")]
    assert "  rev: v0.16.7\n" in new_text
    assert "  rev: v2.6.0\n" in new_text
    assert new_text.replace("v0.16.7", "v0.15.5") == FRAGMENT


def test_bundled_fragments_parse():
    revs: dict[str, str] = {}
    for fragment in (get_templates_dir() / "precommit").glob("*.yml"):
        revs.update(refresh_revs.parse_revs(fragment.read_text()))
    assert "https://github.com/astral-sh/ruff-pre-commit" in revs
    assert all(rev for rev in revs.values())
