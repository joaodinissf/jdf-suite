"""`jdf-stt transcribe` (the default command). Owned by PR 02 (stub from PR 01).

PR 02: `jdf-stt FILE... [-m MODEL] [-o DIR] [--engine NAME]`; one input and one format without
`-o` prints to stdout, otherwise files are written into `-o` (default: next to each input).
With `--mic` (PR 05) it records first with `mic.record(options)`.
"""

from __future__ import annotations

import argparse

from jdf_stt import registry


@registry.command("transcribe", help="Transcribe audio files, or the microphone with --mic (the default command).")
def setup(parser: argparse.ArgumentParser):
    parser.add_argument("inputs", nargs="*", metavar="FILE", help="audio or video files")
    registry.add_transcribe_options(parser)

    def run(ns: argparse.Namespace) -> int:
        raise NotImplementedError("transcribe arrives in PR 02")

    return run
