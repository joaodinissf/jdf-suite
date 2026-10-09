"""The expected-languages retry rule and the detected-language line."""

import argparse

import pytest

from jdf_stt import language, registry
from jdf_stt.types import SttError, TranscribeOptions, Transcript


def t(lang):
    return Transcript("x", (), lang, "fake", "m")


@pytest.mark.parametrize(
    ("detected", "opts", "expected"),
    [
        ("en", TranscribeOptions(), None),  # no list: keep whatever was detected
        ("en", TranscribeOptions(expected_languages=("en", "pt")), None),
        ("pt", TranscribeOptions(expected_languages=("en", "pt")), None),
        ("nn", TranscribeOptions(expected_languages=("pt", "en")), "pt"),  # outside: rerun with the first
        (None, TranscribeOptions(expected_languages=("pt",)), "pt"),  # nothing detected
        ("gl", TranscribeOptions(language="es", expected_languages=("pt",)), None),  # language forced
    ],
)
def test_retry_rule(detected, opts, expected):
    assert language.retry_language(t(detected), opts) == expected


def test_detected_language_line():
    assert language.describe(t("pt")) == "language: pt"
    assert language.describe(t(None)) is None


@pytest.mark.parametrize(
    ("given", "code"),
    [("auto", "auto"), ("EN", "en"), ("pt-BR", "pt"), ("pt_PT", "pt"), (" de ", "de")],
)
def test_normalise(given, code):
    assert language.normalise(given) == code


@pytest.mark.parametrize("bad", ["", "english!", "e"])
def test_normalise_rejects_what_is_not_a_language_code(bad):
    with pytest.raises(SttError, match="language"):
        language.normalise(bad)


def test_config_values_are_normalised_like_the_command_line():
    def opts(transcribe):
        return registry.options_from_args(argparse.Namespace(), {"transcribe": transcribe})

    listed = opts({"expected_languages": ["pt-BR", "EN"], "language": "AUTO"})
    assert language.retry_language(t("pt"), listed) is None  # pt-BR is pt: no second run
    assert language.retry_language(t("nn"), listed) == "pt"  # and the rerun uses a whisper code
    single = opts({"expected_languages": "pt"})  # a plain string, not split into letters
    assert language.retry_language(t("en"), single) == "pt"
    assert language.retry_language(t("pt"), single) is None
    pinned = opts({"language": "PT", "expected_languages": ["en"]})
    assert language.retry_language(t("de"), pinned) is None  # a pinned language never reruns
