"""scripts/check_release.py: a release tag must name the version in pyproject.toml."""

import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

PACKAGE = Path(__file__).parents[1]
SCRIPT = PACKAGE / "scripts" / "check_release.py"
VERSION = tomllib.loads((PACKAGE / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]


def check(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False)


def test_matching_tag_passes():
    proc = check(f"jdf-stt-v{VERSION}")
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == f"{VERSION}\n"  # the workflow reads the version from stdout


@pytest.mark.parametrize(
    "tag",
    [
        "jdf-stt-v9.9.9",  # another version
        f"v{VERSION}",  # no package prefix
        f"jdf-hooks-v{VERSION}",  # another package's tag
        f"jdf-stt-v{VERSION}.post1",  # close, but not equal
    ],
)
def test_other_tags_fail(tag):
    proc = check(tag)
    assert proc.returncode == 1
    assert proc.stdout == ""
    assert tag in proc.stderr and VERSION in proc.stderr


def test_missing_tag_is_a_usage_error():
    assert check().returncode == 2
