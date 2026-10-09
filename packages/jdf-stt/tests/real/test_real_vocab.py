"""Real runs: steering whisper towards a made-up product name, then fixing it with --replace.

Seen 2026-10-10 with large-v3-turbo: a bare term as the prompt ("Huddle Tab Sorter") is not
followed, while a sentence is ("Glossary: ..." only sometimes), so `--vocab` terms are sent as
"Names in this recording: ...".
"""

import pytest
from _whisper import transcribe, vad_model_path

from jdf_stt.types import TranscribeOptions

pytestmark = pytest.mark.real

SENTENCE = "Um, I sorted all my windows with Huddle tab sorter this morning."
TERM = "Huddle Tab Sorter"


def test_vocab_alone_spells_the_term(real_model, say_wav, tmp_path):
    _, t = transcribe(real_model, say_wav(SENTENCE), tmp_path, TranscribeOptions(vad=False, vocabulary=(TERM,)))
    assert TERM in t.text


def test_a_prompt_sentence_with_the_term_spells_it(real_model, say_wav, tmp_path):
    o = TranscribeOptions(vad=False, prompt=f"I use the {TERM}.")
    raw, _ = transcribe(real_model, say_wav(SENTENCE), tmp_path, o)
    assert TERM in raw.text


def test_replacements_and_fillers_fix_the_text(real_model, say_wav, tmp_path):
    vad = vad_model_path(TranscribeOptions()).is_file()  # speech survives VAD when the model is here
    o = TranscribeOptions(vad=vad, vocabulary=(TERM,), replacements=(("huddle tab sorter", TERM),))
    raw, t = transcribe(real_model, say_wav(SENTENCE), tmp_path, o)
    print(f"whisper said {raw.text!r}; after fixes {t.text!r}")
    assert raw.language == "en"
    assert t.text == f"I sorted all my windows with {TERM} this morning."
