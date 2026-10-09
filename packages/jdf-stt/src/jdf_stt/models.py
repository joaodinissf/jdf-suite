"""Model registry, lookup and the (user-triggered, sha256-checked) download.

Owned by PR 02 (stub from PR 01). This is the only module allowed to open a network
connection, and only for a download the user asked for.
"""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

BASE_URL = "https://huggingface.co"  # PR 02: overridable by $JDF_STT_MODEL_BASE_URL (tests only)


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


def resolve(name_or_path: str) -> Path:
    """An existing file path as is; a registry name -> `config.models_dir() / file` (may not exist yet)."""
    raise NotImplementedError


def ensure(name_or_path: str, *, download: bool) -> Path:
    """The model's path, downloading it first when missing and `download` is true.

    PR 02: stream to `file.part`, hash while writing, verify size and sha256, rename;
    a mismatch deletes the `.part` and raises `SttError`. Progress goes to stderr.
    """
    raise NotImplementedError
