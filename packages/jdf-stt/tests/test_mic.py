"""`jdf-stt --mic`: the ffmpeg recorder and its stop protocol.

The real microphone is never opened: the default avfoundation input is only checked as a
command (and run through the fake ffmpeg); every recording test uses an ffmpeg lavfi test
source through `mic_input`, read in real time with `-re`.
"""

from __future__ import annotations

import fcntl
import json
import os
import select
import shutil
import signal
import subprocess
import sys
import termios
import threading
import time
import wave
from pathlib import Path

import pytest

from jdf_stt import mic, registry
from jdf_stt.cli import build_parser
from jdf_stt.types import Cancelled, SttError, TranscribeOptions

TONE = ("-re", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000")
# Half a second of tone, then silence for ever.
TONE_THEN_SILENCE = ("-re", "-f", "lavfi", "-i", r"aevalsrc=if(lt(t\,0.5)\,0.1*sin(2*PI*440*t)\,0):s=48000")


def wav_info(path: Path) -> tuple[int, int, float]:
    with wave.open(str(path)) as w:
        return w.getframerate(), w.getnchannels(), w.getnframes() / w.getframerate()


# The command --------------------------------------------------------------------


def test_default_input_is_the_avfoundation_microphone(tmp_path):
    cmd = mic.ffmpeg_command(TranscribeOptions(mic=True), tmp_path / "out.wav", ffmpeg="ffmpeg")
    assert cmd[:4] == ["ffmpeg", "-hide_banner", "-loglevel", "info"]
    assert cmd[cmd.index("-f") : cmd.index("-f") + 4] == ["-f", "avfoundation", "-i", ":default"]
    assert cmd[-5:] == ["-ar", "16000", "-ac", "1", str(tmp_path / "out.wav")]
    assert "-nostdin" not in cmd  # `q` on stdin is the clean stop
    assert "-af" not in cmd


def test_mic_input_replaces_the_default_and_until_silence_adds_silencedetect(tmp_path):
    options = TranscribeOptions(mic=True, mic_input=TONE, until_silence=True, silence_seconds=0.8)
    cmd = mic.ffmpeg_command(options, tmp_path / "out.wav", ffmpeg="ffmpeg")
    assert "avfoundation" not in cmd
    start = cmd.index("-re")
    assert tuple(cmd[start : start + len(TONE)]) == TONE
    assert cmd[cmd.index("-af") + 1] == "silencedetect=noise=-35dB:d=0.8"
    assert cmd.index("-af") > start + len(TONE) - 1


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("[Parsed_silencedetect_0 @ 0x7] silence_start: 0.999937", 0.999937),
        ("[Parsed_silencedetect_0 @ 0x7] silence_start: 0", 0.0),
        ("[Parsed_silencedetect_0 @ 0x7] silence_start: -0.0125", -0.0125),
        ("[Parsed_silencedetect_0 @ 0x7] silence_end: 3.02 | silence_duration: 2.0", None),
        ("size=      95KiB time=00:00:03.02", None),
    ],
)
def test_silence_start_parsing(line, expected):
    assert mic.silence_start(line) == expected


class _FakeProc:
    def __init__(self, lines: list[str]) -> None:
        self.stderr = [f"[Parsed_silencedetect_0 @ 0x7] {line}\n".encode() for line in lines]


@pytest.mark.parametrize(
    ("lines", "stops"),
    [
        (["silence_start: 0"], False),
        (["silence_start: 0.02"], False),  # a real mic's first frame, a little after 0
        (["silence_start: 0.02", "silence_end: 2.1 | silence_duration: 2.08"], False),
        (["silence_start: 0.02", "silence_end: 2.1 | silence_duration: 2.08", "silence_start: 3.4"], True),
        (["silence_start: 0.6"], True),  # sound first, then the pause
    ],
)
def test_a_pause_counts_only_after_sound(lines, stops):
    watcher = mic._StderrWatcher(_FakeProc(lines), until_silence=True)
    watcher.join()
    assert watcher.silence.is_set() is stops


def test_default_command_reaches_ffmpeg_unchanged_through_the_fake(fake_bin, tmp_path):
    """The fake ffmpeg writes a wav and exits by itself: no microphone is involved."""
    assert Path(shutil.which("ffmpeg")).parent == fake_bin.dir  # never the real ffmpeg here
    r, w = os.pipe()
    try:
        path = mic.record(TranscribeOptions(mic=True), stdin=r)
    finally:
        os.close(r)
        os.close(w)
    try:
        (argv,) = fake_bin.calls("ffmpeg")
        assert argv[argv.index("-f") : argv.index("-f") + 4] == ["-f", "avfoundation", "-i", ":default"]
        assert argv[-1] == str(path)
        assert wav_info(path)[:2] == (16000, 1)
    finally:
        mic.discard(path, TranscribeOptions())
    assert not path.exists()


def test_missing_ffmpeg_is_reported(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(SttError, match="ffmpeg not found"):
        mic.record(TranscribeOptions(mic=True, mic_input=TONE), stdin=0)


def test_keep_audio_needs_an_existing_folder(tmp_path):
    with pytest.raises(SttError, match="folder does not exist"):
        mic.record(TranscribeOptions(mic=True, mic_input=TONE, keep_audio=str(tmp_path / "no" / "x.wav")), stdin=0)


# Options -----------------------------------------------------------------------


def _options(*args: str) -> TranscribeOptions:
    ns = build_parser().parse_args(["transcribe", *args])
    return registry.options_from_args(ns, cfg={})


def test_mic_options_parse_into_transcribe_options():
    options = _options(
        "--mic",
        "--until-silence",
        "--silence-seconds",
        "2.5",
        "--keep-audio",
        "~/x.wav",
        "--mic-input",
        "-re -f lavfi -i sine",
    )
    assert options.mic and options.until_silence
    assert options.silence_seconds == 2.5
    assert options.keep_audio == "~/x.wav"
    assert options.mic_input == ("-re", "-f", "lavfi", "-i", "sine")


def test_mic_options_default_to_none_so_config_fills_them():
    ns = build_parser().parse_args(["transcribe"])
    for dest in ("mic", "until_silence", "silence_seconds", "keep_audio", "mic_input"):
        assert getattr(ns, dest) is None
    options = registry.options_from_args(ns, cfg={"transcribe": {"silence_seconds": 3.0}})
    assert (options.mic, options.silence_seconds) == (False, 3.0)


def test_silence_seconds_must_be_positive(cli):
    result = cli("transcribe", "--mic", "--silence-seconds", "0")
    assert result.code == 2 and "must be a positive number" in result.err


def test_mic_input_is_hidden_from_help(cli):
    out = cli("transcribe", "--help").out
    assert "--mic" in out and "--until-silence" in out and "--keep-audio" in out
    assert "--mic-input" not in out


# Recording in process, stdin a pipe (the Swift app's protocol) ---------------------


def _record_with(options: TranscribeOptions, *, after: float, data: bytes | None) -> Path:
    """Record with stdin a pipe; after `after` seconds write `data` (None: close it, EOF)."""
    r, w = os.pipe()

    def send() -> None:
        time.sleep(after)
        if data is not None:
            os.write(w, data)
        else:
            os.close(w)

    sender = threading.Thread(target=send, daemon=True)
    sender.start()
    try:
        return mic.record(options, stdin=r)
    finally:
        sender.join()
        os.close(r)
        if data is not None:
            os.close(w)


@pytest.mark.ffmpeg
def test_newline_stops_and_leaves_a_16k_mono_wav():
    options = TranscribeOptions(mic=True, mic_input=TONE)
    path = _record_with(options, after=1.5, data=b"\n")
    try:
        rate, channels, seconds = wav_info(path)
        assert (rate, channels) == (16000, 1)
        assert 0.8 < seconds < 4
    finally:
        mic.discard(path, options)
    assert not path.exists()


@pytest.mark.ffmpeg
def test_deleting_the_returned_path_leaves_nothing(tmp_path, monkeypatch):
    """A caller that unlinks the recording itself (instead of `discard()`) leaves TMPDIR clean."""
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    path = _record_with(TranscribeOptions(mic=True, mic_input=TONE), after=1.0, data=b"\n")
    path.unlink()
    assert list(tmp_path.iterdir()) == []


@pytest.mark.ffmpeg
def test_eof_cancels_and_leaves_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    with pytest.raises(Cancelled):
        _record_with(TranscribeOptions(mic=True, mic_input=TONE), after=0.8, data=None)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.ffmpeg
def test_other_bytes_without_a_newline_do_not_stop():
    options = TranscribeOptions(mic=True, mic_input=TONE, until_silence=True, silence_seconds=0.3)
    r, w = os.pipe()
    os.write(w, b"abc")  # no newline; a tone never goes silent

    def finish() -> None:
        time.sleep(1.5)
        os.write(w, b"\n")

    threading.Thread(target=finish, daemon=True).start()
    started = time.monotonic()
    try:
        path = mic.record(options, stdin=r)
    finally:
        os.close(r)
        os.close(w)
    assert time.monotonic() - started > 1.2
    mic.discard(path, options)


@pytest.mark.ffmpeg
def test_until_silence_stops_by_itself_after_the_pause():
    options = TranscribeOptions(mic=True, mic_input=TONE_THEN_SILENCE, until_silence=True, silence_seconds=0.5)
    r, w = os.pipe()  # nothing is ever written: only the pause can stop it
    started = time.monotonic()
    try:
        path = mic.record(options, stdin=r)
    finally:
        os.close(r)
        os.close(w)
    elapsed = time.monotonic() - started
    try:
        assert elapsed < 5
        assert 0.8 < wav_info(path)[2] < 3
    finally:
        mic.discard(path, options)


@pytest.mark.ffmpeg
def test_until_silence_waits_for_audio_before_counting_a_pause():
    """Silence at the very start (silence_start: 0) does not stop the recording."""
    silence_then_tone = ("-re", "-f", "lavfi", "-i", r"aevalsrc=if(lt(t\,1.2)\,0\,0.1*sin(2*PI*440*t)):s=48000")
    options = TranscribeOptions(mic=True, mic_input=silence_then_tone, until_silence=True, silence_seconds=0.4)
    path = _record_with(options, after=2.0, data=b"\n")
    try:
        assert wav_info(path)[2] > 1.6
    finally:
        mic.discard(path, options)


@pytest.mark.ffmpeg
def test_keep_audio_moves_the_recording_there(tmp_path):
    kept = tmp_path / "kept.wav"
    options = TranscribeOptions(mic=True, mic_input=TONE, keep_audio=str(kept))
    path = _record_with(options, after=1.0, data=b"\n")
    assert path == kept and kept.is_file()
    mic.discard(path, options)
    assert kept.is_file()  # kept means kept


@pytest.mark.ffmpeg
def test_a_failing_input_is_an_error_with_ffmpeg_s_words(tmp_path, monkeypatch):
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    options = TranscribeOptions(mic=True, mic_input=("-f", "lavfi", "-i", "no_such_source"))
    r, w = os.pipe()
    try:
        with pytest.raises(SttError, match=r"ffmpeg failed \(exit \d+\)") as e:
            mic.record(options, stdin=r)
    finally:
        os.close(r)
        os.close(w)
    assert "no_such_source" in str(e.value)
    assert list(tmp_path.iterdir()) == []


# Signals and the terminal, in a child process ---------------------------------------

DRIVER = """
import json, sys
from jdf_stt import mic
from jdf_stt.types import Cancelled, TranscribeOptions
options = TranscribeOptions(**json.loads(sys.argv[1]))
try:
    path = mic.record(options)
except Cancelled:
    sys.exit(130)
print("RECORDED " + str(path), flush=True)
"""


def _driver_args(**options: object) -> list[str]:
    return [sys.executable, "-c", DRIVER, json.dumps(options)]


@pytest.mark.ffmpeg
@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM])
def test_a_signal_cancels_with_exit_130_and_no_file(sig, tmp_path):
    env = os.environ | {"TMPDIR": str(tmp_path)}
    proc = subprocess.Popen(
        _driver_args(mic=True, mic_input=list(TONE)), stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env
    )
    time.sleep(1.5)
    proc.send_signal(sig)
    out, _ = proc.communicate(timeout=15)
    assert proc.returncode == 130, out
    assert list(tmp_path.iterdir()) == []


@pytest.mark.ffmpeg
def test_the_pipe_protocol_from_a_child_process(tmp_path):
    """What the Swift app does: start, write a newline, read the result."""
    proc = subprocess.run(
        _driver_args(mic=True, mic_input=list(TONE), keep_audio=str(tmp_path / "a.wav")),
        input=b"",
        stdout=subprocess.PIPE,
        timeout=15,
        check=False,
    )
    assert proc.returncode == 130  # EOF straight away: cancelled
    proc = subprocess.Popen(
        _driver_args(mic=True, mic_input=list(TONE), keep_audio=str(tmp_path / "a.wav")),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    time.sleep(1.2)
    proc.stdin.write(b"\n")
    proc.stdin.flush()
    out, _ = proc.communicate(timeout=15)
    assert proc.returncode == 0
    assert out.decode().strip() == f"RECORDED {tmp_path / 'a.wav'}"
    assert wav_info(tmp_path / "a.wav")[2] > 0.8


def _read_until(master: int, marker: bytes | None, timeout: float = 15) -> bytes:
    """Read the pty until `marker` appears (None: until the child closes it)."""
    seen = b""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and (marker is None or marker not in seen):
        ready, _, _ = select.select([master], [], [], 0.1)
        if not ready:
            continue
        try:
            chunk = os.read(master, 4096)
        except OSError:  # macOS: EIO once the child side is closed
            break
        if not chunk:
            break
        seen += chunk
    return seen


def _run_on_a_pty(keys: bytes, tmp_path: Path, **options: object) -> tuple[int, str]:
    """Run the driver with a pty as its controlling terminal; type `keys` while it records."""
    master, slave = os.openpty()

    def take_terminal() -> None:
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    env = os.environ | {"TMPDIR": str(tmp_path)}
    proc = subprocess.Popen(
        _driver_args(**options),
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
        preexec_fn=take_terminal,  # noqa: PLW1509 (test only; sets the controlling terminal)
    )
    os.close(slave)
    # Keys typed before recording starts are discarded (cbreak flushes them): wait for the prompt.
    output = _read_until(master, b"Enter stops")
    time.sleep(1.0)
    os.write(master, keys)
    output += _read_until(master, None)
    proc.wait(timeout=15)
    os.close(master)
    return proc.returncode, output.decode(errors="replace")


@pytest.mark.ffmpeg
def test_tty_enter_stops(tmp_path):
    kept = tmp_path / "kept.wav"
    code, output = _run_on_a_pty(b"\r", tmp_path, mic=True, mic_input=list(TONE), keep_audio=str(kept))
    assert code == 0, output
    assert "Enter stops" in output
    assert f"RECORDED {kept}" in output
    assert wav_info(kept)[2] > 0.8


@pytest.mark.ffmpeg
@pytest.mark.parametrize("key", [b"\x1b", b"\x03"], ids=["esc", "ctrl-c"])
def test_tty_esc_and_ctrl_c_cancel(key, tmp_path):
    code, output = _run_on_a_pty(key, tmp_path, mic=True, mic_input=list(TONE))
    assert code == 130, output
    assert "RECORDED" not in output
    assert [p.name for p in tmp_path.iterdir()] == []


@pytest.mark.ffmpeg
def test_tty_settings_are_restored(tmp_path):
    """After recording, the terminal is back in its normal (canonical, echoing) mode."""
    master, slave = os.openpty()
    before = termios.tcgetattr(slave)
    proc = subprocess.Popen(
        [sys.executable, "-c", DRIVER, json.dumps({"mic": True, "mic_input": list(TONE)})],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=os.environ | {"TMPDIR": str(tmp_path)},  # the driver leaves its recording there
    )
    _read_until(master, b"Enter stops")
    time.sleep(0.5)
    os.write(master, b"\n")
    proc.wait(timeout=15)
    after = termios.tcgetattr(slave)
    os.close(slave)
    os.close(master)
    assert proc.returncode == 0
    mode = termios.ICANON | termios.ECHO | termios.ISIG
    assert before[3] & mode == mode
    assert after[3] & mode == mode
