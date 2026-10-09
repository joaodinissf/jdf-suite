"""Local-LLM rewrite modes: `--mode clean|email|notes|message` and the `modes` command.

The transcript text goes to a model running on this Mac (llama.cpp's llama-server or Ollama,
see `llm.py`) with the mode's prompt, and the reply replaces the text. Segments and their
timestamps are kept as transcribed. More modes come from config.toml:

    [modes.tweet]
    prompt = "Rewrite this as a tweet."
"""

from __future__ import annotations

import argparse
import dataclasses

from jdf_stt import config, llm, registry
from jdf_stt.types import SttError, TranscribeOptions, Transcript

BUILTIN_MODES = {
    "clean": (
        "Fix the punctuation, capitalisation and obvious transcription slips in this dictated text. "
        "Do not reword, summarise, add or remove anything else."
    ),
    "email": (
        "Turn this dictated text into a clear, polite email body, with a greeting and a sign-off "
        "only if the speaker gave them. Keep every fact and request; do not invent any."
    ),
    "notes": (
        "Turn this dictated text into short bullet-point notes, one idea per bullet, "
        "using '- ' bullets. Keep every fact; do not invent any."
    ),
    "message": (
        "Turn this dictated text into a short, casual chat message, as the speaker would type it. "
        "Keep the meaning; do not add anything."
    ),
}

_RULES = (
    "The text is a speech transcript{language}. Answer in the same language as the text. "
    "Reply with the rewritten text only: no preamble, no quotes, no explanation."
)


def modes(cfg: dict | None = None) -> dict[str, str]:
    """Mode name -> prompt: the built-in modes, then config.toml's `[modes.<name>]` (which may override them)."""
    if cfg is None:
        cfg = config.load_config()
    found = dict(BUILTIN_MODES)
    for name, table in cfg.get("modes", {}).items():
        prompt = table.get("prompt") if isinstance(table, dict) else None
        if not isinstance(prompt, str) or not prompt.strip():
            raise SttError(f'{config.config_path()}: [modes.{name}] needs prompt = "..."')
        found[name] = prompt.strip()
    return found


@registry.transcribe_options
def add_options(group: argparse._ArgumentGroup) -> None:
    group.add_argument(
        "--mode",
        default=None,
        metavar="NAME",
        help="rewrite the text with a local LLM: clean, email, notes, message, or one from config.toml "
        "(`jdf-stt modes` lists them)",
    )
    group.add_argument(
        "--llm-backend",
        dest="llm_backend",
        choices=["llama.cpp", "ollama"],
        default=None,
        help="local LLM server for --mode (default llama.cpp)",
    )
    group.add_argument(
        "--llm-url",
        dest="llm_url",
        default=None,
        metavar="URL",
        help=f"its URL, on this Mac only (default {llm.LLAMA_CPP_URL}; Ollama {llm.OLLAMA_URL})",
    )
    group.add_argument(
        "--llm-model", dest="llm_model", default=None, metavar="NAME", help="model name (required for Ollama)"
    )


@registry.option_check
def check(o: TranscribeOptions) -> dict[str, str]:
    """Refuse an unknown --mode or unusable LLM settings before any audio work; returns the modes."""
    if o.mode is None:
        return {}
    available = modes()
    if o.mode not in available:
        raise SttError(f"unknown mode {o.mode!r} (available: {', '.join(sorted(available))})")
    llm.check_options(o)
    return available


@registry.postprocessor(50)
def rewrite(t: Transcript, o: TranscribeOptions) -> Transcript:
    if o.mode is None:
        return t
    available = check(o)
    if not t.text.strip():
        return t  # nothing said: nothing to rewrite
    language = f" (language: {t.language})" if t.language else ""
    system = available[o.mode] + "\n\n" + _RULES.format(language=language)
    return dataclasses.replace(t, text=llm.chat(o, system, t.text.strip()))


@registry.command("modes", help="List the local-LLM rewrite modes for --mode.")
def setup(parser: argparse.ArgumentParser):
    def run(ns: argparse.Namespace) -> int:
        cfg = config.load_config()
        found = modes(cfg)
        from_config = set(cfg.get("modes", {}))
        width = max(map(len, found))
        for name in sorted(found):
            summary = found[name].splitlines()[0]
            print(f"{name:<{width}}  {summary}" + ("  (config)" if name in from_config else ""))
        return 0

    return run
