"""Check that a release tag names the version in pyproject.toml.

Usage: python scripts/check_release.py jdf-stt-vX.Y.Z

Prints the version and exits 0 when the tag is exactly `jdf-stt-v` + `project.version`;
otherwise explains the mismatch on stderr and exits 1. The release workflow runs this
before building, so a tag can never publish a different version than it names.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

PREFIX = "jdf-stt-v"
PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a jdf-stt release tag against pyproject.toml.")
    parser.add_argument("tag", help=f"the git tag, e.g. {PREFIX}0.1.0")
    tag = parser.parse_args(argv).tag
    version = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]["version"]
    if tag != f"{PREFIX}{version}":
        print(
            f"error: tag {tag!r} does not match pyproject.toml version {version!r} (expected {PREFIX}{version})",
            file=sys.stderr,
        )
        return 1
    print(version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
