"""Shared test setup for jdf-stt.

- Socket guard (autouse): no test opens a network connection. Tests marked `localhost`
  may connect to 127.0.0.1 / ::1 / localhost only (fake servers bind 127.0.0.1, port 0).
- Isolation (autouse): config.toml and the models directory point into tmp_path, so tests
  never read the user's files (tests marked `real` keep the real models directory).
- `fake_bin`: the fake executables in tests/fakes first on PATH, with a call log.
- Markers: `real` runs only with JDF_STT_REAL=1 and whisper-cli, ffmpeg and the model present
  (model: $JDF_STT_REAL_MODEL, default the local large-v3-turbo); `ffmpeg` needs the real ffmpeg.
- `say_wav(text, voice=None)`: speech from macOS `say` as a 16 kHz mono wav (skips without `say`).
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import shutil
import socket
import subprocess
import sys
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from jdf_stt import registry
from jdf_stt.cli import main
from jdf_stt.types import Segment, TranscribeOptions, Transcript

FAKES_DIR = Path(__file__).parent / "fakes"
DEFAULT_REAL_MODEL = "/Users/joao/.cache/huggingface/whisper-cpp/ggml-large-v3-turbo.bin"
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def real_model_path() -> Path:
    return Path(os.environ.get("JDF_STT_REAL_MODEL", DEFAULT_REAL_MODEL)).expanduser()


def _real_skip_reason() -> str | None:
    if os.environ.get("JDF_STT_REAL") != "1":
        return "real run: set JDF_STT_REAL=1"
    for tool in ("whisper-cli", "ffmpeg"):
        if shutil.which(tool) is None:
            return f"real run: {tool} not on PATH"
    if not real_model_path().is_file():
        return f"real run: model not found at {real_model_path()} (set JDF_STT_REAL_MODEL)"
    return None


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    real_reason = _real_skip_reason()
    no_ffmpeg = shutil.which("ffmpeg") is None
    for item in items:
        if real_reason and item.get_closest_marker("real"):
            item.add_marker(pytest.mark.skip(reason=real_reason))
        if no_ffmpeg and item.get_closest_marker("ffmpeg"):
            item.add_marker(pytest.mark.skip(reason="ffmpeg not on PATH"))


# Socket guard ------------------------------------------------------------------

_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex
_real_create_connection = socket.create_connection


@pytest.fixture(autouse=True)
def socket_guard(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Block every outgoing connection; `localhost`-marked tests may reach loopback only.

    Unix-domain sockets (a path, not a host) are not network traffic and stay allowed.
    """
    allow_loopback = request.node.get_closest_marker("localhost") is not None

    def check(address: object) -> None:
        if not isinstance(address, tuple):
            return
        if allow_loopback and address[0] in LOOPBACK:
            return
        raise OSError(f"network disabled in tests (tried {address!r})")

    def connect(self: socket.socket, address: object) -> None:
        check(address)
        return _real_connect(self, address)

    def connect_ex(self: socket.socket, address: object) -> int:
        check(address)
        return _real_connect_ex(self, address)

    def create_connection(address: tuple, *args: object, **kwargs: object) -> socket.socket:
        check(address)  # before the real one resolves the name: no DNS either
        return _real_create_connection(address, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    monkeypatch.setattr(socket, "create_connection", create_connection)


# Isolation ---------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolate_user_files(request: pytest.FixtureRequest, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JDF_STT_CONFIG", str(tmp_path / "jdf-stt-config.toml"))
    monkeypatch.delenv("JDF_STT_MODEL_BASE_URL", raising=False)
    if request.node.get_closest_marker("real") is None:
        monkeypatch.setenv("JDF_STT_MODELS_DIR", str(tmp_path / "jdf-stt-models"))


@pytest.fixture
def add_module(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Callable[[str, str, str], None]]:
    """`add_module("jdf_stt.features", "zz_demo", source)`: a module that discovery will find.

    Use it with `clean_registry`; the module is forgotten after the test.
    """
    added: list[str] = []

    def add(package_name: str, module_name: str, source: str) -> None:
        package = importlib.import_module(package_name)
        extra = tmp_path / f"extra-{package_name}"
        extra.mkdir(exist_ok=True)
        (extra / f"{module_name}.py").write_text(source, encoding="utf-8")
        monkeypatch.setattr(package, "__path__", [*package.__path__, str(extra)])
        added.append(f"{package_name}.{module_name}")

    yield add
    for name in added:
        sys.modules.pop(name, None)


@pytest.fixture
def clean_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Registrations made during the test are forgotten afterwards."""
    for name in ("_engines", "_commands"):
        monkeypatch.setattr(registry, name, dict(getattr(registry, name)))
    for name in ("_option_groups", "_postprocessors", "_option_checks"):
        monkeypatch.setattr(registry, name, list(getattr(registry, name)))


# Fakes -------------------------------------------------------------------------


@dataclass
class FakeBin:
    dir: Path
    log: Path

    def calls(self, tool: str | None = None) -> list[list[str]]:
        """argv (without the program name) of every call so far, optionally for one tool."""
        if not self.log.exists():
            return []
        entries = [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]
        return [e["argv"] for e in entries if tool is None or e["tool"] == tool]


@pytest.fixture
def fake_bin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FakeBin:
    """tests/fakes first on PATH; each call logged to $JDF_STT_FAKE_LOG (see fakes/_common.py)."""
    log = tmp_path / "fake-calls.jsonl"
    monkeypatch.setenv("PATH", f"{FAKES_DIR}{os.pathsep}{os.environ.get('PATH', '')}")
    monkeypatch.setenv("JDF_STT_FAKE_LOG", str(log))
    return FakeBin(FAKES_DIR, log)


@pytest.fixture
def fake_model(tmp_path: Path) -> Path:
    """A placeholder model file (the fake whisper-cli only checks that it exists)."""
    path = tmp_path / "ggml-fake.bin"
    path.write_bytes(b"fake model")
    return path


@dataclass
class FakeEngine:
    """An in-process engine named "fake". `calls` records (audio_path, options) per run."""

    name: str = "fake"
    text: str = "hello world"
    detected_language: str = "en"
    calls: list[tuple[Path, TranscribeOptions]] = field(default_factory=list)
    respond: Callable[[Path, TranscribeOptions], Transcript] | None = None

    def transcribe(self, audio_path: Path, options: TranscribeOptions) -> Transcript:
        self.calls.append((audio_path, options))
        if self.respond is not None:
            return self.respond(audio_path, options)
        language = self.detected_language if options.language == "auto" else options.language
        return Transcript(self.text, (Segment(0.0, 1.0, self.text),), language, self.name, options.model)


@pytest.fixture
def fake_engine(clean_registry: None) -> FakeEngine:
    engine = FakeEngine()
    registry.register_engine("fake", lambda: engine)
    return engine


@dataclass
class CliResult:
    code: int
    out: str
    err: str


@pytest.fixture
def cli(capsys: pytest.CaptureFixture[str]) -> Callable[..., CliResult]:
    """Run `jdf-stt ARGS...` in process: `cli("--version").out`."""

    def run(*args: str) -> CliResult:
        try:
            code = main([str(a) for a in args])
        except SystemExit as e:  # argparse: --help, --version, usage errors
            code = e.code if isinstance(e.code, int) else 1
        out, err = capsys.readouterr()
        return CliResult(code, out, err)

    return run


# Real runs ---------------------------------------------------------------------


@pytest.fixture(scope="session")
def real_model() -> Path:
    return real_model_path()


@pytest.fixture(scope="session")
def say_wav(tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Path]:
    """`say_wav(text, voice=None)` -> a cached 16 kHz mono wav of macOS `say` speaking `text`."""
    # Resolved now, before any test puts the fakes on PATH.
    say, ffmpeg = shutil.which("say"), shutil.which("ffmpeg")
    root = tmp_path_factory.mktemp("say")
    cache: dict[tuple[str, str | None], Path] = {}

    def make(text: str, voice: str | None = None) -> Path:
        if say is None:
            pytest.skip("macOS `say` is not available")
        if ffmpeg is None:
            pytest.skip("ffmpeg is not available")
        key = (text, voice)
        if key not in cache:
            stem = hashlib.sha256(repr(key).encode()).hexdigest()[:16]
            aiff, wav = root / f"{stem}.aiff", root / f"{stem}.wav"
            spoken = subprocess.run(
                [say, "-o", str(aiff), *(["-v", voice] if voice else []), text],
                capture_output=True,
                text=True,
                check=False,
            )
            if spoken.returncode != 0:
                pytest.skip(f"say failed (voice {voice!r}): {spoken.stderr.strip()}")
            subprocess.run(
                [ffmpeg, "-nostdin", "-y", "-loglevel", "error", "-i", str(aiff)]
                + ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)],
                check=True,
            )
            aiff.unlink()
            cache[key] = wav
        return cache[key]

    return make
