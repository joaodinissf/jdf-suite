"""`jdf-stt transcribe` (the default command): `jdf-stt FILE... [-m MODEL] [-o DIR] [--engine NAME]`.

One input and one format without `-o` prints to stdout; otherwise each input's outputs are written
into `-o`, or next to the input. With `--mic` (PR 05) it records first with `mic.record(options)`.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from jdf_stt import formats, language, mic, pipeline, registry
from jdf_stt.types import SttError, TranscribeOptions


@registry.transcribe_options
def add_engine_options(group: argparse._ArgumentGroup) -> None:
    group.add_argument(
        "-m", "--model", default=None, metavar="MODEL", help="model name (see `jdf-stt models`) or a ggml file path"
    )
    group.add_argument("--engine", default=None, metavar="NAME", help="transcription engine (default whisper-cpp)")
    group.add_argument("-t", "--threads", type=int, default=None, metavar="N", help="CPU threads for the engine")


def _note(message: str | None, quiet: bool) -> None:
    if message and not quiet:
        print(message, file=sys.stderr)


def _write(t, base: Path, options: TranscribeOptions, quiet: bool = False) -> None:
    for path in formats.write_outputs(t, base, options.formats):
        _note(f"wrote {path}", quiet)


def _transcribe_mic(options: TranscribeOptions, quiet: bool = False) -> int:
    wav = Path(mic.record(options))
    try:
        t = pipeline.transcribe_file(wav, options)
    finally:
        keep = Path(options.keep_audio).expanduser() if options.keep_audio else None
        if keep is None:
            wav.unlink(missing_ok=True)
        elif wav.exists() and wav.resolve() != keep.resolve():
            shutil.move(wav, keep)
    _note(language.describe(t), quiet)
    if options.output_dir:
        _write(t, Path(options.output_dir) / wav.stem, options, quiet)
    else:
        for fmt in options.formats:
            sys.stdout.write(formats.render(t, fmt))
    return 0


def _transcribe_files(inputs: list[Path], options: TranscribeOptions, quiet: bool = False) -> int:
    to_stdout = len(inputs) == 1 and len(options.formats) == 1 and not options.output_dir
    code = 0
    for src in inputs:
        try:
            t = pipeline.transcribe_file(src, options)
            _note(language.describe(t), quiet)
            if to_stdout:
                sys.stdout.write(formats.render(t, options.formats[0]))
            else:
                _write(t, (Path(options.output_dir) if options.output_dir else src.parent) / src.stem, options, quiet)
        except SttError as e:
            if len(inputs) == 1:
                raise
            print(f"jdf-stt: {src}: {e}", file=sys.stderr)
            code = 1
    return code


@registry.command("transcribe", help="Transcribe audio files, or the microphone with --mic (the default command).")
def setup(parser: argparse.ArgumentParser):
    parser.add_argument("inputs", nargs="*", metavar="FILE", help="audio or video files")
    parser.add_argument(
        "-o",
        "--output-dir",
        dest="output_dir",
        default=None,
        metavar="DIR",
        help="write FILE.<format> here (default: stdout for one file and one format, else next to each file)",
    )
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="no status lines on stderr (detected language, files written)"
    )
    registry.add_transcribe_options(parser)

    def run(ns: argparse.Namespace) -> int:
        options = registry.options_from_args(ns)
        if options.mic:
            return _transcribe_mic(options, ns.quiet)
        if not ns.inputs:
            raise SttError("no input: give one or more audio files (or --mic). See jdf-stt transcribe --help")
        return _transcribe_files([Path(p).expanduser() for p in ns.inputs], options, ns.quiet)

    return run
