"""Language detection follow-up. Owned by PR 03 (stub from PR 01)."""

from __future__ import annotations

from jdf_stt.types import TranscribeOptions, Transcript


def retry_language(t: Transcript, o: TranscribeOptions) -> str | None:
    """The language to rerun with, or None to keep `t`.

    PR 03: when `o.language == "auto"`, `o.expected_languages` is non-empty and `t.language`
    is not in it, return `o.expected_languages[0]`.
    """
    return None
