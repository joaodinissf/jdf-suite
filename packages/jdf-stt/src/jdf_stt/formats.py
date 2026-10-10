"""Rendering a transcript as txt, srt, vtt or json. txt from PR 01; srt, vtt and json from PR 03."""

from __future__ import annotations

from pathlib import Path

from jdf_stt.types import SttError, Transcript

FORMATS = ("txt", "srt", "vtt", "json")


def _txt(t: Transcript) -> str:
    text = t.text.strip()
    return f"{text}\n" if text else ""


def _srt(t: Transcript) -> str:  # PR 03: numbered cues, HH:MM:SS,mmm
    raise NotImplementedError


def _vtt(t: Transcript) -> str:  # PR 03: WEBVTT header, HH:MM:SS.mmm
    raise NotImplementedError


def _json(t: Transcript) -> str:  # PR 03: json.dumps(t.to_dict(), indent=2)
    raise NotImplementedError


_RENDERERS = {"txt": _txt, "srt": _srt, "vtt": _vtt, "json": _json}


def render(t: Transcript, fmt: str) -> str:
    """`t` as the text of one output file (empty when there is no speech)."""
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
