"""Where jdf-stt keeps things, and the optional user config file.

config.toml tables (all optional):

    [transcribe]          # defaults for any TranscribeOptions field, e.g. model = "base"
    [replace]             # "from" = "to" find-and-replace pairs
    [fillers]             # language = ["um", "uh"] filler words per language
    [modes.<name>]        # prompt = "..." extra local-LLM rewrite modes
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

from jdf_stt.types import SttError


def models_dir() -> Path:
    """`$JDF_STT_MODELS_DIR`, else `~/.cache/jdf-stt/models`."""
    env = os.environ.get("JDF_STT_MODELS_DIR")
    return Path(env).expanduser() if env else Path.home() / ".cache" / "jdf-stt" / "models"


def config_path() -> Path:
    """`$JDF_STT_CONFIG`, else `~/.config/jdf-stt/config.toml`."""
    env = os.environ.get("JDF_STT_CONFIG")
    return Path(env).expanduser() if env else Path.home() / ".config" / "jdf-stt" / "config.toml"


def load_config() -> dict:
    """The parsed config file, or `{}` when there is none."""
    path = config_path()
    try:
        with path.open("rb") as f:
            return tomllib.load(f)
    except FileNotFoundError:
        return {}
    except tomllib.TOMLDecodeError as e:
        raise SttError(f"{path}: {e}") from e
