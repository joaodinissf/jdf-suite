"""Model registry, lookup and the (user-triggered, sha256-checked) download.

This is the only module allowed to open a network connection, and only for a download
the user asked for: `jdf-stt models download NAME`, a yes to the first-use prompt on a
terminal, or the under-1 MB VAD model the silence handling needs.
"""

from __future__ import annotations

import hashlib
import http.client
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import NamedTuple

from jdf_stt import config
from jdf_stt.types import SttError

BASE_URL = "https://huggingface.co"  # $JDF_STT_MODEL_BASE_URL overrides it (tests: a local fake server)
DEFAULT_MODEL = "small"
DEFAULT_VAD = "silero-v6.2.0"
CHUNK = 1 << 20
TIMEOUT = 60  # seconds without data before a download gives up


class ModelInfo(NamedTuple):
    repo: str
    file: str
    size: int  # bytes
    sha256: str


# Sizes and hashes from the Hugging Face LFS metadata (checked 2026-10-05).
# URL: f"{BASE_URL}/{repo}/resolve/main/{file}".
MODELS: dict[str, ModelInfo] = {
    "tiny": ModelInfo(
        "ggerganov/whisper.cpp",
        "ggml-tiny.bin",
        77691713,
        "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    ),
    "base": ModelInfo(
        "ggerganov/whisper.cpp",
        "ggml-base.bin",
        147951465,
        "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    ),
    "small": ModelInfo(
        "ggerganov/whisper.cpp",
        "ggml-small.bin",
        487601967,
        "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    ),
    "medium": ModelInfo(
        "ggerganov/whisper.cpp",
        "ggml-medium.bin",
        1533763059,
        "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    ),
    "large-v3-turbo": ModelInfo(
        "ggerganov/whisper.cpp",
        "ggml-large-v3-turbo.bin",
        1624555275,
        "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    ),
    "silero-v6.2.0": ModelInfo(
        "ggml-org/whisper-vad",
        "ggml-silero-v6.2.0.bin",
        885098,
        "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
    ),
    "silero-v5.1.2": ModelInfo(
        "ggml-org/whisper-vad",
        "ggml-silero-v5.1.2.bin",
        885098,
        "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
    ),
}


def human_size(size: int) -> str:
    """Binary units, rounded: 465 MB, 0.8 MB, 1.5 GB."""
    mb = size / (1 << 20)
    if mb >= 1024:
        return f"{mb / 1024:.1f} GB"
    return f"{mb:.0f} MB" if mb >= 10 else f"{mb:.1f} MB"


def _info(name: str) -> ModelInfo:
    try:
        return MODELS[name]
    except KeyError:
        raise SttError(f"unknown model {name!r} (known: {', '.join(MODELS)}; or pass a file path)") from None


def _looks_like_path(name_or_path: str) -> bool:
    return "/" in name_or_path or os.sep in name_or_path or name_or_path.endswith(".bin")


def resolve(name_or_path: str) -> Path:
    """A registry name -> `config.models_dir() / file` (may not exist yet); else an existing file path as is.

    Registry names win, so a stray file called `small` in the current directory never shadows the model.
    """
    if name_or_path in MODELS:
        return config.models_dir() / MODELS[name_or_path].file
    path = Path(name_or_path).expanduser()
    if path.is_file():
        return path
    if _looks_like_path(name_or_path):
        raise SttError(f"model file not found: {path}")
    return config.models_dir() / _info(name_or_path).file


def url(name: str) -> str:
    base = os.environ.get("JDF_STT_MODEL_BASE_URL") or BASE_URL
    info = _info(name)
    return f"{base.rstrip('/')}/{info.repo}/resolve/main/{info.file}"


def is_downloaded(name: str) -> bool:
    return resolve(name).is_file()


def ensure(name_or_path: str, *, download: bool) -> Path:
    """The model's path, downloading it first when missing and `download` is true.

    Streams to `file.part`, hashing while writing, checks size and sha256, then renames;
    any failure deletes the `.part` and raises `SttError`. Progress goes to stderr.
    """
    path = resolve(name_or_path)
    if path.is_file():
        return path
    if not download:
        raise SttError(
            f"model {name_or_path!r} is not downloaded yet ({human_size(_info(name_or_path).size)}). "
            f"Run: jdf-stt models download {name_or_path}"
        )
    return _download(name_or_path, path)


def ask_to_download(name_or_path: str) -> bool:
    """On a terminal, ask before the first download of a missing registry model; default no.

    Never asks (returns False) for file paths, models already present, or when stdin or stderr
    is not a terminal (the Swift app, the MCP server, scripts): those get `ensure`'s error.
    """
    if name_or_path not in MODELS or is_downloaded(name_or_path):
        return False
    if not (sys.stdin.isatty() and sys.stderr.isatty()):
        return False
    info = MODELS[name_or_path]
    sys.stderr.write(f"Download {info.file} ({human_size(info.size)}) to {config.models_dir()}? [y/N] ")
    sys.stderr.flush()
    return sys.stdin.readline().strip().lower() in ("y", "yes")


def _download(name: str, dest: Path) -> Path:
    info = _info(name)
    source = url(name)
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    progress = sys.stderr.isatty()
    print(f"Downloading {info.file} ({human_size(info.size)}) from {source}", file=sys.stderr)
    digest, written = hashlib.sha256(), 0
    try:
        with urllib.request.urlopen(source, timeout=TIMEOUT) as response, part.open("wb") as out:
            while chunk := response.read(CHUNK):
                out.write(chunk)
                digest.update(chunk)
                written += len(chunk)
                if progress:
                    print(f"\r  {written * 100 // info.size:3d}%", end="", file=sys.stderr, flush=True)
        if progress:
            print(file=sys.stderr)
        if written != info.size:
            raise SttError(f"download of {info.file}: size mismatch ({written} bytes, expected {info.size})")
        if digest.hexdigest() != info.sha256:
            raise SttError(f"download of {info.file}: sha256 mismatch (got {digest.hexdigest()})")
    except (OSError, http.client.HTTPException) as e:  # URLError and HTTPError are OSErrors
        part.unlink(missing_ok=True)
        reason = e if isinstance(e, urllib.error.HTTPError) else getattr(e, "reason", None) or e
        raise SttError(f"download of {info.file} failed: {reason}") from e
    except BaseException:  # size or hash mismatch, Ctrl+C: never leave a .part behind
        part.unlink(missing_ok=True)
        raise
    part.replace(dest)
    print(f"  sha256 ok, saved {dest}", file=sys.stderr)
    return dest
