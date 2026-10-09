"""`jdf-stt watch`: new audio in a folder -> transcripts next to it (fake engine, no real tools)."""

import shutil
from pathlib import Path

import pytest

from jdf_stt import audio, registry
from jdf_stt.features import watch
from jdf_stt.types import SttError, TranscribeOptions


@pytest.fixture
def setup(fake_engine, monkeypatch, tmp_path):
    """The fake engine via config.toml; audio preparation copies the file (no ffmpeg)."""
    (tmp_path / "jdf-stt-config.toml").write_text('[transcribe]\nengine = "fake"\n', encoding="utf-8")

    def prepare(src: Path, workdir: Path) -> Path:
        if not src.exists():
            raise SttError(f"{src}: no such file")
        out = workdir / src.name  # keeps the name, so tests can tell which file ran
        shutil.copyfile(src, out)
        return out

    monkeypatch.setattr(audio, "prepare", prepare)
    monkeypatch.setattr(audio, "duration", lambda wav: 1.0)
    folder = tmp_path / "inbox"
    folder.mkdir()
    return folder


def heard(fake_engine) -> list[str]:
    """Names of the source files the engine ran on (the prepared copy keeps the name)."""
    return [p.name for p, _ in fake_engine.calls]


def test_once_transcribes_new_audio_next_to_it(cli, setup, fake_engine):
    (setup / "talk.m4a").write_text("talk")
    (setup / "notes.md").write_text("not audio")
    result = cli("watch", setup, "--once", "--interval", "0")
    assert result.code == 0, result.err
    assert (setup / "talk.txt").read_text() == "hello world\n"
    assert not (setup / "notes.txt").exists()
    assert heard(fake_engine) == ["talk.m4a"]
    assert "talk.m4a" in result.err


def test_rerun_skips_files_already_done(cli, setup, fake_engine):
    (setup / "a.wav").write_text("a")
    assert cli("watch", setup, "--once", "--interval", "0").code == 0
    assert cli("watch", setup, "--once", "--interval", "0").code == 0
    assert heard(fake_engine) == ["a.wav"]


def test_every_known_extension_counts_case_insensitively(tmp_path):
    for name in ("a.wav", "b.MP3", "c.m4a", "d.flac", "e.ogg", "f.aiff", "g.mp4", "h.MOV", "i.txt", ".hidden.wav"):
        (tmp_path / name).write_text("x")
    found = {p.name for p in watch.scan([tmp_path], recursive=False)}
    assert found == {"a.wav", "b.MP3", "c.m4a", "d.flac", "e.ogg", "f.aiff", "g.mp4", "h.MOV"}


def test_recursive_looks_in_subfolders(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "deep.wav").write_text("x")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "skip.wav").write_text("x")
    assert watch.scan([tmp_path], recursive=False) == []
    assert [p.name for p in watch.scan([tmp_path], recursive=True)] == ["deep.wav"]


def test_done_only_when_every_requested_output_exists(tmp_path):
    src = tmp_path / "a.wav"
    src.write_text("x")
    (tmp_path / "a.txt").write_text("done")
    assert watch.is_done(src, TranscribeOptions(formats=("txt",)))
    assert not watch.is_done(src, TranscribeOptions(formats=("txt", "srt")))
    (tmp_path / "a.srt").write_text("done")
    assert watch.is_done(src, TranscribeOptions(formats=("txt", "srt")))


def test_half_written_file_waits_until_its_size_settles(setup, fake_engine):
    growing = setup / "growing.wav"
    growing.write_text("part")
    w = watch.Watcher([setup], TranscribeOptions(engine="fake"), recursive=False)
    assert w.poll() == 0  # first sight: size noted, nothing transcribed
    with growing.open("a") as f:
        f.write(" more")
    assert w.poll() == 0  # still growing
    assert not (setup / "growing.txt").exists()
    assert w.poll() == 1  # unchanged across two polls: done writing
    assert heard(fake_engine) == ["growing.wav"]
    assert (setup / "growing.txt").exists()
    assert w.poll() == 0


def test_empty_file_waits(setup, fake_engine):
    (setup / "empty.wav").write_bytes(b"")
    w = watch.Watcher([setup], TranscribeOptions(engine="fake"), recursive=False)
    assert (w.poll(), w.poll()) == (0, 0)
    assert fake_engine.calls == []


def test_a_bad_file_is_reported_and_the_rest_still_run(cli, setup, fake_engine, capsys):
    def respond(path, options):
        if path.read_text() == "bad":
            raise SttError("ffmpeg could not read it")
        return type(fake_engine)().transcribe(path, options)

    fake_engine.respond = respond
    (setup / "a_bad.wav").write_text("bad")
    (setup / "b_good.wav").write_text("good")
    result = cli("watch", setup, "--once", "--interval", "0")
    assert result.code == 1
    assert "a_bad.wav" in result.err and "ffmpeg could not read it" in result.err
    assert (setup / "b_good.txt").exists()
    assert not (setup / "a_bad.txt").exists()


def test_a_failed_file_is_not_retried_until_it_changes(setup, fake_engine, capsys):
    fake_engine.respond = lambda path, options: (_ for _ in ()).throw(SttError("broken"))
    bad = setup / "bad.wav"
    bad.write_text("bad")
    w = watch.Watcher([setup], TranscribeOptions(engine="fake"), recursive=False)
    for _ in range(4):
        w.poll()
    assert len(fake_engine.calls) == 1
    bad.write_text("bad, fixed")
    w.poll()
    w.poll()
    assert len(fake_engine.calls) == 2


def test_missing_folder_is_a_clear_error(cli, setup):
    result = cli("watch", setup / "nope", "--once", "--interval", "0")
    assert result.code == 1 and "not a folder" in result.err


def test_watch_loops_until_interrupted(setup, fake_engine, monkeypatch, cli):
    (setup / "a.wav").write_text("a")
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 3:
            raise KeyboardInterrupt

    monkeypatch.setattr(watch.time, "sleep", sleep)
    result = cli("watch", setup, "--interval", "5")
    assert result.code == 0
    assert sleeps == [5.0, 5.0, 5.0]
    assert heard(fake_engine) == ["a.wav"]
    assert "stopped" in result.err


def test_help_lists_watch(cli):
    assert "watch" in cli("--help").out
    help_text = cli("watch", "--help").out
    for flag in ("--once", "--interval", "--recursive", "--model", "--engine"):
        assert flag in help_text


def test_model_and_engine_reach_the_engine(cli, setup, fake_engine):
    (setup / "a.wav").write_text("a")
    assert cli("watch", setup, "--once", "--interval", "0", "-m", "/models/x.bin", "--engine", "fake").code == 0
    assert fake_engine.calls[0][1].model == "/models/x.bin"


def test_acceptance_txt_and_srt_next_to_the_audio(cli, setup, fake_engine):
    """`jdf-stt watch DIR --once -f txt -f srt`."""
    (setup / "a.wav").write_text("a")
    result = cli("watch", setup, "--once", "--interval", "0", "-f", "txt", "-f", "srt")
    assert result.code == 0, result.err
    assert (setup / "a.txt").read_text() == "hello world\n"
    assert "-->" in (setup / "a.srt").read_text()


def test_registered_as_a_command():
    registry.load_features()
    assert "watch" in registry.commands()


def test_an_unexpected_error_on_one_file_does_not_end_the_watch(cli, setup, fake_engine):
    def respond(path, options):
        if path.read_text() == "bad":
            raise ValueError("engine output was not JSON")
        return type(fake_engine)().transcribe(path, options)

    fake_engine.respond = respond
    (setup / "a_bad.wav").write_text("bad")
    (setup / "b_good.wav").write_text("good")
    result = cli("watch", setup, "--once", "--interval", "0")
    assert result.code == 1
    assert "a_bad.wav: ValueError: engine output was not JSON" in result.err
    assert (setup / "b_good.txt").exists()


def test_an_output_folder_set_in_config_gets_the_results(cli, setup, fake_engine):
    out = setup.parent / "out"
    config = f'[transcribe]\nengine = "fake"\noutput_dir = "{out}"\n'
    (setup.parent / "jdf-stt-config.toml").write_text(config, encoding="utf-8")
    (setup / "talk.wav").write_text("hello")
    assert cli("watch", setup, "--once", "--interval", "0").code == 0
    assert (out / "talk.txt").exists()
    assert not (setup / "talk.txt").exists()
    assert cli("watch", setup, "--once", "--interval", "0").code == 0
    assert len(fake_engine.calls) == 1  # the second run sees it done in the output folder
