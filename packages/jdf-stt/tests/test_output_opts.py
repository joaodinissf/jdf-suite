"""--format, --language and --expected-language reach TranscribeOptions."""

import pytest

from jdf_stt import cli, registry


def parse(*args, cfg=None):
    ns = cli.build_parser().parse_args(["transcribe", "a.wav", *args])
    return registry.options_from_args(ns, cfg or {})


def test_defaults_come_from_transcribe_options():
    o = parse()
    assert o.formats == ("txt",)
    assert o.language == "auto"
    assert o.expected_languages == ()


def test_formats_repeat_and_keep_order():
    assert parse("-f", "srt", "--format", "json").formats == ("srt", "json")


def test_formats_are_deduplicated():
    assert parse("-f", "srt", "-f", "srt", "-f", "txt").formats == ("srt", "txt")


def test_unknown_format_is_a_usage_error(capsys):
    with pytest.raises(SystemExit) as e:
        parse("-f", "docx")
    assert e.value.code == 2
    assert "docx" in capsys.readouterr().err


def test_language_is_normalised():
    assert parse("-l", "pt-BR").language == "pt"
    assert parse("--language", "AUTO").language == "auto"


def test_expected_languages_by_repeat_or_comma():
    assert parse("--expected-language", "en,pt", "--expected-language", "PT-br,es").expected_languages == (
        "en",
        "pt",
        "es",
    )


def test_bad_language_is_a_usage_error(capsys):
    with pytest.raises(SystemExit):
        parse("--expected-language", "en,", "-l", "x!")
    assert "language" in capsys.readouterr().err


def test_config_fills_what_the_command_line_leaves_out():
    cfg = {"transcribe": {"formats": ["vtt"], "expected_languages": ["pt", "en"]}}
    o = parse(cfg=cfg)
    assert o.formats == ("vtt",) and o.expected_languages == ("pt", "en")
    assert parse("-f", "json", cfg=cfg).formats == ("json",)


def test_help_lists_the_options(cli):
    out = cli("transcribe", "--help").out
    for flag in ("--format", "--language", "--expected-language"):
        assert flag in out
