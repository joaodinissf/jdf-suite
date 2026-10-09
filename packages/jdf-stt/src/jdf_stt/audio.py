"""Audio preparation: anything ffmpeg reads -> 16 kHz mono 16-bit wav."""

from __future__ import annotations

import wave
from pathlib import Path

from jdf_stt import procs
from jdf_stt.types import SttError

RATE = 16000


def _is_ready(path: Path) -> bool:
    """A wav whisper-cli can read as is: 16 kHz, mono, 16-bit PCM."""
    if path.suffix.lower() != ".wav":
        return False
    try:
        with wave.open(str(path), "rb") as w:
            return (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (RATE, 1, 2)
    except (wave.Error, EOFError, OSError):
        return False


def prepare(src: Path, workdir: Path) -> Path:
    """`src` as a 16 kHz mono pcm_s16le wav: `src` itself when it already is one, else an ffmpeg
    conversion written to `workdir/audio.wav`. A missing input raises `SttError`."""
    src = Path(src)
    if not src.is_file():
        raise SttError(f"{src}: no such file")
    if _is_ready(src):
        return src
    ffmpeg = procs.require_tool("ffmpeg")
    out = Path(workdir) / "audio.wav"
    procs.run(
        [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src]
        + ["-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", out]
    )
    return out


def duration(wav: Path) -> float | None:
    """Seconds of audio in `wav`, read from its header; None when it is not a readable wav."""
    try:
        with wave.open(str(wav), "rb") as w:
            return w.getnframes() / w.getframerate()
    except (wave.Error, EOFError, OSError):
        return None
