"""Vocabulary, find-and-replace and filler words.

- `--prompt TEXT` and `--vocab FILE` (one term per line) become whisper's `--prompt`
  (`TranscribeOptions.effective_prompt()`), which nudges the model towards those spellings.
- `--replace FILE` (`from => to` lines) and config `[replace]` fix words the model still gets
  wrong: whole words, case-insensitive, longest match first.
- Filler words (`um`, `uh`, ...; per language, config `[fillers]`) are removed unless
  `--keep-fillers`, only when the detected language has a filler list.
"""

from __future__ import annotations

import argparse
import dataclasses
import re
from collections.abc import Callable
from pathlib import Path

from jdf_stt import registry
from jdf_stt.types import Segment, TranscribeOptions, Transcript


def _lines(path: str) -> list[tuple[int, str]]:
    """(line number, stripped text) for each non-blank line that is not a `#` comment."""
    try:
        text = Path(path).expanduser().read_text(encoding="utf-8")
    except OSError as e:
        raise argparse.ArgumentTypeError(f"cannot read {path}: {e.strerror or e}") from None
    numbered = ((n, line.strip()) for n, line in enumerate(text.splitlines(), 1))
    return [(n, line) for n, line in numbered if line and not line.startswith("#")]


def read_vocab(path: str) -> list[str]:
    return [line for _, line in _lines(path)]


def read_replacements(path: str) -> list[tuple[str, str]]:
    pairs = []
    for n, line in _lines(path):
        src, arrow, dst = line.partition("=>")
        if not arrow or not src.strip():
            raise argparse.ArgumentTypeError(f"{path}:{n}: expected `from => to`, got {line!r}")
        pairs.append((src.strip(), dst.strip()))
    return pairs


@registry.transcribe_options
def add(group: argparse._ArgumentGroup) -> None:
    group.add_argument("--prompt", dest="prompt", metavar="TEXT", help="context for whisper, e.g. the topic")
    group.add_argument(
        "--vocab",
        dest="vocabulary",
        type=read_vocab,
        action="extend",
        metavar="FILE",
        help="words and names to spell right, one per line (repeatable)",
    )
    group.add_argument(
        "--replace",
        dest="replacements",
        type=read_replacements,
        action="extend",
        metavar="FILE",
        help="find-and-replace list, one `from => to` per line (repeatable; adds to config [replace])",
    )
    group.add_argument(
        "--keep-fillers",
        dest="remove_fillers",
        action="store_false",
        default=None,
        help="keep filler words such as um and uh (removed by default)",
    )


def _word_pattern(words: list[str]) -> str:
    """Any of `words` as a whole word (longest first); works for terms like `c++` too."""
    alternatives = "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))
    return rf"(?<!\w)(?:{alternatives})(?!\w)"


def _rewrite(t: Transcript, fix: Callable[[str], str]) -> Transcript:
    """Apply `fix` to the text and every segment; segments left empty are dropped."""
    segments = tuple(Segment(s.start, s.end, fix(s.text)) for s in t.segments)
    return dataclasses.replace(t, text=fix(t.text), segments=tuple(s for s in segments if s.text.strip()))


@registry.postprocessor(20)
def find_and_replace(t: Transcript, o: TranscribeOptions) -> Transcript:
    if not o.replacements:
        return t
    targets = {src.lower(): dst for src, dst in o.replacements}
    pattern = re.compile(_word_pattern(list(targets)), re.IGNORECASE)
    return _rewrite(t, lambda text: pattern.sub(lambda m: targets[m.group(0).lower()], text))


_CAPITAL = "\x00"


def _tidy(text: str) -> str:
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)  # "word ," -> "word,"
    text = re.sub(r"[,;:]+([.!?])", r"\1", text)  # "was,." -> "was."
    text = re.sub(r",{2,}", ",", text)
    return re.sub(r"^[\s,.;:!?]+", "", text).rstrip()


@registry.postprocessor(30)
def remove_fillers(t: Transcript, o: TranscribeOptions) -> Transcript:
    words = o.fillers.get(t.language or "") if o.remove_fillers else None
    if not words:
        return t
    # A filler with its comma and the space after it. A word in capitals ("ER", "AH-64") is an
    # acronym and stays. A capitalised filler at the start of a sentence leaves a mark that
    # capitalises the next word ("Um, so" -> "So"), so fillers in a row are all removed.
    pattern = re.compile("(" + _word_pattern(list(words)) + r"),?\s*", re.IGNORECASE)

    def drop(m: re.Match[str]) -> str:
        word = m.group(1)
        if len(word) > 1 and word.isupper():
            return m.group(0)
        starts_sentence = re.search(r"(^|[.!?])\s*$", m.string[: m.start()]) is not None
        return _CAPITAL if word[0].isupper() and starts_sentence else ""

    def fix(text: str) -> str:
        cleaned = pattern.sub(drop, text)
        cleaned = re.sub(_CAPITAL + r"+(\w?)", lambda m: m.group(1).upper(), cleaned)
        if cleaned == text:
            return text
        lead = " " if text[:1].isspace() else ""
        tidy = _tidy(cleaned)
        return lead + tidy if tidy else ""

    return _rewrite(t, fix)
