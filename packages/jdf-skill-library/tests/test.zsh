#!/bin/zsh
# Tests for jdf-skill-library. A local bare repo stands in for GitHub.
#   zsh packages/jdf-skill-library/tests/test.zsh
set -uo pipefail

tool=${0:A:h:h}/jdf-skill-library
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export XDG_CACHE_HOME=$tmp/cache JDF_SKILL_LIBRARY_GITHUB=file://$tmp/gh
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git() { command git -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c tag.gpgsign=false "$@"; }

failures=0
check() {  # name condition...
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; (( failures++ )); fi
}

# Source repo: main has v3 (feature has 'feature'), tag v1 and commit $old.
src=$tmp/src
git init -q -b main "$src"
mkdir -p "$src/skills/demo" "$src/skills/skill-browser" "$src/ab/library" "$src/abc"
print 'name: skill-browser' > "$src/skills/skill-browser/SKILL.md"
print bait > "$src/ab/library/SKILL.md"
print bait > "$src/abc/SKILL.md"
print v1 > "$src/skills/demo/SKILL.md"
git -C "$src" add -A && git -C "$src" commit -qm v1 && git -C "$src" tag v1
print v2 > "$src/skills/demo/SKILL.md"
git -C "$src" commit -qam v2
old=$(git -C "$src" rev-parse HEAD)
print v3 > "$src/skills/demo/SKILL.md"
git -C "$src" commit -qam v3
git -C "$src" checkout -qb feature
print feature > "$src/skills/demo/SKILL.md"
git -C "$src" commit -qam feature
git -C "$src" checkout -q main
mkdir -p "$tmp/gh/joao"
git clone -q --bare "$src" "$tmp/gh/joao/skills.git"

root=$tmp/root
mkdir -p "$root"
demo() { cat "$root/library/demo/SKILL.dormant.md" 2>/dev/null; }
sync_with() {  # manifest line...
  print -l "$@" > "$root/manifest.txt"
  "$tool" sync "$root" >"$tmp/out" 2>&1
}

# GitHub refs: default branch, branch, tag, older commit (full and abbreviated).
sync_with 'browser github:joao/skills' 'github:joao/skills demo'
check "default branch" [ "$(demo)" = v3 ]
check "browser installed" [ -f "$root/SKILL.md" ]
sync_with 'github:joao/skills@feature demo'
check "branch" [ "$(demo)" = feature ]
sync_with 'github:joao/skills@v1 demo'
check "tag" [ "$(demo)" = v1 ]
sync_with "github:joao/skills@$old demo"
check "older commit id" [ "$(demo)" = v2 ]
sync_with "github:joao/skills@${old[1,10]} demo"
check "abbreviated commit id" [ "$(demo)" = v2 ]
check "no live SKILL.md" [ -z "$(find "$root/library" -name SKILL.md)" ]

# Unsafe skill names fail before anything changes.
print keep > "$root/library/keep.txt"
snapshot() { cd "$root" && find . -type f ! -name manifest.txt | sort | xargs shasum; }
before=$(snapshot)
for bad in ../library a/b .. . -rf '.hidden' 'a*'; do
  sync_with "github:joao/skills demo $bad"
  check "rejects '$bad'" [ $? -ne 0 ]
  check "'$bad' leaves the library unchanged" \
    [ "$(snapshot)" = "$before" ]
done

# Names match folder names literally, not as patterns.
sync_with 'github:joao/skills a.c'
check "'a.c' does not match abc/" [ $? -ne 0 -a ! -e "$root/library/a.c" ]

(( failures == 0 )) && echo "all passed" || { echo "$failures failed"; exit 1; }
