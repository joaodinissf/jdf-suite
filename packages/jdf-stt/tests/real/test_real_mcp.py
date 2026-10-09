"""A real transcription through the MCP tool, with the local model passed by path."""

import argparse

import pytest

from jdf_stt import models, registry
from jdf_stt.features import mcp_server

pytestmark = pytest.mark.real


def test_transcribe_file_tool_with_a_real_model(say_wav, real_model):
    if "whisper-cpp" not in registry.engine_names():
        pytest.skip("needs the whisper-cpp engine (PR 02)")
    vad = registry.options_from_args(argparse.Namespace()).vad_model
    if not models.resolve(vad).is_file():
        # The server never downloads, not even the small VAD model: fetch it once (approved).
        pytest.skip(f"run `jdf-stt models download {vad}` first; the MCP server never downloads")
    wav = say_wav("The quick brown fox jumps over the lazy dog.")
    text = mcp_server.transcribe_file(str(wav), model=str(real_model)).lower()
    for word in ("quick", "brown", "fox", "lazy", "dog"):
        assert word in text
