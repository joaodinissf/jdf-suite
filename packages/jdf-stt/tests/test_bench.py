"""`jdf-stt bench`: latency of a transcription, and whisper-bench's own figures with --raw."""

import re

import pytest

from jdf_stt import audio
from jdf_stt.features import bench


@pytest.fixture
def wav(tmp_path):
    path = tmp_path / "talk.wav"
    path.write_bytes(b"RIFF")
    return path


@pytest.fixture
def fake_audio(monkeypatch):
    """audio.prepare/duration are PR 02's; stand-ins here: the input as is, 4 s long."""
    monkeypatch.setattr(audio, "prepare", lambda src, workdir: src)
    monkeypatch.setattr(audio, "duration", lambda path: 4.0)


def test_bench_reports_wall_clock_and_real_time_factor(cli, fake_engine, fake_audio, wav, monkeypatch):
    clock = iter([100.0, 101.0])
    monkeypatch.setattr(bench.time, "perf_counter", lambda: next(clock))
    r = cli("bench", wav, "--engine", "fake", "-m", "tiny")
    assert r.code == 0, r.err
    assert len(fake_engine.calls) == 1
    rows = dict(re.split(r"\s{2,}", line, maxsplit=1) for line in r.out.splitlines())
    assert rows == {
        "file": "talk.wav",
        "engine": "fake",
        "model": "tiny",
        "audio": "4.00 s",
        "wall clock": "1.00 s",
        "real-time factor": "0.25 (4.0x faster than real time)",
    }


def test_bench_without_audio_length(cli, fake_engine, monkeypatch, wav):
    monkeypatch.setattr(audio, "prepare", lambda src, workdir: src)
    monkeypatch.setattr(audio, "duration", lambda path: None)
    r = cli("bench", wav, "--engine", "fake")
    assert r.code == 0, r.err
    assert "real-time factor  n/a" in r.out


def test_raw_runs_whisper_bench(cli, fake_bin, fake_model):
    r = cli("bench", "--raw", "-m", fake_model)
    assert r.code == 0, r.err
    assert fake_bin.calls("whisper-bench") == [["-m", str(fake_model), "-t", "4", "-w", "0"]]
    rows = {line.split()[0]: line.split()[1:] for line in r.out.splitlines()}
    assert rows["whisper-bench"] == [fake_model.name + ",", "4", "threads"]
    assert rows["load"] == ["1552.03", "ms"]
    assert rows["encode"] == ["734.00", "ms"]
    assert rows["decode"] == ["829.55", "ms"]
    assert rows["total"] == ["2220.70", "ms"]


def test_raw_threads(cli, fake_bin, fake_model):
    assert cli("bench", "--raw", "-m", fake_model, "-t", "8").code == 0
    assert fake_bin.calls("whisper-bench")[0] == ["-m", str(fake_model), "-t", "8", "-w", "0"]


def test_raw_failure(cli, fake_bin, fake_model, monkeypatch):
    monkeypatch.setenv("FAKE_BENCH_EXIT", "2")
    monkeypatch.setenv("FAKE_BENCH_STDERR", "ggml: out of memory")
    r = cli("bench", "--raw", "-m", fake_model)
    assert r.code == 1
    assert "whisper-bench failed" in r.err and "out of memory" in r.err


def test_raw_with_no_timings_is_an_error(cli, fake_bin, fake_model, monkeypatch):
    monkeypatch.setattr(bench, "parse_timings", lambda text: {})
    r = cli("bench", "--raw", "-m", fake_model)
    assert r.code == 1 and "no timings" in r.err


def test_file_or_raw_is_required(cli):
    r = cli("bench")
    assert r.code == 2
    assert "FILE" in r.err
