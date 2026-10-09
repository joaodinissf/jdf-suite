"""One audio file in, one finished transcript out: prepare -> engine -> language retry -> postprocessors."""

from __future__ import annotations

import dataclasses
import tempfile
from pathlib import Path

from jdf_stt import audio, language, registry
from jdf_stt.types import TranscribeOptions, Transcript


def postprocess(t: Transcript, options: TranscribeOptions) -> Transcript:
    """Run every registered postprocessor, lowest order first."""
    for fn in registry.postprocessors():
        t = fn(t, options)
    return t


def transcribe_file(path: Path | str, options: TranscribeOptions) -> Transcript:
    """Transcribe one audio file. The temporary 16 kHz wav is deleted before returning."""
    engine = registry.get_engine(options.engine)
    with tempfile.TemporaryDirectory(prefix="jdf-stt-") as tmp:
        wav = audio.prepare(Path(path), Path(tmp))
        t = engine.transcribe(wav, options)
        retry = language.retry_language(t, options)
        if retry:
            t = engine.transcribe(wav, dataclasses.replace(options, language=retry))
        if t.duration is None:
            t = dataclasses.replace(t, duration=audio.duration(wav))
    return postprocess(t, options)
