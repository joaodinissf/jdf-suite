"""The Parakeet engine, through the engine slot, against the fake parakeet-cli.

Real Parakeet transcription is BLIND: no Parakeet model is on disk, and the segment
format and time units are read from the binary's format strings, not from a real run.
"""

import json
import os

import pytest

from jdf_stt import audio, pipeline, registry
from jdf_stt.types import Segment, SttError, ToolMissing, TranscribeOptions


@pytest.fixture
def wav(tmp_path):
    path = tmp_path / "in.wav"
    path.write_bytes(b"RIFF")
    return path


def test_parakeet_is_registered_in_the_engine_slot():
    assert "parakeet" in registry.engine_names()
    assert registry.get_engine("parakeet").name == "parakeet"


def test_command_and_parsed_segments_without_blank_ones(fake_bin, fake_model, wav, monkeypatch):
    segments = [[0, 150, "Hello there."], [150, 200, "  "], [200, 420, "Second bit."]]
    monkeypatch.setenv("FAKE_PARAKEET_SEGMENTS", json.dumps(segments))
    engine = registry.get_engine("parakeet")
    t = engine.transcribe(wav, TranscribeOptions(engine="parakeet", model=str(fake_model), threads=2))
    assert fake_bin.calls("parakeet-cli") == [["-m", str(fake_model), "-f", str(wav), "-np", "-ps", "-t", "2"]]
    assert t.segments == (Segment(0.0, 1.5, "Hello there."), Segment(2.0, 4.2, "Second bit."))
    assert t.text == "Hello there. Second bit."
    assert t.language is None
    assert (t.engine, t.model) == ("parakeet", fake_model.name)


def test_no_threads_flag_unless_asked(fake_bin, fake_model, wav):
    registry.get_engine("parakeet").transcribe(wav, TranscribeOptions(model=str(fake_model)))
    assert "-t" not in fake_bin.calls("parakeet-cli")[0]


def test_no_speech_gives_empty_text(fake_bin, fake_model, wav, monkeypatch):
    monkeypatch.setenv("FAKE_PARAKEET_SEGMENTS", "[]")
    t = registry.get_engine("parakeet").transcribe(wav, TranscribeOptions(model=str(fake_model)))
    assert (t.text, t.segments) == ("", ())


def test_model_must_be_a_file(fake_bin, wav):
    with pytest.raises(SttError, match="--model"):
        registry.get_engine("parakeet").transcribe(wav, TranscribeOptions(engine="parakeet"))
    assert fake_bin.calls("parakeet-cli") == []


def test_failure_shows_stderr(fake_bin, fake_model, wav, monkeypatch):
    monkeypatch.setenv("FAKE_PARAKEET_EXIT", "4")
    monkeypatch.setenv("FAKE_PARAKEET_STDERR", "error: failed to process audio file")
    with pytest.raises(SttError, match="failed to process audio file"):
        registry.get_engine("parakeet").transcribe(wav, TranscribeOptions(model=str(fake_model)))


def test_missing_parakeet_cli_says_how_to_install(tmp_path, fake_model, wav, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    with pytest.raises(ToolMissing, match="brew install whisper-cpp"):
        registry.get_engine("parakeet").transcribe(wav, TranscribeOptions(model=str(fake_model)))


def test_engine_parakeet_through_the_pipeline(fake_bin, fake_model, wav, monkeypatch):
    """`--engine parakeet` picks this engine through the slot (audio prep is PR 02's, stubbed here)."""
    monkeypatch.setattr(audio, "prepare", lambda src, workdir: src)
    monkeypatch.setattr(audio, "duration", lambda path: 2.0)
    t = pipeline.transcribe_file(wav, TranscribeOptions(engine="parakeet", model=str(fake_model)))
    assert t.to_dict() == {
        "text": "Hello from the fake parakeet.",
        "language": None,
        "engine": "parakeet",
        "model": fake_model.name,
        "duration": 2.0,
        "segments": [{"start": 0.0, "end": 2.0, "text": "Hello from the fake parakeet."}],
    }
    assert len(fake_bin.calls("parakeet-cli")) == 1
    assert os.environ["PATH"].startswith(str(fake_bin.dir))
