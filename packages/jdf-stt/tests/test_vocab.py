"""Vocabulary prompt, find-and-replace and filler words."""

import pytest

from jdf_stt import cli, registry
from jdf_stt.features import vocab
from jdf_stt.types import Segment, TranscribeOptions, Transcript


def options(*args, cfg=None):
    ns = cli.build_parser().parse_args(["transcribe", *map(str, args)])
    return registry.options_from_args(ns, cfg or {})


def transcript(*texts, language="en"):
    segs = tuple(Segment(float(i), float(i + 1), t) for i, t in enumerate(texts))
    return Transcript(" ".join(t.strip() for t in texts), segs, language, "fake", "m")


# Options -----------------------------------------------------------------------


def test_prompt_and_vocab_files_make_the_whisper_prompt(tmp_path):
    a = tmp_path / "a.txt"
    a.write_text("# product names\nHuddle tab sorter\n\n  jdf-stt  \n", encoding="utf-8")
    b = tmp_path / "b.txt"
    b.write_text("Ollama\n", encoding="utf-8")
    o = options("x.wav", "--prompt", "A talk about tools.", "--vocab", a, "--vocab", b)
    assert o.vocabulary == ("Huddle tab sorter", "jdf-stt", "Ollama")
    assert o.effective_prompt() == "A talk about tools. Names in this recording: Huddle tab sorter, jdf-stt, Ollama."


def test_replace_file_is_read_and_merged_with_config(tmp_path):
    f = tmp_path / "r.txt"
    f.write_text("# fixes\nhuddle => Huddle\njay dee eff =>JDF\nfoo =>\n", encoding="utf-8")
    o = options("x.wav", "--replace", f, cfg={"replace": {"Huddle": "HUDDLE", "gpt": "GPT"}})
    assert dict(o.replacements) == {"huddle": "Huddle", "jay dee eff": "JDF", "foo": "", "gpt": "GPT"}


def test_keep_fillers_turns_removal_off():
    assert options("x.wav").remove_fillers is True
    assert options("x.wav", "--keep-fillers").remove_fillers is False


@pytest.mark.parametrize("content", ["no arrow here\n", " => only a target\n"])
def test_a_malformed_replace_line_is_a_usage_error(tmp_path, cli, content):
    f = tmp_path / "r.txt"
    f.write_text("ok => fine\n" + content, encoding="utf-8")
    result = cli("transcribe", "x.wav", "--replace", f)
    assert result.code == 2
    assert f"{f}:2" in result.err


def test_a_missing_vocab_file_is_a_usage_error(tmp_path, cli):
    result = cli("transcribe", "x.wav", "--vocab", tmp_path / "nope.txt")
    assert result.code == 2
    assert "nope.txt" in result.err


def test_postprocessors_are_registered_in_order():
    assert (20, vocab.find_and_replace) in registry._postprocessors
    assert (30, vocab.remove_fillers) in registry._postprocessors


# Find and replace --------------------------------------------------------------


def replace(text, pairs):
    return vocab.find_and_replace(transcript(text), TranscribeOptions(replacements=pairs))


def test_replacements_are_whole_word_and_case_insensitive():
    t = replace(" The HUDDLE shuddles; huddle up.", (("huddle", "Huddle"),))
    assert t.text == "The Huddle shuddles; Huddle up."
    assert t.segments[0].text == " The Huddle shuddles; Huddle up."


def test_the_longest_match_wins():
    pairs = (("tab", "Tab"), ("huddle tab sorter", "Huddle Tab Sorter"))
    assert replace("a huddle tab sorter and a tab", pairs).text == "a Huddle Tab Sorter and a Tab"


def test_terms_with_punctuation_match_as_words():
    assert replace("I use c++ and c++11.", (("c++", "C++"),)).text == "I use C++ and c++11."


def test_replacement_text_is_literal():
    assert replace("cost dollars", (("dollars", r"\1 $"),)).text == r"cost \1 $"


def test_no_replacements_leaves_the_transcript_alone():
    t = transcript("hello")
    assert vocab.find_and_replace(t, TranscribeOptions()) is t


# Fillers -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ("Um, I think so.", "I think so."),
        ("So, um, I think, uh, yes.", "So, I think, yes."),
        ("It was, uh.", "It was."),
        ("Well hmm I am erm here", "Well I am here"),
        ("Umbrella, ahead, there.", "Umbrella, ahead, there."),
        ("Uh, okay. Um, uh, fine.", "Okay. Fine."),
        (" The ER was busy.", "The ER was busy."),
        ("Er, the AH-64 flew.", "The AH-64 flew."),
        ("I said Um to them.", "I said to them."),
        ("Um.", ""),
    ],
)
def test_fillers_are_removed_and_punctuation_tidied(before, after):
    t = vocab.remove_fillers(transcript(before), TranscribeOptions())
    assert t.text == after


def test_segments_are_cleaned_and_emptied_ones_dropped():
    t = vocab.remove_fillers(transcript(" Um.", " Hello, uh, world."), TranscribeOptions())
    assert [s.text for s in t.segments] == [" Hello, world."]
    assert t.text == "Hello, world."


def test_fillers_follow_the_detected_language():
    pt = transcript("um olá", language="pt")
    assert vocab.remove_fillers(pt, TranscribeOptions()) is pt
    o = TranscribeOptions(fillers={"en": ("um",), "pt": ("hã", "tipo")})
    assert vocab.remove_fillers(transcript("Hã, tipo, olá", language="pt"), o).text == "Olá"


def test_unknown_language_and_keep_fillers_leave_text_alone():
    unknown = transcript("um hello", language=None)
    assert vocab.remove_fillers(unknown, TranscribeOptions()) is unknown
    kept = transcript("um hello")
    assert vocab.remove_fillers(kept, TranscribeOptions(remove_fillers=False)) is kept


def test_config_fillers_set_a_language_list_and_add_languages():
    o = options("x.wav", cfg={"fillers": {"en": ["like"], "pt": ["tipo"]}})
    assert o.fillers == {"en": ("like",), "pt": ("tipo",)}
