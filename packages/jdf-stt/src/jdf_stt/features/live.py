"""`jdf-stt live`: a live preview of what you say, through whisper.cpp's `whisper-stream`.

`whisper-stream` captures the microphone itself (SDL) and prints text as you speak; Ctrl+C
stops it. The preview is for watching, not for keeping: nothing is saved. `build_command` is
pure and tested against `whisper-stream --help`; the live display and capture are untested.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from jdf_stt import models, procs, registry
from jdf_stt.types import TranscribeOptions

VAD_THRESHOLD = 0.6


def build_command(
    o: TranscribeOptions, model: Path | str, *, step: int = 3000, length: int = 10000, vad: bool = False
) -> list[str]:
    """`whisper-stream -m M -l L [-t N] --step S --length LEN -kc`; VAD mode is `--step 0 -vth 0.6`."""
    cmd = ["whisper-stream", "-m", str(model), "-l", o.language]
    if o.threads:
        cmd += ["-t", str(o.threads)]
    cmd += ["--step", "0" if vad else str(step), "--length", str(length), "-kc"]
    if vad:
        cmd += ["-vth", str(VAD_THRESHOLD)]
    return cmd


def model_path(name_or_path: str) -> Path:
    """An existing file as is; otherwise the registry's (downloaded) model."""
    path = Path(name_or_path).expanduser()
    return path if path.is_file() else models.ensure(name_or_path, download=False)


@registry.command("live", help="Show a live preview of what you say (whisper-stream; nothing is saved).")
def setup(parser: argparse.ArgumentParser):
    parser.add_argument("-m", "--model", dest="model", default=None, help="model name or path (default: small)")
    parser.add_argument("-l", "--language", dest="language", default=None, help="spoken language (default: auto)")
    parser.add_argument("-t", "--threads", dest="threads", type=int, default=None, help="threads")
    parser.add_argument("--step", type=int, default=3000, help="ms of new audio per update (default: 3000)")
    parser.add_argument("--length", type=int, default=10000, help="ms of audio per window (default: 10000)")
    parser.add_argument(
        "--vad", action="store_true", help="update after each pause instead of every step (whisper-stream VAD mode)"
    )

    def run(ns: argparse.Namespace) -> int:
        o = registry.options_from_args(ns)
        cmd = build_command(o, model_path(o.model), step=ns.step, length=ns.length, vad=ns.vad)
        cmd[0] = procs.require_tool("whisper-stream")
        return subprocess.run(cmd, check=False).returncode

    return run
