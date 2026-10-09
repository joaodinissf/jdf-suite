"""Real transcription with whisper-cli and a real model (JDF_STT_REAL=1)."""

import shutil
import subprocess

import pytest

from jdf_stt import config, models, pipeline
from jdf_stt.types import TranscribeOptions

pytestmark = pytest.mark.real

SENTENCE = "The quick brown fox jumps over the lazy dog."


def words(text):
    return [w.strip(".,!?").lower() for w in text.split()]


@pytest.fixture
def no_vad_config(tmp_path):
    (tmp_path / "jdf-stt-config.toml").write_text("[transcribe]\nvad = false\n", encoding="utf-8")


def test_cli_prints_the_sentence_from_an_aiff(cli, real_model, say_wav, tmp_path, no_vad_config):
    say_wav(SENTENCE)  # skips cleanly where `say` is missing
    aiff = tmp_path / "hello.aiff"
    subprocess.run([shutil.which("say"), "-o", str(aiff), SENTENCE], check=True)
    result = cli("-m", real_model, aiff)
    assert result.code == 0, result.err
    got = words(result.out)
    for word in ("quick", "brown", "fox", "lazy", "dog"):
        assert word in got, result.out


def test_pipeline_segments_language_and_duration(real_model, say_wav):
    wav = say_wav(SENTENCE)
    t = pipeline.transcribe_file(wav, TranscribeOptions(model=str(real_model), vad=False))
    assert t.language == "en"
    assert t.segments and t.segments[0].start >= 0 and t.segments[-1].end > t.segments[0].start
    assert t.duration and t.duration > 1
    assert "fox" in words(t.text)


def test_with_the_vad_model(real_model, say_wav):
    vad = config.models_dir() / models.MODELS[models.DEFAULT_VAD].file
    if not vad.is_file():
        pytest.skip(f"VAD model not downloaded ({vad}); run `jdf-stt models download {models.DEFAULT_VAD}`")
    t = pipeline.transcribe_file(say_wav(SENTENCE), TranscribeOptions(model=str(real_model)))
    assert "dog" in words(t.text)
