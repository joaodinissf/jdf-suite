"""Real transcription with the network switched off by the operating system.

macOS `sandbox-exec` runs a command under a profile that denies all network access (sockets
to any address, loopback included, and name lookups). A transcription that still produces the
right words there needed no network: not in Python, not in whisper-cli, not in ffmpeg.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import warnings
from pathlib import Path

import pytest

from jdf_stt import config

pytestmark = [
    pytest.mark.real,
    pytest.mark.skipif(shutil.which("sandbox-exec") is None, reason="needs macOS sandbox-exec"),
]

NO_NETWORK = "(version 1)(allow default)(deny network*)"
SRC = Path(__file__).parents[2] / "src" / "jdf_stt"
SENTENCE = "The quick brown fox jumps over the lazy dog."


def offline(*cmd: object, timeout: float = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sandbox-exec", "-p", NO_NETWORK, *map(str, cmd)],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )


def test_the_sandbox_really_denies_the_network():
    """Control: a loopback connection works outside the sandbox and fails inside it."""
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(2)
        port = server.getsockname()[1]
        probe = f"import socket; socket.create_connection(('127.0.0.1', {port}), timeout=5).close()"
        outside = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=False)
        assert outside.returncode == 0, outside.stderr
        inside = offline(sys.executable, "-c", probe)
        assert inside.returncode != 0
        assert "Operation not permitted" in inside.stderr


def whisper_text(model: Path, wav: Path, out: Path, *extra: str) -> tuple[subprocess.CompletedProcess[str], str]:
    cmd = ["whisper-cli", "-m", model, "-f", wav, "-l", "auto", "-oj", "-of", out, "-np", "-nth", "0.6", "-sns"]
    proc = offline(*cmd, *extra)
    json_file = out.with_suffix(".json")
    return proc, json_file.read_text(encoding="utf-8").lower() if json_file.exists() else ""


def test_whisper_cli_transcribes_with_the_network_denied(real_model, say_wav, tmp_path, record_property):
    wav = say_wav(SENTENCE)
    backend = "metal"
    proc, text = whisper_text(real_model, wav, tmp_path / "gpu")
    if proc.returncode != 0:  # if Metal needed something the sandbox denies, CPU must still work
        backend = "cpu"
        warnings.warn(
            f"whisper-cli failed on Metal under the sandbox, retrying on the CPU with -ng: {proc.stderr[-500:]}",
            stacklevel=1,
        )
        proc, text = whisper_text(real_model, wav, tmp_path / "cpu", "-ng")
    record_property("backend", backend)
    print(f"whisper-cli backend under the sandbox: {backend}")
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "fox" in text and "dog" in text


def test_ffmpeg_prepares_audio_with_the_network_denied(say_wav, tmp_path):
    out = tmp_path / "prepared.wav"
    proc = offline(
        "ffmpeg",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-i",
        say_wav(SENTENCE),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        out,
    )
    assert proc.returncode == 0, proc.stderr
    assert out.stat().st_size > 1000


def test_jdf_stt_transcribes_with_the_network_denied(real_model, say_wav, tmp_path):
    if not (SRC / "engines" / "whisper_cpp.py").is_file():
        if os.environ.get("JDF_STT_REQUIRE_ALL_FLOWS") == "1":
            pytest.fail("the whisper-cli engine (PR 02) is missing")
        pytest.skip("needs the whisper-cli engine (PR 02)")
    vad = config.models_dir() / "ggml-silero-v6.2.0.bin"
    if not vad.is_file():
        pytest.skip(f"the VAD model is not downloaded yet ({vad}); run `jdf-stt models download silero-v6.2.0`")
    proc = offline(sys.executable, "-m", "jdf_stt", "-m", real_model, say_wav(SENTENCE))
    assert proc.returncode == 0, proc.stderr[-2000:]
    words = proc.stdout.lower()
    assert "fox" in words and "dog" in words
