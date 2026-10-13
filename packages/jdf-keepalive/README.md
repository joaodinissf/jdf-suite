# jdf-keepalive

Keeps 1Password's SSH agent able to sign git commits while you are away from
the Mac — for agents that keep working and committing after you leave.

## Why

1Password locks after a period with no keyboard, mouse or trackpad input.
Signing a commit does not count as input, so a long-running agent loses commit
signing about an hour after you leave. After any lock, the SSH agent also asks
once per app to approve the key again.

## How

```sh
jdf-keepalive start [duration=4h] [interval=15m]   # check, sign once, nudge in the background
jdf-keepalive run   [duration=4h] [interval=15m]   # same, in the foreground
jdf-keepalive status                               # loop, idle time, screen, display, permission
jdf-keepalive stop
```

`start`:

1. Checks that the program running it may post input (Accessibility) and that
   the screen is not locked.
2. Signs a dummy message with git's signing key through 1Password's
   `op-ssh-sign`. That unlocks 1Password if needed and approves the key for
   the calling app. It gives up after 90 seconds.
3. Posts a zero-distance synthetic mouse move every interval, which resets
   macOS's idle timer and so 1Password's.

Only one loop runs at a time; a second `start` signs (approving its own app)
and leaves the loop alone. Durations accept `s`/`m`/`h` and are capped at 8h.
It never reads 1Password items or 1Password's files.

**Start it before you leave.** Nudges keep an unlock alive; they cannot create
one. Once the screen or 1Password has locked, `start` refuses to run.

## Requirements

- macOS, with 1Password's SSH agent signing your commits
  (`gpg.ssh.program` = `op-ssh-sign`, `user.signingkey` set globally).
- Accessibility permission for the program that runs it: System Settings →
  Privacy & Security. Under Claude Code that is the versioned `claude` binary
  (for example `~/.local/share/claude/versions/<version>`), so the grant is
  likely needed again after each Claude Code update.
- `swiftc` (Xcode command-line tools) to build the `nudge` helper on first use.

## Evidence

`experiment.sh full` runs two phases with no signing in between: 75 minutes
with nudges, then a signature; 75 minutes without, then a signature. With the
idle auto-lock at 60 minutes, the nudge phase signed and the control phase
failed. The experiment runs `caffeinate -d` so display sleep cannot interfere.

`caffeinate -u` does not reset the idle timer; the synthetic mouse move does.

## Tests

`./test.sh` starts two loops at once from a scratch copy with a no-op nudge
and checks that exactly one runs, that `status` names it, and that `stop`
leaves none. It never signs or posts input.

## Limits

- "Lock when device locks or sleeps" still applies. Whether nudges alone
  prevent display sleep has not been tested.
- Synthetic input keeps the whole Mac looking active, not only 1Password.
