"""Real language detection and output formats through the whisper-cpp engine and the local model.

The engine is the real `whisper-cpp` one, wrapped only to record the language of each run, so the
expected-languages retry is exercised against the real model through the real pipeline.
"""

import json

import pytest

from jdf_stt import formats, pipeline, registry
from jdf_stt.engines.whisper_cpp import WhisperCppEngine
from jdf_stt.types import TranscribeOptions

pytestmark = pytest.mark.real

EN = "The weather is lovely today, so we are going for a long walk in the park."
PT = "Hoje está um dia muito bonito, por isso vamos dar um passeio comprido no parque."


class RecordingEngine(WhisperCppEngine):
    name = "recording-whisper-cpp"

    def __init__(self, model):
        self.model = model
        self.languages: list[str] = []

    def transcribe(self, wav, o):
        self.languages.append(o.language)
        return super().transcribe(wav, o)


@pytest.fixture
def engine(real_model, clean_registry):
    e = RecordingEngine(real_model)
    registry.register_engine(e.name, lambda: e)
    return e


def run(engine, wav, **kw):
    return pipeline.transcribe_file(wav, TranscribeOptions(engine=engine.name, model=str(engine.model), **kw))


def test_english_is_detected(engine, say_wav):
    t = run(engine, say_wav(EN, voice="Samantha"))
    assert t.language == "en"
    assert "walk" in t.text.lower() and "park" in t.text.lower()
    assert engine.languages == ["auto"]


@pytest.mark.parametrize("voice", ["Joana", "Luciana"])
def test_portuguese_is_detected(engine, say_wav, voice):
    t = run(engine, say_wav(PT, voice=voice))
    assert t.language == "pt"
    assert "parque" in t.text.lower()


def test_detection_inside_the_expected_list_runs_once(engine, say_wav):
    t = run(engine, say_wav(PT, voice="Joana"), expected_languages=("en", "pt"))
    assert t.language == "pt"
    assert engine.languages == ["auto"]


def test_detection_outside_the_expected_list_reruns_in_the_first(engine, say_wav):
    t = run(engine, say_wav(PT, voice="Joana"), expected_languages=("es",))
    assert engine.languages == ["auto", "es"]
    assert t.language == "es"


def test_real_transcript_in_every_format(engine, say_wav, tmp_path):
    t = run(engine, say_wav(PT, voice="Luciana"))
    paths = formats.write_outputs(t, tmp_path / "talk", ["txt", "srt", "vtt", "json"])
    txt, srt, vtt, js = (p.read_text(encoding="utf-8") for p in paths)
    assert "parque" in txt.lower()
    assert srt.startswith("1\n00:00:0") and " --> " in srt and "parque" in srt.lower()
    assert vtt.startswith("WEBVTT\n\n00:00:0") and "parque" in vtt.lower()
    doc = json.loads(js)
    assert doc["language"] == "pt" and doc["segments"] and doc["duration"] > 2
    assert all(s["end"] >= s["start"] for s in doc["segments"])
