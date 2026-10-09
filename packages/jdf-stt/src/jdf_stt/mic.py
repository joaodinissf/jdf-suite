"""Microphone recording through ffmpeg (`jdf-stt --mic`).

ffmpeg records into a temporary 16 kHz mono wav while this module watches stdin:

- on a terminal (cbreak mode): Enter stops; Esc or Ctrl+C cancels;
- on a pipe (the Swift app): a newline stops; EOF, SIGINT or SIGTERM cancels.

Stop writes `q` to ffmpeg's stdin (its clean stop, so the wav header is complete) and waits;
cancel kills ffmpeg, deletes the recording and raises `Cancelled`. With `--until-silence`,
ffmpeg's `silencedetect` filter reports pauses on stderr and the first one after audio has
started stops the recording. The recording is a single temporary file, so a caller that deletes
the returned path leaves nothing behind. `options.mic_input` replaces the default avfoundation
input; tests pass lavfi sources there, so the test suite never opens the real microphone.
"""

from __future__ import annotations

import contextlib
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import termios
import threading
import tty
import wave
from collections import deque
from collections.abc import Iterator
from pathlib import Path

from jdf_stt import procs
from jdf_stt.types import Cancelled, SttError, TranscribeOptions

DEFAULT_INPUT = ("-f", "avfoundation", "-i", ":default")
SILENCE_NOISE = "-35dB"
TEMP_PREFIX = "jdf-stt-mic-"
STOP_TIMEOUT = 10.0
LEADING_SILENCE = 0.1  # a silence_start at or before this many seconds is silence from the start
_STOP, _CANCEL, _ENDED = "stop", "cancel", "ended"
_SILENCE_START = re.compile(r"silence_start: (-?\d+(?:\.\d+)?)")


def ffmpeg_command(options: TranscribeOptions, out: Path, *, ffmpeg: str) -> list[str]:
    """The ffmpeg command that records `options.mic_input` (default: the avfoundation mic) to `out`.

    No `-nostdin`: `q` on ffmpeg's stdin is how a recording is stopped cleanly.
    """
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "info", "-nostats", "-y", *(options.mic_input or DEFAULT_INPUT)]
    if options.until_silence:
        cmd += ["-af", f"silencedetect=noise={SILENCE_NOISE}:d={options.silence_seconds:g}"]
    return [*cmd, "-ar", "16000", "-ac", "1", str(out)]


def silence_start(line: str) -> float | None:
    """The time in a `silence_start: T` line from silencedetect, else None."""
    match = _SILENCE_START.search(line)
    return float(match.group(1)) if match else None


def record(options: TranscribeOptions, *, stdin: int | None = None) -> Path:
    """Record until stopped and return the wav path; cancelling raises `Cancelled`.

    `stdin` is the file descriptor to watch (default: the process's stdin). The recording is a
    temporary file, or at `options.keep_audio` when given; `discard()` (or deleting it) cleans up.
    """
    keep = _keep_path(options)
    ffmpeg = procs.require_tool("ffmpeg")
    fd = sys.stdin.fileno() if stdin is None else stdin
    on_tty = os.isatty(fd)
    handle, name = tempfile.mkstemp(prefix=TEMP_PREFIX, suffix=".wav")
    os.close(handle)  # ffmpeg overwrites it (-y)
    out = Path(name)
    proc: subprocess.Popen[bytes] | None = None
    try:
        with _signals_cancel(), _cbreak(fd if on_tty else None):
            proc = subprocess.Popen(
                ffmpeg_command(options, out, ffmpeg=ffmpeg),
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            watcher = _StderrWatcher(proc, options.until_silence)
            if on_tty:
                print("jdf-stt: recording. Enter stops, Esc or Ctrl+C cancels.", file=sys.stderr, flush=True)
            outcome = _wait(proc, fd, on_tty, watcher)
            if outcome == _CANCEL:
                raise Cancelled("cancelled")
            if outcome == _STOP:
                _stop(proc)
        watcher.join()
        if proc.returncode != 0:
            raise SttError(f"ffmpeg failed (exit {proc.returncode})" + watcher.tail())
        if not _has_audio(out):
            raise SttError("no audio was recorded" + watcher.tail())
    except BaseException as e:
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()
        out.unlink(missing_ok=True)
        if isinstance(e, KeyboardInterrupt):
            raise Cancelled("cancelled") from None
        raise
    if keep is None:
        return out
    shutil.move(out, keep)
    return keep


def discard(path: Path, options: TranscribeOptions) -> None:
    """Delete a recording from `record()` once it has been transcribed, unless `--keep-audio` kept it."""
    if not options.keep_audio:
        path.unlink(missing_ok=True)


# Internals ---------------------------------------------------------------------


def _keep_path(options: TranscribeOptions) -> Path | None:
    """Where `--keep-audio` puts the recording, checked before recording starts."""
    if not options.keep_audio:
        return None
    keep = Path(options.keep_audio).expanduser()
    if not keep.parent.is_dir():
        raise SttError(f"--keep-audio: folder does not exist: {keep.parent}")
    return keep


class _StderrWatcher:
    """Drains ffmpeg's stderr (so it never blocks), keeps the last lines and spots pauses."""

    def __init__(self, proc: subprocess.Popen[bytes], until_silence: bool) -> None:
        self.lines: deque[str] = deque(maxlen=procs.STDERR_TAIL_LINES)
        self.silence = threading.Event()
        self._until_silence = until_silence
        self._thread = threading.Thread(target=self._read, args=(proc,), daemon=True)
        self._thread.start()

    def _read(self, proc: subprocess.Popen[bytes]) -> None:
        assert proc.stderr is not None
        heard = False
        for raw in proc.stderr:
            line = raw.decode(errors="replace").strip()
            if line:
                self.lines.append(line)
            if self._until_silence:
                start = silence_start(line)
                # Silence from the very beginning is not a pause: a real mic's first frame may be
                # stamped a little after 0, so a pause counts once sound has ended a silence
                # (silence_end) or when it starts clearly after the beginning.
                if start is not None and (heard or start > LEADING_SILENCE):
                    self.silence.set()
                heard = heard or "silence_end:" in line

    def join(self) -> None:
        self._thread.join(timeout=5)

    def tail(self) -> str:
        return (":\n" + "\n".join(self.lines)) if self.lines else ""


def _wait(proc: subprocess.Popen[bytes], fd: int, on_tty: bool, watcher: _StderrWatcher) -> str:
    """Block until the user stops or cancels, a pause ends the recording, or ffmpeg exits."""
    while True:
        if watcher.silence.is_set():
            return _STOP
        if proc.poll() is not None:
            return _ENDED
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        data = os.read(fd, 1024)
        if not data:  # EOF: the app (or whoever holds the pipe) went away
            return _CANCEL
        if on_tty:
            for byte in data:
                if byte in b"\r\n":
                    return _STOP
                if byte in b"\x1b\x03\x04":  # Esc, Ctrl+C, Ctrl+D
                    return _CANCEL
        elif b"\n" in data:
            return _STOP


def _stop(proc: subprocess.Popen[bytes]) -> None:
    """Ask ffmpeg to finish the file (`q`), then wait for it."""
    assert proc.stdin is not None
    with contextlib.suppress(OSError):  # it may have just exited by itself
        proc.stdin.write(b"q")
        proc.stdin.close()
    try:
        proc.wait(timeout=STOP_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        raise SttError(f"ffmpeg did not stop within {STOP_TIMEOUT:g} s") from None


def _has_audio(path: Path) -> bool:
    try:
        with wave.open(str(path)) as w:
            return w.getnframes() > 0
    except (OSError, EOFError, wave.Error):
        return False


@contextlib.contextmanager
def _signals_cancel() -> Iterator[None]:
    """SIGINT and SIGTERM raise KeyboardInterrupt (that is, cancel) while recording."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return

    def interrupt(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    previous = {sig: signal.signal(sig, interrupt) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


@contextlib.contextmanager
def _cbreak(fd: int | None) -> Iterator[None]:
    """Keys arrive one at a time without echo (Ctrl+C still signals); restored afterwards."""
    if fd is None:
        yield
        return
    saved = termios.tcgetattr(fd)
    tty.setcbreak(fd)
    try:
        yield
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)
