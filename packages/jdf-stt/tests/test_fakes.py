"""The fakes behave like the real programs in the ways later PRs rely on."""

import json
import subprocess
import wave

import pytest


def run(*args, **kw):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, check=False, **kw)


@pytest.fixture
def wav(tmp_path):
    path = tmp_path / "in.wav"
    path.write_bytes(b"RIFF")
    return path


def test_fake_whisper_writes_json_in_the_real_shape(fake_bin, fake_model, wav, tmp_path):
    out = tmp_path / "out"
    proc = run(
        "whisper-cli", "-m", fake_model, "-f", wav, "-l", "auto", "-oj", "-of", out, "-np", "-nth", "0.6", "-sns"
    )
    assert proc.returncode == 0, proc.stderr
    doc = json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))
    assert doc["result"]["language"] == "en"
    [item] = doc["transcription"]
    assert item["offsets"] == {"from": 0, "to": 2000}
    assert item["timestamps"] == {"from": "00:00:00,000", "to": "00:00:02,000"}
    assert item["text"] == " Hello from the fake whisper."
    assert "[00:00:00.000 --> 00:00:02.000]" in proc.stdout
    assert fake_bin.calls("whisper-cli")[0][:2] == ["-m", str(fake_model)]


def test_fake_whisper_behaviour_env(fake_bin, fake_model, wav, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_WHISPER_SEGMENTS", json.dumps([[0, 1500, " Olá"], [1500, 61001, " mundo."]]))
    monkeypatch.setenv("FAKE_WHISPER_LANG", "pt")
    assert run("whisper-cli", "-m", fake_model, "-f", wav, "-oj", "-of", tmp_path / "a", "-l", "auto").returncode == 0
    doc = json.loads((tmp_path / "a.json").read_text(encoding="utf-8"))
    assert doc["result"]["language"] == "pt"
    assert [t["offsets"]["to"] for t in doc["transcription"]] == [1500, 61001]
    assert doc["transcription"][1]["timestamps"]["to"] == "00:01:01,001"

    # An explicit -l is reported back, like the real whisper-cli.
    assert run("whisper-cli", "-m", fake_model, "-f", wav, "-oj", "-of", tmp_path / "b", "-l", "de").returncode == 0
    assert json.loads((tmp_path / "b.json").read_text(encoding="utf-8"))["result"]["language"] == "de"


def test_fake_whisper_failures(fake_bin, fake_model, wav, tmp_path, monkeypatch):
    assert run("whisper-cli", "-m", tmp_path / "missing.bin", "-f", wav).returncode == 3
    missing_input = run("whisper-cli", "-m", fake_model, "-f", tmp_path / "nope.wav")
    assert missing_input.returncode == 2 and "input file not found" in missing_input.stderr
    assert run("whisper-cli", "-m", fake_model, "-f", wav, "--vad").returncode == 3
    vad = tmp_path / "vad.bin"
    vad.write_bytes(b"v")
    assert run("whisper-cli", "-m", fake_model, "-f", wav, "--vad", "-vm", vad).returncode == 0
    monkeypatch.setenv("FAKE_WHISPER_EXIT", "5")
    monkeypatch.setenv("FAKE_WHISPER_STDERR", "ggml: out of memory")
    proc = run("whisper-cli", "-m", fake_model, "-f", wav, "-oj", "-of", tmp_path / "c")
    assert (proc.returncode, proc.stderr.strip()) == (5, "ggml: out of memory")
    assert not (tmp_path / "c.json").exists()


def test_fake_whisper_help_exits_zero_like_1_9_4(fake_bin):
    proc = run("whisper-cli", "--help")
    assert proc.returncode == 0 and "usage: whisper-cli" in proc.stderr


def test_fake_ffmpeg_writes_a_16k_mono_wav(fake_bin, wav, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_FFMPEG_SECONDS", "2.5")
    out = tmp_path / "out.wav"
    cmd = ["ffmpeg", "-nostdin", "-y", "-i", wav, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out]
    assert run(*cmd).returncode == 0
    with wave.open(str(out)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)
        assert w.getnframes() == 40000
    assert fake_bin.calls("ffmpeg") == [[str(c) for c in cmd[1:]]]


def test_fake_ffmpeg_failures(fake_bin, tmp_path, monkeypatch):
    missing = run("ffmpeg", "-i", tmp_path / "nope.m4a", tmp_path / "o.wav")
    assert missing.returncode == 1 and "No such file or directory" in missing.stderr
    # Device and lavfi inputs are not files.
    assert run("ffmpeg", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", tmp_path / "o.wav").returncode == 0
    monkeypatch.setenv("FAKE_FFMPEG_EXIT", "8")
    assert run("ffmpeg", "-f", "lavfi", "-i", "anullsrc", tmp_path / "p.wav").returncode == 8
    assert not (tmp_path / "p.wav").exists()


def test_the_log_records_every_tool_in_order(fake_bin, fake_model, wav):
    run("ffmpeg", "-version")
    run("whisper-cli", "--help")
    assert fake_bin.calls() == [["-version"], ["--help"]]
    assert fake_bin.calls("whisper-cli") == [["--help"]]
