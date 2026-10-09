"""Language: the expected-languages retry rule, code normalising and the detected-language line."""

from __future__ import annotations

import re

from jdf_stt.types import SttError, TranscribeOptions, Transcript

_CODE = re.compile(r"[a-z]{2,3}")


def normalise(value: str) -> str:
    """A whisper language code from what a person types: `pt-BR`, `pt_PT`, `PT` -> `pt`; `auto` stays."""
    code = value.strip().lower().replace("_", "-").split("-")[0]
    if code != "auto" and not _CODE.fullmatch(code):
        raise SttError(f"{value!r} is not a language code (use one like en, pt or de, or auto)")
    return code


def expected(o: TranscribeOptions) -> tuple[str, ...]:
    """`o.expected_languages` as whisper codes; config.toml may give `"pt"` or `["pt-BR", "en"]`."""
    values = o.expected_languages
    return tuple(normalise(v) for v in ((values,) if isinstance(values, str) else values))


def retry_language(t: Transcript, o: TranscribeOptions) -> str | None:
    """The language to rerun with, or None to keep `t`.

    Only when detecting (`o.language` is `auto`) with a non-empty expected list: a detection
    outside that list (common on very short clips) is rerun with its first entry. Codes are
    normalised here, since config.toml values reach the options as typed.
    """
    codes = expected(o)
    if normalise(o.language) == "auto" and codes and t.language not in codes:
        return codes[0]
    return None


def describe(t: Transcript) -> str | None:
    """The stderr line for the detected language (`language: en`), or None when the engine has none."""
    return f"language: {t.language}" if t.language else None
