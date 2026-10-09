"""`jdf-stt watch --once` on one real `say` file with the real whisper-cli and the local turbo model."""

import shutil

import pytest

pytestmark = pytest.mark.real


def test_watch_once_writes_a_real_transcript(cli, real_model, say_wav, tmp_path):
    folder = tmp_path / "inbox"
    folder.mkdir()
    shutil.copyfile(say_wav("The quick brown fox jumps over the lazy dog."), folder / "fox.wav")
    result = cli("watch", folder, "--once", "--interval", "0.5", "-m", real_model)
    assert result.code == 0, result.err
    text = (folder / "fox.txt").read_text(encoding="utf-8").lower()
    assert "fox" in text and "dog" in text
    again = cli("watch", folder, "--once", "--interval", "0", "-m", real_model)
    assert again.code == 0 and "fox.wav" not in again.err  # already done: skipped
