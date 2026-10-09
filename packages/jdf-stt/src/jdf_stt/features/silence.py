"""Silence handling: so silence never becomes made-up text.

Before the model (flags passed by the engine): Silero voice-activity detection (`--vad`, on
by default, model downloaded once, under 1 MB), whisper's no-speech threshold (`-nth`) and
`--suppress-nst` (no non-speech tokens). After the model: the guard below drops segments
that are only non-speech markers such as `[BLANK_AUDIO]` or `(music)`.
"""

from __future__ import annotations

import argparse
import dataclasses
import re
import sys

from jdf_stt import registry
from jdf_stt.types import TranscribeOptions, Transcript

# Bracketed or starred tags and music notes; what is left of a marker-only segment has no letters or digits.
_MARKERS = re.compile(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫♬]")


def _unit_float(value: str) -> float:
    try:
        number = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not a number") from None
    if not 0.0 <= number <= 1.0:
        raise argparse.ArgumentTypeError(f"{value} is not between 0 and 1")
    return number


@registry.transcribe_options
def add(group: argparse._ArgumentGroup) -> None:
    group.add_argument(
        "--no-vad",
        dest="vad",
        action="store_false",
        default=None,
        help="do not skip silence with voice-activity detection (on by default)",
    )
    group.add_argument(
        "--vad-model",
        dest="vad_model",
        metavar="NAME|PATH",
        help="VAD model: a registry name or a file (default silero-v6.2.0, downloaded once, under 1 MB)",
    )
    group.add_argument(
        "--vad-threshold",
        dest="vad_threshold",
        type=_unit_float,
        metavar="0-1",
        help="how sure the VAD must be that someone is speaking (default 0.5)",
    )
    group.add_argument(
        "--no-speech-threshold",
        dest="no_speech_threshold",
        type=_unit_float,
        metavar="0-1",
        help="whisper's no-speech threshold; lower drops more doubtful segments (default 0.6)",
    )
    group.add_argument(
        "--no-suppress-nst",
        dest="suppress_nst",
        action="store_false",
        default=None,
        help="let whisper emit non-speech tokens (suppressed by default)",
    )


def is_non_speech(text: str) -> bool:
    """True for empty text or text made only of markers like `[BLANK_AUDIO]`, `(music)`, `♪`."""
    return not any(ch.isalnum() for ch in _MARKERS.sub("", text))


@registry.postprocessor(10)
def drop_non_speech(t: Transcript, o: TranscribeOptions) -> Transcript:
    """Drop marker-only segments; with nothing left the text is "" and stderr says `no speech`."""
    kept = tuple(s for s in t.segments if not is_non_speech(s.text))
    if len(kept) != len(t.segments):
        t = dataclasses.replace(t, segments=kept, text=" ".join(s.text.strip() for s in kept))
    elif not t.segments and is_non_speech(t.text):
        t = dataclasses.replace(t, text="")
    if not t.text:  # also when whisper (with VAD) returned nothing at all
        print("jdf-stt: no speech", file=sys.stderr)
    return t
