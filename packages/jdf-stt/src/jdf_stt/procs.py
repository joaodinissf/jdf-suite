"""Running the external programs (whisper-cli, ffmpeg, ...) with errors a user can read."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Sequence
from os import PathLike
from pathlib import Path

from jdf_stt.types import SttError, ToolMissing

__all__ = ["INSTALL_HINTS", "ToolMissing", "require_tool", "run"]

INSTALL_HINTS = {
    "whisper-cli": "brew install whisper-cpp",
    "whisper-stream": "brew install whisper-cpp",
    "whisper-bench": "brew install whisper-cpp",
    "ffmpeg": "brew install ffmpeg",
}

STDERR_TAIL_LINES = 8


def _missing(name: str) -> ToolMissing:
    hint = INSTALL_HINTS.get(name)
    return ToolMissing(f"{name} not found." + (f" Install: {hint}" if hint else ""))


def require_tool(name: str) -> str:
    """The full path of `name` on PATH, or `ToolMissing` with how to install it."""
    path = shutil.which(name)
    if path is None:
        raise _missing(name)
    return path


def run(
    cmd: Sequence[str | PathLike[str]], *, input: str | None = None, timeout: float | None = None
) -> subprocess.CompletedProcess[str]:
    """Run `cmd`, capturing stdout and stderr as text.

    A non-zero exit raises `SttError` carrying the last lines of stderr; a missing
    program raises `ToolMissing`; a timeout raises `SttError`.
    """
    args = [str(c) for c in cmd]
    name = Path(args[0]).name
    try:
        proc = subprocess.run(
            args, input=input, capture_output=True, text=True, errors="replace", timeout=timeout, check=False
        )
    except FileNotFoundError as e:
        raise _missing(name) from e
    except subprocess.TimeoutExpired as e:
        raise SttError(f"{name} timed out after {timeout:g} s") from e
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-STDERR_TAIL_LINES:])
        raise SttError(f"{name} failed (exit {proc.returncode})" + (f":\n{tail}" if tail else ""))
    return proc
