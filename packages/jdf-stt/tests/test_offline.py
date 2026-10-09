"""The offline guarantee: nothing leaves the Mac.

1. A source scan: network modules are imported only by models.py (the model download the
   user starts) and llm.py (the localhost-only LLM client), and no code shells out to a
   network tool.
2. Every CLI flow, run with the fakes under a strict recorder, attempts no connection and no
   DNS lookup at all, not even to 127.0.0.1. Attempts are recorded before they are refused,
   so code that swallowed the error would still fail here.
3. The model download is the one exception, and it reaches only the server it was given.

Flows whose feature has not landed yet (another PR in the stack) are skipped by name; on the
full stack they all run, and JDF_STT_REQUIRE_ALL_FLOWS=1 turns any such skip into a failure so
a renamed file cannot hide a flow. Not run under the recorder: --mic (it needs a microphone),
the LLM modes (they talk to localhost on purpose) and the MCP server (stdin and stdout). Real
runs under a sandbox that denies the network are in tests/real/test_real_offline.py.
"""

from __future__ import annotations

import ast
import contextlib
import hashlib
import http.server
import os
import socket
import threading
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from jdf_stt import config, models, registry

SRC = Path(__file__).parents[1] / "src" / "jdf_stt"
NETWORK_MODULES = {
    "socket",
    "ssl",
    "urllib",
    "http",
    "ftplib",
    "smtplib",
    "poplib",
    "imaplib",
    "xmlrpc",
    "socketserver",
    "telnetlib",
    "webbrowser",
}
NETWORK_SUBMODULES = {"multiprocessing.connection"}  # the rest of multiprocessing is local
# asyncio is fine for local work; these are the calls in it (and its event loops) that open sockets.
NETWORK_CALLS = {"open_connection", "start_server", "create_connection", "create_server", "create_datagram_endpoint"}
ALLOWED_NETWORK_FILES = {"models.py", "llm.py"}  # paths relative to src/jdf_stt
NETWORK_TOOLS = {"curl", "wget", "nc", "ncat", "ssh", "scp", "rsync", "ftp", "telnet"}
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


# 1. Source scan ------------------------------------------------------------------


def network_imports(path: Path) -> set[str]:
    found = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module, *(f"{node.module}.{alias.name}" for alias in node.names)]
        elif isinstance(node, ast.Attribute) and node.attr in NETWORK_CALLS:
            found.add(node.attr)
            continue
        elif (
            isinstance(node, ast.Call)
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
            and ast.unparse(node.func) in {"importlib.import_module", "import_module", "__import__"}
        ):
            names = [node.args[0].value]
        else:
            continue
        found |= {name.split(".")[0] for name in names} & NETWORK_MODULES
        found |= {name for name in names if name in NETWORK_SUBMODULES}
    return found


def source_files() -> list[Path]:
    files = sorted(SRC.rglob("*.py"))
    assert len(files) > 10, "the source tree was not found"
    return files


def test_only_models_and_llm_import_network_modules():
    offenders = {
        str(path.relative_to(SRC)): sorted(found)
        for path in source_files()
        if str(path.relative_to(SRC)) not in ALLOWED_NETWORK_FILES and (found := network_imports(path))
    }
    assert offenders == {}


def test_the_scan_catches_every_import_form(tmp_path):
    sample = tmp_path / "sample.py"
    sample.write_text(
        "import os, socket\nfrom urllib.request import urlopen\nimport http.client as hc\n"
        "importlib.import_module('ssl')\n__import__('xmlrpc.client')\nfrom . import http\n"
        "import multiprocessing\nfrom multiprocessing import connection\n"
        "import asyncio\nasyncio.open_connection('example.com', 80)\nloop.create_connection(f, 'h', 1)\n",
        encoding="utf-8",
    )
    assert network_imports(sample) == {
        "socket",
        "urllib",
        "http",
        "ssl",
        "xmlrpc",
        "multiprocessing.connection",
        "open_connection",
        "create_connection",
    }


def runs_network_tool(value: str) -> bool:
    """True for a string whose first word is a network tool, by name or path: 'curl -fsSL x', '/usr/bin/nc'."""
    words = value.split()
    return bool(words) and Path(words[0]).name in NETWORK_TOOLS


def test_the_tool_check_sees_paths_and_arguments():
    assert runs_network_tool("curl")
    assert runs_network_tool("curl -fsSL https://example.com")
    assert runs_network_tool("/usr/bin/wget")
    assert not runs_network_tool("whisper-cli")
    assert not runs_network_tool("")


def test_no_code_runs_a_network_tool():
    offenders = {}
    for path in source_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        hits = {
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and runs_network_tool(node.value)
        }
        if hits:
            offenders[str(path.relative_to(SRC))] = sorted(hits)
    assert offenders == {}


def test_models_has_no_hidden_second_host():
    """Every URL in models.py points at Hugging Face; the test override comes from the environment."""
    hosts = {
        urlsplit(node.value).hostname
        for node in ast.walk(ast.parse((SRC / "models.py").read_text(encoding="utf-8")))
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith(("http://", "https://"))
    }
    assert hosts == {"huggingface.co"}


# 2. The strict recorder --------------------------------------------------------------


@dataclass
class NetRecorder:
    allow_loopback: bool = False
    attempts: list[tuple[str, object]] = field(default_factory=list)

    def check(self, kind: str, address: object) -> None:
        self.attempts.append((kind, address))
        host = address[0] if isinstance(address, tuple) else address
        if self.allow_loopback and host in LOOPBACK:
            return
        raise OSError(f"network disabled by the offline test ({kind} {address!r})")

    def non_loopback(self) -> list[tuple[str, object]]:
        return [(k, a) for k, a in self.attempts if (a[0] if isinstance(a, tuple) else a) not in LOOPBACK]


@pytest.fixture
def net(monkeypatch: pytest.MonkeyPatch) -> NetRecorder:
    """Record and refuse every connect, sendto and name lookup (Unix-domain sockets excepted)."""
    recorder = NetRecorder()
    inner_connect, inner_connect_ex, inner_sendto = (
        socket.socket.connect,
        socket.socket.connect_ex,
        socket.socket.sendto,
    )
    inner_create, inner_getaddrinfo = socket.create_connection, socket.getaddrinfo
    inner_byname, inner_byname_ex = socket.gethostbyname, socket.gethostbyname_ex

    def is_inet(sock: socket.socket) -> bool:
        return sock.family in (socket.AF_INET, socket.AF_INET6)

    def connect(self, address):
        if is_inet(self):
            recorder.check("connect", address)
        return inner_connect(self, address)

    def connect_ex(self, address):
        if is_inet(self):
            recorder.check("connect_ex", address)
        return inner_connect_ex(self, address)

    def sendto(self, data, *args):
        if is_inet(self):
            recorder.check("sendto", args[-1])
        return inner_sendto(self, data, *args)

    def create_connection(address, *args, **kwargs):
        recorder.check("create_connection", address)
        return inner_create(address, *args, **kwargs)

    def getaddrinfo(host, *args, **kwargs):
        recorder.check("getaddrinfo", host)
        return inner_getaddrinfo(host, *args, **kwargs)

    def gethostbyname(host):
        recorder.check("gethostbyname", host)
        return inner_byname(host)

    def gethostbyname_ex(host):
        recorder.check("gethostbyname_ex", host)
        return inner_byname_ex(host)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    monkeypatch.setattr(socket.socket, "sendto", sendto)
    monkeypatch.setattr(socket, "create_connection", create_connection)
    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(socket, "gethostbyname", gethostbyname)
    monkeypatch.setattr(socket, "gethostbyname_ex", gethostbyname_ex)
    return recorder


def test_the_recorder_sees_swallowed_attempts(net):
    for attempt in (
        lambda: socket.create_connection(("example.com", 80), timeout=1),
        lambda: socket.getaddrinfo("example.com", 443),
        lambda: socket.socket().connect(("127.0.0.1", 9)),
        lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("10.0.0.1", 53)),
    ):
        with contextlib.suppress(OSError):  # what a careless fallback would do: still on record
            attempt()
    assert [kind for kind, _ in net.attempts] == ["create_connection", "getaddrinfo", "connect", "sendto"]


# 3. Every CLI flow under the recorder ------------------------------------------------


def landed(*modules: str) -> bool:
    return all((SRC / m).is_file() for m in modules)


def skip_until_landed(*modules: str, why: str) -> None:
    """Skip while another PR in the stack is missing; on the full stack, fail instead if asked."""
    if landed(*modules):
        return
    if os.environ.get("JDF_STT_REQUIRE_ALL_FLOWS") == "1":
        pytest.fail(f"{why}: {', '.join(m for m in modules if not landed(m))} is missing")
    pytest.skip(why)


@pytest.fixture
def workspace(tmp_path: Path, fake_bin, fake_model: Path) -> dict[str, Path]:
    """Inputs for the flows: an audio file, a watch folder, and every default model already present."""
    audio = tmp_path / "talk.wav"
    audio.write_bytes(b"RIFF fake audio")  # the fake ffmpeg only checks that it exists
    watch = tmp_path / "watched"
    watch.mkdir()
    (watch / "memo.wav").write_bytes(b"RIFF fake audio")
    models_dir = config.models_dir()
    models_dir.mkdir(parents=True, exist_ok=True)
    for info in models.MODELS.values():  # so no flow could need a download
        (models_dir / info.file).write_bytes(b"fake model")
    return {"audio": audio, "watch": watch, "out": tmp_path / "out", "model": fake_model}


# (id, modules that must have landed, argv with {audio}/{watch}/{out}/{model} placeholders)
FLOWS = [
    ("version", (), ["--version"]),
    ("help", (), ["--help"]),
    ("file-to-stdout", ("engines/whisper_cpp.py",), ["{audio}", "-m", "{model}"]),
    ("transcribe-command", ("engines/whisper_cpp.py",), ["transcribe", "{audio}", "-m", "{model}"]),
    ("default-model", ("engines/whisper_cpp.py",), ["{audio}"]),
    (
        "all-formats",
        ("engines/whisper_cpp.py", "features/output_opts.py"),
        ["{audio}", "-m", "{model}", "-f", "txt", "-f", "srt", "-f", "vtt", "-f", "json", "-o", "{out}"],
    ),
    (
        "expected-language",
        ("engines/whisper_cpp.py", "features/output_opts.py"),
        ["{audio}", "-m", "{model}", "--expected-language", "pt", "-f", "json"],
    ),
    (
        "vocabulary",
        ("engines/whisper_cpp.py", "features/vocab.py"),
        ["{audio}", "-m", "{model}", "--prompt", "Huddle tab sorter"],
    ),
    ("models-list", ("features/models_cmd.py",), ["models", "list"]),
    ("models-path", ("features/models_cmd.py",), ["models", "path"]),
    ("watch-once", ("engines/whisper_cpp.py", "features/watch.py"), ["watch", "{watch}", "--once", "-m", "{model}"]),
    ("bench", ("engines/whisper_cpp.py", "features/bench.py"), ["bench", "{audio}", "-m", "{model}"]),
    ("parakeet", ("engines/parakeet.py",), ["{audio}", "--engine", "parakeet", "-m", "{model}"]),
]


@pytest.mark.parametrize(("needs", "argv"), [pytest.param(n, a, id=i) for i, n, a in FLOWS])
def test_cli_flow_makes_no_connection(needs, argv, workspace, net, cli):
    skip_until_landed(*needs, why=f"needs {', '.join(needs)} (another PR in the stack)")
    result = cli(*(arg.format(**workspace) for arg in argv))
    assert result.code == 0, result.err
    assert net.attempts == []


def test_every_command_help_makes_no_connection(net, cli):
    registry.load_features()
    names = sorted(registry.commands())
    assert "transcribe" in names
    for name in names:
        result = cli(name, "--help")
        assert result.code == 0, (name, result.err)
    assert net.attempts == []


# 4. The one exception: the download the user starts -------------------------------------


@pytest.fixture
def model_server(tmp_path: Path):
    """A local file server shaped like Hugging Face: /<repo>/resolve/main/<file>."""
    root = tmp_path / "served"
    payload = b"a tiny fake model\n" * 100
    path = root / "test-org" / "test-repo" / "resolve" / "main" / "ggml-test.bin"
    path.parent.mkdir(parents=True)
    path.write_bytes(payload)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", payload
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


@pytest.mark.localhost
def test_the_download_reaches_only_its_server(model_server, net, monkeypatch):
    skip_until_landed("features/models_cmd.py", why="needs the model download from PR 02")
    base_url, payload = model_server
    net.allow_loopback = True
    monkeypatch.setenv("JDF_STT_MODEL_BASE_URL", base_url)
    monkeypatch.setattr(models, "BASE_URL", base_url)
    info = models.ModelInfo("test-org/test-repo", "ggml-test.bin", len(payload), hashlib.sha256(payload).hexdigest())
    monkeypatch.setitem(models.MODELS, "test", info)

    path = models.ensure("test", download=True)

    assert Path(path).read_bytes() == payload
    assert net.attempts, "the download did not go through the socket layer at all"
    assert net.non_loopback() == []
