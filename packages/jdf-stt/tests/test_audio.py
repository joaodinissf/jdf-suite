import shutil
import subprocess
import wave

import pytest

from jdf_stt import audio
from jdf_stt.types import SttError, ToolMissing


def make_wav(path, rate=16000, channels=1, width=2, seconds=0.5):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * width * channels * int(rate * seconds))
    return path


def test_non_wav_is_converted_with_ffmpeg(fake_bin, tmp_path):
    src = tmp_path / "talk.m4a"
    src.write_bytes(b"not really m4a")
    work = tmp_path / "work"
    work.mkdir()
    out = audio.prepare(src, work)
    assert out == work / "audio.wav"
    assert out.is_file()
    (argv,) = fake_bin.calls("ffmpeg")
    assert argv == ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src)] + [
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(out),
    ]


def test_a_44k_stereo_wav_is_converted_too(fake_bin, tmp_path):
    src = make_wav(tmp_path / "cd.wav", rate=44100, channels=2)
    assert audio.prepare(src, tmp_path) == tmp_path / "audio.wav"
    assert len(fake_bin.calls("ffmpeg")) == 1


def test_a_ready_16k_mono_wav_skips_ffmpeg(fake_bin, tmp_path):
    src = make_wav(tmp_path / "ready.wav")
    assert audio.prepare(src, tmp_path / "unused") == src
    assert fake_bin.calls("ffmpeg") == []


def test_missing_input(fake_bin, tmp_path):
    with pytest.raises(SttError, match="no such file"):
        audio.prepare(tmp_path / "nope.mp3", tmp_path)
    assert fake_bin.calls() == []


def test_ffmpeg_failure_is_reported(fake_bin, tmp_path, monkeypatch):
    src = tmp_path / "bad.mp3"
    src.write_bytes(b"x")
    monkeypatch.setenv("FAKE_FFMPEG_EXIT", "1")
    monkeypatch.setenv("FAKE_FFMPEG_STDERR", "Invalid data found when processing input")
    with pytest.raises(SttError, match="Invalid data found"):
        audio.prepare(src, tmp_path)


def test_ffmpeg_missing(tmp_path, monkeypatch):
    src = tmp_path / "a.mp3"
    src.write_bytes(b"x")
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    with pytest.raises(ToolMissing, match="brew install ffmpeg"):
        audio.prepare(src, tmp_path)


def test_duration(tmp_path):
    assert audio.duration(make_wav(tmp_path / "a.wav", seconds=1.25)) == pytest.approx(1.25)
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"nope")
    assert audio.duration(junk) is None


@pytest.mark.ffmpeg
def test_real_ffmpeg_converts_an_mp3(tmp_path):
    src = tmp_path / "tone.mp3"
    subprocess.run(
        [shutil.which("ffmpeg"), "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i"]
        + ["sine=frequency=440:duration=1:sample_rate=44100", "-ac", "2", str(src)],
        check=True,
    )
    out = audio.prepare(src, tmp_path)
    with wave.open(str(out), "rb") as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)
    assert audio.duration(out) == pytest.approx(1.0, abs=0.1)
