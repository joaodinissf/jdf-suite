import dataclasses

import pytest

from jdf_stt.types import Cancelled, Segment, SttError, ToolMissing, TranscribeOptions, Transcript


def test_defaults_match_the_product_decisions():
    o = TranscribeOptions()
    assert (o.engine, o.model, o.language) == ("whisper-cpp", "small", "auto")
    assert o.vad and o.suppress_nst and o.remove_fillers
    assert o.vad_model == "silero-v6.2.0"
    assert o.no_speech_threshold == 0.6
    assert o.formats == ("txt",)
    assert o.llm_url == "http://127.0.0.1:8080"


def test_options_are_frozen_and_fillers_are_not_shared():
    a, b = TranscribeOptions(), TranscribeOptions()
    with pytest.raises(dataclasses.FrozenInstanceError):
        a.model = "tiny"  # type: ignore[misc]
    a.fillers["pt"] = ("tipo",)
    assert "pt" not in b.fillers


@pytest.mark.parametrize(
    ("prompt", "vocabulary", "expected"),
    [
        ("", (), ""),
        ("  A talk about tabs. ", (), "A talk about tabs."),
        ("", ("Huddle", " jdf-stt "), "Names in this recording: Huddle, jdf-stt."),
        ("Tabs.", ("Huddle", "", "OpenRouter"), "Tabs. Names in this recording: Huddle, OpenRouter."),
    ],
)
def test_effective_prompt(prompt, vocabulary, expected):
    assert TranscribeOptions(prompt=prompt, vocabulary=vocabulary).effective_prompt() == expected


def test_to_dict_is_the_json_contract():
    t = Transcript(
        text=" Hello there. ",
        segments=(Segment(0, 1.5, " Hello"), Segment(1.5, 2, " there. ")),
        language="en",
        engine="whisper-cpp",
        model="small",
        duration=2,
    )
    d = t.to_dict()
    assert list(d) == ["text", "language", "engine", "model", "duration", "segments"]
    assert d == {
        "text": "Hello there.",
        "language": "en",
        "engine": "whisper-cpp",
        "model": "small",
        "duration": 2.0,
        "segments": [{"start": 0.0, "end": 1.5, "text": "Hello"}, {"start": 1.5, "end": 2.0, "text": "there."}],
    }
    assert all(isinstance(s["start"], float) for s in d["segments"])
    assert isinstance(d["duration"], float)


def test_to_dict_without_duration_or_language():
    d = Transcript("", (), None, "fake", "m").to_dict()
    assert d["duration"] is None and d["language"] is None and d["segments"] == []


def test_error_hierarchy():
    assert issubclass(ToolMissing, SttError)
    assert issubclass(Cancelled, SttError)
