import argparse

import pytest

from jdf_stt import config, registry
from jdf_stt.types import SttError, TranscribeOptions

ENGINE_MODULE = """
from jdf_stt import registry
from jdf_stt.types import Transcript


class DemoEngine:
    name = "demo"

    def transcribe(self, audio_path, options):
        return Transcript("demo", (), None, self.name, options.model)


registry.register_engine("demo", DemoEngine)
"""


def test_engines_are_discovered_from_new_files(clean_registry, add_module):
    add_module("jdf_stt.engines", "zz_demo_engine", ENGINE_MODULE)
    assert "demo" in registry.engine_names()
    engine = registry.get_engine("demo")
    assert engine.transcribe(None, TranscribeOptions(model="m")).model == "m"


def test_get_engine_returns_a_fresh_instance(clean_registry, add_module):
    add_module("jdf_stt.engines", "zz_demo_engine", ENGINE_MODULE)
    assert registry.get_engine("demo") is not registry.get_engine("demo")


def test_unknown_engine_lists_the_known_ones(clean_registry):
    registry.register_engine("b-engine", object)
    registry.register_engine("a-engine", object)
    with pytest.raises(SttError, match=r"unknown engine 'nope' \(available: a-engine, b-engine"):
        registry.get_engine("nope")


def test_command_registration(clean_registry):
    @registry.command("demo", help="A demo.")
    def setup(parser):
        return lambda ns: 0

    assert registry.commands()["demo"] == ("A demo.", setup)


def test_option_groups_reach_every_transcribing_parser(clean_registry):
    @registry.transcribe_options
    def add(group):
        group.add_argument("--demo-model", dest="model")

    parser = argparse.ArgumentParser()
    registry.add_transcribe_options(parser)
    assert parser.parse_args(["--demo-model", "tiny"]).model == "tiny"
    assert "transcription options" in parser.format_help()


def test_postprocessors_run_by_order_then_registration(clean_registry):
    registry._postprocessors.clear()
    names = []
    for order, name in [(50, "llm"), (10, "guard"), (30, "fillers"), (20, "replace"), (30, "fillers-2")]:
        fn = registry.postprocessor(order)(lambda t, o, name=name: names.append(name) or t)
        assert callable(fn)
    for fn in registry.postprocessors():
        fn(None, None)
    assert names == ["guard", "replace", "fillers", "fillers-2", "llm"]


def ns(**values):
    return argparse.Namespace(**values)


def test_options_from_args_takes_fields_that_are_given():
    o = registry.options_from_args(
        ns(model="tiny", language=None, formats=["srt", "json"], inputs=["a.wav"], _run=print, vad=False), {}
    )
    assert o.model == "tiny"
    assert o.language == "auto"  # None means "not given"
    assert o.formats == ("srt", "json")  # lists become tuples
    assert o.vad is False  # False is a value, not "missing"


def test_options_from_args_nested_lists_become_tuples():
    o = registry.options_from_args(ns(replacements=[["a", "b"]], mic_input=["-f", "lavfi"]), {})
    assert o.replacements == (("a", "b"),)
    assert o.mic_input == ("-f", "lavfi")


def test_precedence_cli_over_config_over_defaults():
    cfg = {"transcribe": {"model": "base", "language": "pt", "expected_languages": ["pt", "en"]}}
    o = registry.options_from_args(ns(model="tiny", language=None), cfg)
    assert o.model == "tiny"  # command line wins
    assert o.language == "pt"  # config fills the gap
    assert o.expected_languages == ("pt", "en")
    assert o.engine == "whisper-cpp"  # default


def test_config_is_read_from_the_config_file():
    config.config_path().write_text('[transcribe]\nmodel = "medium"\n', encoding="utf-8")
    assert registry.options_from_args(ns()).model == "medium"


def test_unknown_config_option_is_an_error():
    with pytest.raises(SttError, match=r"\[transcribe\] has an unknown option 'modle'"):
        registry.options_from_args(ns(), {"transcribe": {"modle": "tiny"}})


def test_config_replace_table_plus_command_line_pairs():
    cfg = {"replace": {"jay dee eff": "jdf", "huddel": "Huddle"}}
    assert registry.options_from_args(ns(), cfg).replacements == (("jay dee eff", "jdf"), ("huddel", "Huddle"))
    o = registry.options_from_args(ns(replacements=[("Huddel", "HUDDLE"), ("tabz", "tabs")]), cfg)
    assert o.replacements == (("jay dee eff", "jdf"), ("Huddel", "HUDDLE"), ("tabz", "tabs"))


def test_config_fillers_extend_the_defaults():
    o = registry.options_from_args(ns(), {"fillers": {"pt": ["tipo", "pronto"]}})
    assert o.fillers["pt"] == ("tipo", "pronto")
    assert o.fillers["en"] == TranscribeOptions().fillers["en"]


def test_option_checks_run_in_registration_order(clean_registry):
    registry._option_checks.clear()
    seen = []
    for name in ("a", "b"):
        assert callable(registry.option_check(lambda o, name=name: seen.append((name, o))))
    registry.check_options("OPTS")
    assert seen == [("a", "OPTS"), ("b", "OPTS")]
