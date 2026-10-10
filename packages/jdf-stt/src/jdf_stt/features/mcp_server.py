"""`jdf-stt mcp`: a local MCP server on stdio, so an AI assistant on this Mac can transcribe files.

Two tools: `transcribe_file` and `list_models`. The MCP SDK is the optional `mcp` extra and is
imported only when the server starts, so the rest of jdf-stt keeps zero dependencies.
The server never downloads a model: a missing one is an error that says which command to run.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from jdf_stt import config, formats, models, pipeline, registry
from jdf_stt.types import SttError, TranscribeOptions

INSTALL_HINT = "install with uvx --from 'jdf-stt[mcp]' jdf-stt mcp"


def _require_models(o: TranscribeOptions) -> None:
    """Fail before transcribing when a model is not on disk; the user downloads it, not the server."""
    needed = [o.model]
    if o.vad and o.engine == "whisper-cpp":
        needed.append(o.vad_model)
    for name in needed:
        if models.resolve(name).is_file():
            continue
        if name in models.MODELS:
            raise SttError(
                f"model {name!r} is not downloaded, and the MCP server never downloads. "
                f"Run this in a terminal first: jdf-stt models download {name}"
            )
        raise SttError(f"model not found: {name}")


def transcribe_file(path: str, format: str = "txt", language: str | None = None, model: str | None = None) -> str:
    """Transcribe an audio or video file on this Mac, locally (nothing leaves the machine).

    path: the file (absolute, or starting with ~). format: txt (plain text), srt, vtt or json
    (text, detected language, duration and timed segments). language: "auto" to detect it, or a
    code such as "en" or "pt"; by default the user's configured language ("auto" unless set in
    config.toml). model: a model name from list_models, or a model file path; by
    default the user's configured model ("small" unless set in config.toml).
    """
    if format not in formats.FORMATS:
        raise SttError(f"unknown format {format!r} (choose from {', '.join(formats.FORMATS)})")
    src = Path(path).expanduser()
    if not src.is_file():
        raise SttError(f"no such file: {src}")
    options = registry.options_from_args(argparse.Namespace(language=language, model=model, formats=[format]))
    _require_models(options)
    return formats.render(pipeline.transcribe_file(src, options), format)


def list_models() -> dict:
    """The speech models jdf-stt knows (size in bytes, whether downloaded) and the available engines."""
    return {
        "engines": registry.engine_names(),
        "default_model": registry.options_from_args(argparse.Namespace()).model,
        "models_dir": str(config.models_dir()),
        "models": [
            {"name": name, "file": info.file, "size": info.size, "downloaded": models.resolve(name).is_file()}
            for name, info in models.MODELS.items()
        ],
    }


def build_server():
    """A FastMCP server with both tools. Needs the `mcp` extra."""
    try:
        from mcp.server.fastmcp import FastMCP  # noqa: PLC0415 (optional extra, imported on use)
    except ImportError as e:
        raise SttError(f"the MCP server needs the optional MCP SDK: {INSTALL_HINT}") from e
    server = FastMCP(
        "jdf-stt",
        instructions="Local, private speech-to-text. Transcribe audio or video files on this Mac with transcribe_file.",
    )
    server.tool()(transcribe_file)
    server.tool()(list_models)
    return server


@registry.command("mcp", help="Run a local MCP server on stdio (needs the jdf-stt[mcp] extra).")
def setup(parser: argparse.ArgumentParser):
    def run(ns: argparse.Namespace) -> int:
        build_server().run("stdio")
        return 0

    return run
