#!/usr/bin/env python3
"""Refresh the `rev:` pins in the bundled pre-commit fragments.

Renders the all-languages .pre-commit-config.yaml into a temp dir, runs
`pre-commit autoupdate` there, and writes the resulting revs back into
src/jdf_hooks/templates/precommit/*.yml. Maintainer tool; needs network and
pre-commit on PATH.

Usage: uv run python scripts/refresh_revs.py [--check]
  --check   only report; exit 1 if any pin is behind (no files written)
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from jdf_hooks.generate import LANGUAGE_FRAGMENTS, generate_precommit_config, get_templates_dir  # noqa: E402

REPO_LINE = re.compile(r"^(\s*)-\s*repo:\s*(\S+)\s*$")
REV_LINE = re.compile(r"^(\s*)rev:\s*(\S+)\s*$")


def parse_revs(text: str) -> dict[str, str]:
    """Map each `- repo: URL` to the `rev:` that follows it."""
    revs: dict[str, str] = {}
    current: str | None = None
    for line in text.splitlines():
        if m := REPO_LINE.match(line):
            current = m.group(2)
        elif current and (m := REV_LINE.match(line)):
            revs[current] = m.group(2)
            current = None
    return revs


def rewrite_revs(text: str, revs: dict[str, str]) -> tuple[str, list[tuple[str, str, str]]]:
    """Return text with `rev:` lines updated to `revs`, plus (repo, old, new) for each change."""
    out: list[str] = []
    changes: list[tuple[str, str, str]] = []
    current: str | None = None
    for line in text.splitlines(keepends=True):
        replacement = line
        if m := REPO_LINE.match(line):
            current = m.group(2)
        elif current and (m := REV_LINE.match(line)):
            new = revs.get(current)
            old = m.group(2)
            if new and new != old:
                changes.append((current, old, new))
                replacement = f"{m.group(1)}rev: {new}\n"
            current = None
        out.append(replacement)
    return "".join(out), changes


def autoupdated_revs() -> dict[str, str]:
    """Render every fragment, autoupdate the result, and return the new pins."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["git", "init", "-q"], check=True, cwd=tmp)  # pre-commit insists on a repo
        config = generate_precommit_config(Path(tmp), set(LANGUAGE_FRAGMENTS))
        subprocess.run(["pre-commit", "autoupdate", "--config", str(config)], check=True, cwd=tmp)
        return parse_revs(config.read_text())


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    revs = autoupdated_revs()

    fragments_dir = get_templates_dir() / "precommit"
    total: list[tuple[str, str, str]] = []
    for fragment in sorted(fragments_dir.glob("*.yml")):
        text = fragment.read_text()
        new_text, changes = rewrite_revs(text, revs)
        if changes and not check_only:
            fragment.write_text(new_text)
        for repo, old, new in changes:
            print(f"{fragment.name}: {repo}  {old} -> {new}")
        total.extend(changes)

    if not total:
        print("All pre-commit revs are current.")
        return 0
    print(f"{len(total)} pin(s) {'behind' if check_only else 'updated'}.")
    return 1 if check_only else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
