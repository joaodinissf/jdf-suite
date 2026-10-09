"""Rendering a transcript as txt, srt, vtt or json."""

from __future__ import annotations

import json
from pathlib import Path

from jdf_stt.types import SttError, Transcript

FORMATS = ("txt", "srt", "vtt", "json")


def _txt(t: Transcript) -> str:
    text = t.text.strip()
    return f"{text}\n" if text else ""


def timestamp(seconds: float, sep: str) -> str:
    """`HH:MM:SS<sep>mmm`, rounded to the millisecond (`,` for srt, `.` for vtt)."""
    ms = max(0, round(seconds * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{sep}{ms:03d}"


def _cues(t: Transcript, sep: str) -> list[str]:
    """One `start --> end` line plus text per segment that has any text."""
    return [
        f"{timestamp(s.start, sep)} --> {timestamp(s.end, sep)}\n{s.text.strip()}\n"
        for s in t.segments
        if s.text.strip()
    ]


def _srt(t: Transcript) -> str:
    return "\n".join(f"{n}\n{cue}" for n, cue in enumerate(_cues(t, ","), start=1))


def _vtt(t: Transcript) -> str:
    return "\n".join(["WEBVTT\n", *_cues(t, ".")])


def _json(t: Transcript) -> str:
    return json.dumps(t.to_dict(), indent=2, ensure_ascii=False) + "\n"


_RENDERERS = {"txt": _txt, "srt": _srt, "vtt": _vtt, "json": _json}


def render(t: Transcript, fmt: str) -> str:
    """`t` as the text of one output file.

    With no speech: txt and srt are empty, vtt is a bare `WEBVTT` header and json is still the
    full object (text "", segments []), so every file stays valid for the program that reads it.
    """
    try:
        renderer = _RENDERERS[fmt]
    except KeyError:
        raise SttError(f"unknown format {fmt!r} (choose from {', '.join(FORMATS)})") from None
    return renderer(t)


def write_outputs(t: Transcript, base: Path, formats: tuple[str, ...] | list[str]) -> list[Path]:
    """Write `base.<fmt>` for each format (e.g. base `dir/talk` -> `dir/talk.txt`) and return the paths."""
    base.parent.mkdir(parents=True, exist_ok=True)
    paths = []
    for fmt in formats:
        content = render(t, fmt)
        path = base.parent / f"{base.name}.{fmt}"
        path.write_text(content, encoding="utf-8")
        paths.append(path)
    return paths
