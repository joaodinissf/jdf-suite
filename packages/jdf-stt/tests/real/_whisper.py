"""Run the real whisper-cpp engine on a file, then this package's postprocessors."""

from __future__ import annotations

import dataclasses
import shutil
import subprocess
from pathlib import Path

from jdf_stt import config, models, pipeline, registry
from jdf_stt.engines.whisper_cpp import WhisperCppEngine
from jdf_stt.types import TranscribeOptions, Transcript

FFMPEG = shutil.which("ffmpeg")


def vad_model_path(o: TranscribeOptions) -> Path:
    info = models.MODELS.get(o.vad_model)
    return config.models_dir() / info.file if info else Path(o.vad_model)


def transcribe(model: Path, wav: Path, tmp: Path, o: TranscribeOptions) -> tuple[Transcript, Transcript]:
    """(raw engine transcript, postprocessed transcript). `wav` must already be 16 kHz mono."""
    raw = WhisperCppEngine().transcribe(wav, dataclasses.replace(o, model=str(model)))
    registry.load_features()
    return raw, pipeline.postprocess(raw, o)


def lavfi_wav(tmp: Path, name: str, source: str, seconds: float = 5.0) -> Path:
    wav = tmp / f"{name}.wav"
    subprocess.run(
        [FFMPEG, "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", source, "-t", str(seconds)]
        + ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)],
        check=True,
    )
    return wav
