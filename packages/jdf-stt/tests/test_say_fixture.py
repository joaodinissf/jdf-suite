import wave

import pytest


@pytest.mark.ffmpeg
def test_say_wav_is_16k_mono_and_cached(say_wav):
    path = say_wav("Testing one two three.")
    with wave.open(str(path)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)
        assert w.getnframes() > 16000 // 2  # at least half a second of speech
    assert say_wav("Testing one two three.") == path
