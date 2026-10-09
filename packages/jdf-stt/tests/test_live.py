"""`jdf-stt live`: the whisper-stream command line. Running it (mic capture, live display) is BLIND."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from jdf_stt.features import live
from jdf_stt.types import TranscribeOptions

FAKE_STREAM = Path(__file__).parent / "fakes" / "whisper-stream"


def help_flags(binary) -> set[str]:
    proc = subprocess.run([str(binary), "--help"], capture_output=True, text=True, check=False, timeout=30)
    usage = proc.stdout + proc.stderr
    assert re.search(r"usage: \S*whisper-stream", usage), usage[-500:]
    return set(re.findall(r"(?<![\w-])(--?[a-z][a-z-]*)", usage.split("options:", 1)[1]))


def emitted_flags(cmd: list[str]) -> set[str]:
    return {arg for arg in cmd[1:] if re.fullmatch(r"--?[a-z][a-z-]*", arg)}


def test_default_command():
    cmd = live.build_command(TranscribeOptions(), Path("/m/ggml-small.bin"))
    assert cmd == [
        "whisper-stream",
        "-m",
        "/m/ggml-small.bin",
        "-l",
        "auto",
        "--step",
        "3000",
        "--length",
        "10000",
        "-kc",
    ]


def test_language_threads_step_length():
    o = TranscribeOptions(language="pt", threads=6)
    cmd = live.build_command(o, Path("m.bin"), step=2000, length=8000)
    assert cmd == ["whisper-stream", "-m", "m.bin", "-l", "pt", "-t", "6", "--step", "2000", "--length", "8000", "-kc"]


def test_vad_mode():
    cmd = live.build_command(TranscribeOptions(), Path("m.bin"), vad=True)
    assert cmd[cmd.index("--step") + 1] == "0"
    assert cmd[cmd.index("-vth") + 1] == "0.6"


ALL_FLAGS_CMD = live.build_command(TranscribeOptions(threads=2), Path("m.bin"), vad=True)


def test_every_flag_we_emit_is_in_the_fake_help():
    assert emitted_flags(ALL_FLAGS_CMD) <= help_flags(FAKE_STREAM)


@pytest.mark.skipif(shutil.which("whisper-stream") is None, reason="whisper-stream not on PATH")
def test_every_flag_we_emit_is_in_the_real_whisper_stream_help():
    """The real binary's --help only prints usage (no model, no audio device)."""
    flags = help_flags(shutil.which("whisper-stream"))
    assert emitted_flags(ALL_FLAGS_CMD) <= flags
    assert emitted_flags(ALL_FLAGS_CMD) == {"-m", "-l", "-t", "--step", "--length", "-kc", "-vth"}


def test_live_runs_whisper_stream(cli, fake_bin, fake_model):
    r = cli("live", "-m", fake_model, "-l", "en", "--step", "2500")
    assert r.code == 0, r.err
    [argv] = fake_bin.calls("whisper-stream")
    assert argv == ["-m", str(fake_model), "-l", "en", "--step", "2500", "--length", "10000", "-kc"]


def test_live_passes_a_failure_on(cli, fake_bin, fake_model, monkeypatch):
    monkeypatch.setenv("FAKE_STREAM_EXIT", "3")
    assert cli("live", "-m", fake_model).code == 3


def test_live_without_whisper_stream(cli, tmp_path, fake_model, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    r = cli("live", "-m", fake_model)
    assert r.code == 1
    assert "whisper-stream not found" in r.err and "brew install whisper-cpp" in r.err


def test_live_is_listed_in_help(cli):
    assert "live" in cli("--help").out
