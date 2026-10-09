"""The fake whisper-cli matches the real one where the engine depends on it."""

import json
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.real

FAKE_WHISPER = Path(__file__).parents[1] / "fakes" / "whisper-cli"


def whisper_json(cmd, out):
    proc = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(out.with_suffix(".json").read_text(encoding="utf-8"))


def shape(doc):
    """The parts of whisper-cli's JSON the engine reads, as types."""
    return {
        "language": type(doc["result"]["language"]),
        "items": [
            (type(t["offsets"]["from"]), type(t["offsets"]["to"]), type(t["text"]), t["text"][:1])
            for t in doc["transcription"]
        ][:1],
    }


def test_fake_json_has_the_real_shape(real_model, say_wav, tmp_path, fake_model):
    wav = say_wav("The quick brown fox jumps over the lazy dog.")
    real = whisper_json(
        ["whisper-cli", "-m", real_model, "-f", wav, "-l", "auto", "-oj", "-of", tmp_path / "real", "-np"],
        tmp_path / "real",
    )
    assert real["result"]["language"] == "en"
    text = "".join(t["text"] for t in real["transcription"]).lower()
    assert "fox" in text and "dog" in text

    fake = whisper_json(
        [FAKE_WHISPER, "-m", fake_model, "-f", wav, "-l", "auto", "-oj", "-of", tmp_path / "fake", "-np"],
        tmp_path / "fake",
    )
    assert shape(fake) == shape(real)
    assert set(fake) >= {"result", "transcription"}
    assert set(fake["transcription"][0]) == set(real["transcription"][0])
