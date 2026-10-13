#!/bin/zsh
# Experiment: do synthetic nudges ALONE keep 1Password unlocked past its idle
# auto-lock? Start it right as you leave the Mac.
#
#   experiment.sh nudge    nudges every INTERVAL, no signing for WAIT, then sign once
#   experiment.sh control  same, but no nudges (expect the final sign to fail)
#   experiment.sh full     nudge phase, then control phase (2 x WAIT)
#
# Validity requires that nothing else signs via 1Password during the run
# (no committing agents) and that the Mac isn't touched locally or remotely.
# A monitor logs idle time and screen-lock state every
# 5 min; caffeinate -d keeps the display on; display/sleep events for the run
# are pulled from `pmset -g log` at the end.
#
# Usage: experiment.sh nudge|control|full [wait_s=4500] [interval_s=900]

set -euo pipefail

mode=${1:?usage: experiment.sh nudge|control|full [wait_s] [interval_s]}
wait_s=${2:-4500}
interval=${3:-900}
dir=${0:A:h}
log=$dir/experiment.log
repo=$(mktemp -d)/signtest

say() { echo "$(date '+%F %T') [$mode] $*" | tee -a "$log"; }
idle() { ioreg -c IOHIDSystem | awk '/HIDIdleTime/ && !d {printf "%.0f", $NF/1e9; d=1}'; }
# Capture first: `ioreg | grep -q` under pipefail fails with SIGPIPE (141).
screen_locked() { [[ $(ioreg -n Root -d1 -a) == *CGSSessionScreenIsLocked* ]] && echo yes || echo no; }
state() { echo "idle=$(idle)s screen_locked=$(screen_locked)"; }

# A locked 1Password makes op-ssh-sign wait on a prompt; give up after 90 s.
sign() {
  perl -e 'alarm 90; exec @ARGV' git -C "$repo" commit -q --allow-empty -m "experiment $(date '+%T')" 2>/dev/null &&
    git -C "$repo" log -1 --format='%G?' | grep -qx G
}

check() {  # $1 = phase name; prints SIGNED or FAILED
  local r; if sign; then r=SIGNED; else r=FAILED; fi
  say "$1 final sign after ${wait_s}s: $r | $(state)" >&2
  echo $r
}

[[ $mode == (nudge|control|full) ]] || { echo "unknown mode: $mode"; exit 2; }
# 1Password's idle auto-lock, as set in its Security settings. Never read it
# from 1Password's own files: they are another app's private data.
autolock=${AUTOLOCK_MIN:-60}
(( wait_s > autolock * 60 )) || { say "abort: wait ${wait_s}s must exceed autolock ${autolock}min"; exit 1; }

[[ $("$dir/jdf-keepalive" status) == running* ]] && { say "abort: a jdf-keepalive loop is already running; stop it first"; exit 1; }

start_ts=$(date '+%F %T')
git init -q "$repo"
say "start: autolock=${autolock}min wait=${wait_s}s interval=${interval}s | $(state)"
sign || { say "abort: baseline sign failed (1Password must be unlocked at start)"; exit 1; }
say "baseline sign ok; no further signing until each phase's final check"

( while sleep 300; do say "monitor: $(state)"; done ) &
monitor=$!
# Keep the display on so "lock when device sleeps" can't interfere. This is a
# power assertion, not input: it doesn't reset the HID idle timer.
caffeinate -d &
awake=$!
trap 'kill $monitor $awake 2>/dev/null' EXIT

nudge_r= control_r=
if [[ $mode == (nudge|full) ]]; then
  say "phase nudge: ${wait_s}s with nudges every ${interval}s"
  "$dir/jdf-keepalive" run "$wait_s" "$interval" >/dev/null
  nudge_r=$(check nudge)
fi
if [[ $mode == (control|full) ]]; then
  # In full mode the nudge check just signed; that's the new "last activity".
  say "phase control: ${wait_s}s with no nudges and no signing"
  sleep "$wait_s"
  control_r=$(check control)
fi

case $nudge_r in
  SIGNED) say "verdict nudge: nudges alone keep 1Password unlocked" ;;
  FAILED) say "verdict nudge: nudges do NOT keep 1Password unlocked (see screen_locked/display events)" ;;
esac
case $control_r in
  FAILED) say "verdict control: ok, 1Password locks on schedule without nudges" ;;
  SIGNED) say "verdict control: anomaly, stayed unlocked without nudges (other input? see idle values)" ;;
esac

say "display/sleep events since $start_ts:"
pmset -g log | awk -v s="$start_ts" '$1" "$2 >= s' | grep -Ei 'display is turned|Entering Sleep|Wake from' | tee -a "$log" || say "(none)"
say "nudge 'before' idle values should be ~${interval}s; lower values mean real input and void the run"
