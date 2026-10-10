import pytest

from jdf_stt import mic


@pytest.fixture
def setup(fake_bin, fake_model, tmp_path, monkeypatch):
    """Fakes on PATH, a config that turns VAD off (no VAD model in the temp models dir)."""
    (tmp_path / "jdf-stt-config.toml").write_text("[transcribe]\nvad = false\n", encoding="utf-8")
    monkeypatch.setenv("FAKE_WHISPER_TEXT", "Hello from the fake whisper.")
    audio = tmp_path / "talk.m4a"
    audio.write_bytes(b"m4a")
    return fake_bin, fake_model, audio


def test_one_file_prints_the_text(cli, setup):
    fake_bin, model, audio = setup
    result = cli(audio, "-m", model)
    assert (result.code, result.out) == (0, "Hello from the fake whisper.\n")
    assert len(fake_bin.calls("ffmpeg")) == 1 and len(fake_bin.calls("whisper-cli")) == 1


def test_explicit_transcribe_command_and_long_options(cli, setup):
    _, model, audio = setup
    result = cli("transcribe", "--model", model, "--engine", "whisper-cpp", "--threads", "2", audio)
    assert result.out == "Hello from the fake whisper.\n"


def test_threads_reach_whisper(cli, setup):
    fake_bin, model, audio = setup
    cli(audio, "-m", model, "-t", "3")
    argv = fake_bin.calls("whisper-cli")[0]
    assert argv[argv.index("-t") + 1] == "3"


def test_output_dir_writes_a_txt(cli, setup, tmp_path):
    _, model, audio = setup
    out = tmp_path / "out"
    result = cli(audio, "-m", model, "-o", out)
    assert result.code == 0 and result.out == ""
    assert (out / "talk.txt").read_text(encoding="utf-8") == "Hello from the fake whisper.\n"
    assert str(out / "talk.txt") in result.err


def test_several_files_are_written_next_to_each_input(cli, setup, tmp_path):
    _, model, audio = setup
    other_dir = tmp_path / "more"
    other_dir.mkdir()
    second = other_dir / "memo.wav"
    second.write_bytes(b"wav?")
    result = cli(audio, second, "-m", model)
    assert result.code == 0 and result.out == ""
    assert (tmp_path / "talk.txt").is_file()
    assert (other_dir / "memo.txt").is_file()


def test_a_bad_file_does_not_stop_the_others(cli, setup, tmp_path):
    _, model, audio = setup
    result = cli(tmp_path / "missing.mp3", audio, "-m", model)
    assert result.code == 1
    assert "missing.mp3" in result.err and "no such file" in result.err
    assert (tmp_path / "talk.txt").is_file()


def test_one_missing_file(cli, setup, tmp_path):
    _, model, _ = setup
    result = cli(tmp_path / "missing.mp3", "-m", model)
    assert result.code == 1 and result.out == ""
    assert "no such file" in result.err


def test_no_input_is_a_usage_error(cli, setup):
    result = cli("transcribe")
    assert result.code == 1 and "no input" in result.err


def test_missing_default_model_tells_how_to_get_it(cli, setup):
    _, _, audio = setup
    result = cli(audio)
    assert result.code == 1
    assert "jdf-stt models download small" in result.err


def test_engine_choice_goes_through_the_slot(cli, setup, fake_engine):
    fake_bin, model, audio = setup
    result = cli(audio, "--engine", "fake")
    assert result.out == "hello world\n"
    assert fake_bin.calls("whisper-cli") == []


def test_unknown_engine(cli, setup):
    _, _, audio = setup
    result = cli(audio, "--engine", "nope")
    assert result.code == 1 and "unknown engine 'nope'" in result.err


def test_mic_recording_is_transcribed_and_deleted(cli, setup, tmp_path, monkeypatch):
    fake_bin, model, _ = setup
    recording = tmp_path / "rec" / "mic.wav"
    recording.parent.mkdir()
    recording.write_bytes(b"wav")
    seen = []

    def record(options):
        seen.append(options)
        return recording

    monkeypatch.setattr(mic, "record", record)
    result = cli("--mic", "-m", model)
    assert result.out == "Hello from the fake whisper.\n"
    assert seen and seen[0].mic
    assert not recording.exists()


def test_mic_recording_kept_when_asked(cli, setup, tmp_path, monkeypatch):
    _, model, _ = setup
    keep = tmp_path / "kept.wav"

    def record(options):  # record() writes straight to --keep-audio
        keep.write_bytes(b"wav")
        return keep

    monkeypatch.setattr(mic, "record", record)
    result = cli("--mic", "--keep-audio", keep, "-m", model)
    assert result.code == 0
    assert keep.read_bytes() == b"wav"


def test_srt_and_json_into_a_folder_with_the_language_on_stderr(cli, setup, tmp_path, monkeypatch):
    _, model, audio = setup
    monkeypatch.setenv("FAKE_WHISPER_LANG", "pt")
    out = tmp_path / "subs"
    result = cli(audio, "-m", model, "-f", "srt", "-f", "json", "-o", out)
    assert result.code == 0 and result.out == ""
    assert "language: pt" in result.err.splitlines()
    assert (out / "talk.srt").read_text(encoding="utf-8").startswith("1\n00:00:00,000 --> ")
    assert '"language": "pt"' in (out / "talk.json").read_text(encoding="utf-8")


def test_quiet_keeps_stderr_empty(cli, setup):
    _, model, audio = setup
    result = cli(audio, "-m", model, "--quiet")
    assert (result.code, result.out, result.err) == (0, "Hello from the fake whisper.\n", "")


def test_a_language_from_config_reaches_whisper_as_a_code(cli, setup, tmp_path):
    fake_bin, model, audio = setup
    (tmp_path / "jdf-stt-config.toml").write_text('[transcribe]\nvad = false\nlanguage = "PT-br"\n', encoding="utf-8")
    cli(audio, "-m", model)
    argv = fake_bin.calls("whisper-cli")[0]
    assert argv[argv.index("-l") + 1] == "pt"
