"""Shared code for the fake executables in this directory.

The fakes stand in for the real programs in unit tests (the `fake_bin` fixture puts this
directory first on PATH). They run under whatever `python3` is on PATH, so they use the
stdlib only and keep Python 3.8 syntax.

Every fake appends one JSON line per call to `$JDF_STT_FAKE_LOG` (when set):
    {"tool": "whisper-cli", "argv": [...arguments after the program name...]}

Behaviour, set with environment variables:

whisper-cli
    FAKE_WHISPER_TEXT      transcript text (default "Hello from the fake whisper.")
    FAKE_WHISPER_LANG      detected language when -l is auto or absent (default "en");
                           with `-l xx` the fake reports xx, like the real one
    FAKE_WHISPER_SEGMENTS  JSON list of [from_ms, to_ms, text]; overrides FAKE_WHISPER_TEXT
                           (an empty list means no speech)
    FAKE_WHISPER_EXIT      exit with this code after printing FAKE_WHISPER_STDERR (no output file)
    FAKE_WHISPER_STDERR    stderr text for FAKE_WHISPER_EXIT (default "fake whisper-cli failure")
    Real-like checks: `-m` must name an existing file (else exit 3), `-f` must exist (else exit 2),
    `--vad` needs `-vm` naming an existing file (else exit 3). `--help` prints usage, exit 0
    (whisper-cli 1.9.4 exits 0 on --help). `-oj`/`-ojf` writes `<-of>.json` in the real shape
    (`result.language`, `transcription[].offsets.from/to` in ms, text with a leading space);
    `-otxt`/`-osrt`/`-ovtt` write `<-of>.<ext>`. Segments are printed on stdout like the real one.

ffmpeg
    FAKE_FFMPEG_SECONDS    length of the 16 kHz mono silent wav written to the last argument (default 1.0)
    FAKE_FFMPEG_EXIT       exit with this code after printing FAKE_FFMPEG_STDERR (no output file)
    FAKE_FFMPEG_STDERR     stderr text for FAKE_FFMPEG_EXIT (default "fake ffmpeg failure")
    A plain-file `-i` input (one without a preceding `-f FORMAT`) must exist, else exit 1 with
    "<path>: No such file or directory". `-version` prints a version line.
"""

from __future__ import annotations

import json
import os
import sys
import wave


def log_call(tool: str) -> None:
    path = os.environ.get("JDF_STT_FAKE_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"tool": tool, "argv": sys.argv[1:]}) + "\n")


def fail_if_asked(prefix: str, default_message: str) -> None:
    """Exit with `$<PREFIX>_EXIT` (and `$<PREFIX>_STDERR`) when it is set to a non-zero code."""
    code = int(os.environ.get(prefix + "_EXIT", "0") or 0)
    if code:
        sys.stderr.write(os.environ.get(prefix + "_STDERR", default_message) + "\n")
        sys.exit(code)


def flag_value(argv, *names, default=None):
    """The value after the last occurrence of any of `names` in `argv`."""
    value = default
    for i, arg in enumerate(argv[:-1]):
        if arg in names:
            value = argv[i + 1]
    return value


def write_wav(path: str, seconds: float, rate: int = 16000) -> None:
    """A silent 16-bit mono wav."""
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
