"""Microphone recording through ffmpeg. Owned by PR 05 (stub from PR 01)."""

from __future__ import annotations

from pathlib import Path

from jdf_stt.types import TranscribeOptions


def record(options: TranscribeOptions) -> Path:
    """Record until stopped and return the wav path; cancelling raises `Cancelled`.

    Stop protocol: on a tty, Enter stops and Esc or Ctrl+C cancels; on a pipe (the Swift app),
    a newline stops and EOF, SIGINT or SIGTERM cancels. `options.mic_input` replaces the
    default `-f avfoundation -i :default` input (tests pass lavfi sources).
    """
    raise NotImplementedError
