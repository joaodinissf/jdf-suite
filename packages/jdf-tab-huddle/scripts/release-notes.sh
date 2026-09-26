#!/usr/bin/env bash
# Print the GitHub Release notes for a jdf-tab-huddle tag: that version's
# README "Version History" entry, then the package's commits since the
# previous jdf-tab-huddle tag. Run from packages/jdf-tab-huddle of the tagged
# tree: it reads that tree's README.md and git history.
#
#   scripts/release-notes.sh jdf-tab-huddle-v0.4.1
set -euo pipefail

tag="${1:?usage: release-notes.sh <jdf-tab-huddle-vX.Y.Z>}"
version="${tag#jdf-tab-huddle-v}"

# Anchored, so a line that merely quotes the prefix can't match.
escaped="$(printf '%s' "$version" | sed 's/[.]/\\./g')"
entry="$(grep -m1 -E -- "^- \\*\\*v${escaped}\\*\\*:" README.md || true)"
if [ -z "$entry" ]; then
  echo "error: README.md has no Version History entry for v${version}" >&2
  exit 1
fi
entry="${entry#"- **v${version}**:"}"
entry="${entry# }"

# The tag listed right after this one, in descending version order.
previous="$(git tag --list 'jdf-tab-huddle-v*' --sort=-v:refname \
  | awk -v tag="$tag" 'found { print; exit } $0 == tag { found = 1 }')"
range="${previous:+${previous}..}${tag}"

printf '## Highlights\n\n%s\n\n## Changes\n\n' "$entry"
git log --pretty=format:'- %s' --no-merges "$range" -- .
printf '\n'
