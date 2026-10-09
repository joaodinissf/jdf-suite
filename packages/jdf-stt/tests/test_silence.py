"""Silence handling: the options that reach TranscribeOptions, and the non-speech guard."""

import pytest

from jdf_stt import cli, registry
from jdf_stt.features import silence
from jdf_stt.types import Segment, TranscribeOptions, Transcript


def options(*args, cfg=None):
    ns = cli.build_parser().parse_args(["transcribe", *args])
    return registry.options_from_args(ns, cfg or {})


def transcript(*texts, language="en"):
    segs = tuple(Segment(float(i), float(i + 1), t) for i, t in enumerate(texts))
    return Transcript("".join(texts).strip(), segs, language, "fake", "m")


def test_defaults_keep_vad_and_guards_on():
    o = options("a.wav")
    assert (o.vad, o.vad_model, o.vad_threshold) == (True, "silero-v6.2.0", 0.5)
    assert (o.no_speech_threshold, o.suppress_nst) == (0.6, True)


def test_every_silence_option_reaches_the_options():
    o = options(
        "a.wav",
        "--no-vad",
        "--vad-model",
        "/m/vad.bin",
        "--vad-threshold",
        "0.3",
        "--no-speech-threshold",
        "0.8",
        "--no-suppress-nst",
    )
    assert (o.vad, o.vad_model, o.vad_threshold) == (False, "/m/vad.bin", 0.3)
    assert (o.no_speech_threshold, o.suppress_nst) == (0.8, False)


def test_config_fills_silence_options_and_the_command_line_wins():
    cfg = {"transcribe": {"vad": False, "no_speech_threshold": 0.9}}
    assert options("a.wav", cfg=cfg).vad is False
    assert options("a.wav", "--no-speech-threshold", "0.7", cfg=cfg).no_speech_threshold == 0.7


@pytest.mark.parametrize("value", ["-0.1", "1.5", "loud"])
def test_thresholds_outside_zero_to_one_are_refused(value, cli):
    result = cli("transcribe", "a.wav", "--vad-threshold", value)
    assert result.code == 2
    assert "--vad-threshold" in result.err


def test_the_guard_is_registered_at_order_10():
    assert (10, silence.drop_non_speech) in registry._postprocessors


@pytest.mark.parametrize(
    "marker",
    [" [BLANK_AUDIO]", " (music)", " [Silence]", " ♪", " ♪♪♪", " [ Silence ]", " (upbeat music)"]
    + [" *sighs*", "", " ..."],
)
def test_markers_alone_become_no_text(marker, capsys):
    t = silence.drop_non_speech(transcript(marker), TranscribeOptions())
    assert t.text == ""
    assert t.segments == ()
    assert "no speech" in capsys.readouterr().err


def test_marker_segments_are_dropped_and_speech_kept(capsys):
    t = silence.drop_non_speech(transcript(" Hello there.", " [BLANK_AUDIO]", " Bye."), TranscribeOptions())
    assert [s.text for s in t.segments] == [" Hello there.", " Bye."]
    assert t.text == "Hello there. Bye."
    assert capsys.readouterr().err == ""


def test_speech_only_is_left_alone():
    original = transcript(" Hello (quietly) there.")
    assert silence.drop_non_speech(original, TranscribeOptions()) is original


def test_an_engine_without_segments_is_judged_by_its_text(capsys):
    marker_only = Transcript("[BLANK_AUDIO]", (), "en", "fake", "m")
    assert silence.drop_non_speech(marker_only, TranscribeOptions()).text == ""
    speech = Transcript("Hello.", (), "en", "fake", "m")
    assert silence.drop_non_speech(speech, TranscribeOptions()) is speech


def test_an_empty_result_also_says_no_speech(capsys):
    empty = Transcript("", (), "en", "fake", "m")  # what whisper returns when VAD finds no speech
    assert silence.drop_non_speech(empty, TranscribeOptions()) == empty
    assert "no speech" in capsys.readouterr().err
