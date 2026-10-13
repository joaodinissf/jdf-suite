#!/bin/zsh
# Regression tests for jdf-keepalive. Never touches 1Password or posts input:
# the script runs from a scratch copy whose `nudge` is a no-op, and only the
# internal `_loop` subcommand (which skips signing) is exercised.
#
#   ./test.sh

set -euo pipefail

src=${0:A:h}/jdf-keepalive
tmp=$(mktemp -d)
ka=$tmp/jdf-keepalive
cp "$src" "$ka"
printf '#!/bin/sh\nexit 0\n' > "$tmp/nudge"
chmod +x "$ka" "$tmp/nudge"

pids=()
cleanup() { for p in $pids; do kill "$p" 2>/dev/null || true; done; rm -rf "$tmp"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
alive() { local n=0 p; for p in $pids; do kill -0 "$p" 2>/dev/null && n=$(( n + 1 )); done; echo $n; }

# Two loops claimed at the same moment: exactly one may keep running.
"$ka" _loop 60 1 >/dev/null 2>&1 & pids+=($!)
"$ka" _loop 60 1 >/dev/null 2>&1 & pids+=($!)
sleep 1.5
(( $(alive) == 1 )) || fail "expected 1 nudge loop, found $(alive)"

st=$("$ka" status)
owner=$(print -r -- "$st" | sed -nE '1s/^running \(pid ([0-9]+)\)$/\1/p')
[[ -n $owner ]] && kill -0 "$owner" 2>/dev/null || fail "status does not name the live loop: ${st%%$'\n'*}"
[[ ${pids[(Ie)$owner]} -gt 0 ]] || fail "status names pid $owner, not one of the loops (${pids})"

"$ka" stop >/dev/null
for _ in {1..30}; do (( $(alive) == 0 )) && break; sleep 0.1; done
(( $(alive) == 0 )) || fail "a nudge loop survived stop"
[[ $("$ka" status) == "not running"* ]] || fail "status after stop: $("$ka" status | head -1)"

# The claim dies with its owner, so a new loop can start after stop.
"$ka" _loop 60 1 >/dev/null 2>&1 & pids+=($!)
sleep 1
[[ $("$ka" status) == "running (pid $pids[-1])"* ]] || fail "loop did not restart after stop"
"$ka" stop >/dev/null

echo "ok"
