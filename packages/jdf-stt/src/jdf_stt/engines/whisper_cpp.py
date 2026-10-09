"""The default engine: whisper.cpp's `whisper-cli`, run as a subprocess.

This is the only place that turns `TranscribeOptions` into whisper-cli flags. The result is
read from the JSON file whisper-cli writes (`-oj -of`), never from its stdout.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from jdf_stt import models, procs, registry
from jdf_stt.types import Segment, SttError, TranscribeOptions, Transcript


def _num(value: float) -> str:
    return f"{value:g}"


class WhisperCppEngine:
    name = "whisper-cpp"

    def command(self, wav: Path, out_base: Path, options: TranscribeOptions) -> list[str]:
        """The whisper-cli argv (models resolved, the main one downloaded only with consent)."""
        o = options
        whisper = procs.require_tool("whisper-cli")  # before any download
        model = models.ensure(o.model, download=models.ask_to_download(o.model))
        cmd = [whisper, "-m", str(model), "-f", str(wav), "-l", o.language]
        cmd += ["-oj", "-of", str(out_base), "-np", "-nth", _num(o.no_speech_threshold)]
        if o.suppress_nst:
            cmd.append("-sns")
        if o.vad:
            vad_model = models.ensure(o.vad_model, download=True)  # under 1 MB; part of silence handling
            cmd += ["--vad", "-vm", str(vad_model), "-vt", _num(o.vad_threshold)]
        prompt = o.effective_prompt()
        if prompt:
            cmd += ["--prompt", prompt]
        if o.threads:
            cmd += ["-t", str(o.threads)]
        return cmd

    def transcribe(self, audio_path: Path, options: TranscribeOptions) -> Transcript:
        with tempfile.TemporaryDirectory(prefix="jdf-stt-whisper-") as tmp:
            out_base = Path(tmp) / "out"
            procs.run(self.command(audio_path, out_base, options))
            try:
                doc = json.loads(out_base.with_suffix(".json").read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                raise SttError(f"whisper-cli wrote no readable JSON result: {e}") from e
        return parse(doc, options)


def parse(doc: dict, options: TranscribeOptions) -> Transcript:
    """A Transcript from whisper-cli's `-oj` JSON (offsets in ms, text with a leading space)."""
    items = doc.get("transcription") or []
    segments = tuple(
        Segment(item["offsets"]["from"] / 1000, item["offsets"]["to"] / 1000, item["text"].strip()) for item in items
    )
    text = "".join(item["text"] for item in items).strip()
    language = (doc.get("result") or {}).get("language") or None
    return Transcript(text, segments, language, WhisperCppEngine.name, options.model)


registry.register_engine(WhisperCppEngine.name, WhisperCppEngine)
