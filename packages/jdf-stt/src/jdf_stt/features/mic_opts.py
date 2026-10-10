"""Microphone options: --mic, --until-silence, --silence-seconds, --keep-audio (and hidden --mic-input).

The recording itself is `jdf_stt.mic.record`; the `transcribe` command calls it when `--mic` is set.
"""

from __future__ import annotations

import argparse
import shlex

from jdf_stt import registry


def _positive_seconds(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError:
        seconds = 0.0
    if not seconds > 0:
        raise argparse.ArgumentTypeError(f"must be a positive number of seconds, not {value!r}")
    return seconds


@registry.transcribe_options
def add(group: argparse._ArgumentGroup) -> None:
    group.add_argument(
        "--mic",
        action="store_true",
        default=None,
        help="record from the microphone: Enter stops and transcribes, Esc or Ctrl+C cancels",
    )
    group.add_argument(
        "--until-silence",
        action="store_true",
        default=None,
        help="with --mic, also stop by itself after a pause (see --silence-seconds)",
    )
    group.add_argument(
        "--silence-seconds",
        type=_positive_seconds,
        default=None,
        metavar="S",
        help="length of the pause that ends an --until-silence recording (default 1.5)",
    )
    group.add_argument(
        "--keep-audio",
        default=None,
        metavar="PATH",
        help="with --mic, keep the recording as this wav file (by default it is deleted)",
    )
    # For tests and CI: ffmpeg input arguments in place of the microphone, e.g. "-re -f lavfi -i sine".
    group.add_argument("--mic-input", type=shlex.split, default=None, help=argparse.SUPPRESS)
