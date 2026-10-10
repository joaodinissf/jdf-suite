"""Real runs: silence and quiet noise give no text."""

import pytest
from _whisper import lavfi_wav, transcribe, vad_model_path

from jdf_stt import registry
from jdf_stt.types import TranscribeOptions

pytestmark = pytest.mark.real

SOURCES = {
    "silence": "anullsrc=r=16000:cl=mono",
    "noise": "anoisesrc=r=16000:a=0.003:c=pink:s=7",
}


def has_vad_model():
    return vad_model_path(TranscribeOptions()).is_file()


# Whisper alone turns 5 s of digital silence into "Thank you." (seen 2026-10-10 with large-v3-turbo,
# -nth 0.6 -sns): that is why VAD is on by default. Quiet noise is already caught without VAD.
WITHOUT_VAD = [
    pytest.param("silence", marks=pytest.mark.xfail(reason="whisper hallucinates on silence without VAD")),
    "noise",
]


@pytest.mark.parametrize("name", WITHOUT_VAD)
def test_silence_and_noise_without_vad_give_no_text(name, real_model, tmp_path):
    wav = lavfi_wav(tmp_path, name, SOURCES[name])
    raw, t = transcribe(real_model, wav, tmp_path, TranscribeOptions(vad=False))
    print(f"{name}: whisper said {raw.text!r}")
    assert t.text == ""
    assert t.segments == ()


@pytest.mark.parametrize("name", SOURCES)
def test_silence_and_noise_with_vad_give_no_text(name, real_model, tmp_path):
    if not has_vad_model():
        pytest.skip("Silero VAD model not downloaded (jdf-stt models download silero-v6.2.0)")
    wav = lavfi_wav(tmp_path, name, SOURCES[name])
    _, t = transcribe(real_model, wav, tmp_path, TranscribeOptions())
    assert t.text == ""


def test_jdf_stt_prints_nothing_for_silence(real_model, tmp_path, cli):
    if "whisper-cpp" not in registry.engine_names():
        pytest.skip("the whisper-cpp engine (PR 02) is not on this branch")
    wav = lavfi_wav(tmp_path, "silence", SOURCES["silence"])
    vad = [] if has_vad_model() else ["--no-vad"]  # never download from a test
    result = cli(wav, "-m", real_model, *vad)
    assert (result.code, result.out) == (0, "")
    assert "no speech" in result.err
