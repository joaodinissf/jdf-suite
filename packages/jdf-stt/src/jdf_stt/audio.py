"""Audio preparation: anything ffmpeg reads -> 16 kHz mono 16-bit wav. Owned by PR 02 (stub from PR 01)."""

from __future__ import annotations

from pathlib import Path


def prepare(src: Path, workdir: Path) -> Path:
    """Convert `src` to a 16 kHz mono pcm_s16le wav inside `workdir` and return its path.

    `ffmpeg -nostdin -y -i SRC -ar 16000 -ac 1 -c:a pcm_s16le OUT.wav`; a missing input raises `SttError`.
    """
    raise NotImplementedError


def duration(wav: Path) -> float | None:
    """Seconds of audio in `wav`, read from its header (stdlib `wave`)."""
    raise NotImplementedError
