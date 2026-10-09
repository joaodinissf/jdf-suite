"""srt, vtt and json output (golden files inline)."""

import json

import pytest

from jdf_stt import formats
from jdf_stt.types import Segment, Transcript

T = Transcript(
    " Hello there. General Kenobi. ",
    (
        Segment(0.0, 1.5, " Hello there."),
        Segment(1.5, 3723.0456, " General Kenobi. "),
    ),
    "en",
    "whisper-cpp",
    "ggml-small.bin",
    duration=3724.0,
)
SILENCE = Transcript("", (), None, "whisper-cpp", "ggml-small.bin", duration=5.0)

SRT = """\
1
00:00:00,000 --> 00:00:01,500
Hello there.

2
00:00:01,500 --> 01:02:03,046
General Kenobi.
"""

VTT = """\
WEBVTT

00:00:00.000 --> 00:00:01.500
Hello there.

00:00:01.500 --> 01:02:03.046
General Kenobi.
"""


def test_srt_golden():
    assert formats.render(T, "srt") == SRT


def test_vtt_golden():
    assert formats.render(T, "vtt") == VTT


def test_json_is_the_to_dict_contract_with_the_detected_language():
    out = formats.render(T, "json")
    assert out.endswith("}\n")
    assert out.startswith('{\n  "text"')  # indent 2
    doc = json.loads(out)
    assert doc == T.to_dict()
    assert doc["language"] == "en"
    assert doc["segments"][1] == {"start": 1.5, "end": 3723.0456, "text": "General Kenobi."}


def test_json_keeps_non_ascii_text_readable():
    t = Transcript("Olá, João.", (Segment(0, 1, "Olá, João."),), "pt", "fake", "m")
    out = formats.render(t, "json")
    assert "Olá, João." in out
    assert json.loads(out)["text"] == "Olá, João."


def test_silence_srt_is_empty_vtt_is_a_bare_header_json_is_still_valid():
    assert formats.render(SILENCE, "srt") == ""
    assert formats.render(SILENCE, "vtt") == "WEBVTT\n"
    doc = json.loads(formats.render(SILENCE, "json"))
    assert doc["text"] == "" and doc["segments"] == [] and doc["language"] is None


def test_blank_segments_are_skipped_and_cues_stay_numbered():
    t = Transcript("a b", (Segment(0, 1, " a"), Segment(1, 2, "  "), Segment(2, 3, "b")), "en", "fake", "m")
    srt = formats.render(t, "srt")
    assert srt.split("\n\n")[1].startswith("2\n00:00:02,000 --> 00:00:03,000\nb")
    assert formats.render(t, "vtt").count("-->") == 2


@pytest.mark.parametrize(
    ("seconds", "srt", "vtt"),
    [
        (0, "00:00:00,000", "00:00:00.000"),
        (0.0004, "00:00:00,000", "00:00:00.000"),
        (0.9996, "00:00:01,000", "00:00:01.000"),
        (59.999, "00:00:59,999", "00:00:59.999"),
        (3600, "01:00:00,000", "01:00:00.000"),
        (-0.2, "00:00:00,000", "00:00:00.000"),
    ],
)
def test_timestamps(seconds, srt, vtt):
    assert formats.timestamp(seconds, ",") == srt
    assert formats.timestamp(seconds, ".") == vtt


def test_write_outputs_writes_every_requested_format(tmp_path):
    paths = formats.write_outputs(T, tmp_path / "out" / "talk", ["srt", "json", "vtt", "txt"])
    assert [p.name for p in paths] == ["talk.srt", "talk.json", "talk.vtt", "talk.txt"]
    assert paths[0].read_text(encoding="utf-8") == SRT
    assert json.loads(paths[1].read_text(encoding="utf-8"))["language"] == "en"
    assert paths[2].read_text(encoding="utf-8") == VTT
