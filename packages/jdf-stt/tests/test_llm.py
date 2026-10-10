"""Local-LLM rewrite modes (PR 07): the localhost-only client and the --mode postprocessor.

Everything talks to tests/fakes/fake_llm_server.py on 127.0.0.1; output quality with a real
model is not tested here.
"""

import dataclasses
import http.server
import importlib.util
import threading
import time
from pathlib import Path

import pytest

from jdf_stt import audio, cli, llm, pipeline, registry
from jdf_stt.features import llm_modes
from jdf_stt.types import Segment, SttError, TranscribeOptions, Transcript

FAKE_LLM_SERVER = Path(__file__).parent / "fakes" / "fake_llm_server.py"
_spec = importlib.util.spec_from_file_location("fake_llm_server", FAKE_LLM_SERVER)
fake_llm_server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fake_llm_server)


@pytest.fixture
def server():
    with fake_llm_server.serve() as s:
        yield s


def opts(server=None, **kw):
    if server is not None:
        kw.setdefault("llm_url", server.url)
    return TranscribeOptions(**kw)


def transcript(text="so um I think we should meet on tuesday"):
    return Transcript(text, (Segment(0.0, 2.0, text),), "en", "fake", "small", 2.0)


# The client ----------------------------------------------------------------------


@pytest.mark.localhost
def test_llama_cpp_request_shape(server):
    server.reply = "  Let's meet on Tuesday.\n"
    out = llm.chat(opts(server), "SYSTEM", "USER")
    assert out == "Let's meet on Tuesday."
    [req] = server.requests
    assert req["path"] == "/v1/chat/completions"
    body = req["body"]
    assert body["messages"] == [{"role": "system", "content": "SYSTEM"}, {"role": "user", "content": "USER"}]
    assert body["stream"] is False
    assert "model" not in body  # llama-server serves the model it loaded


@pytest.mark.localhost
def test_llama_cpp_passes_a_model_when_given(server):
    llm.chat(opts(server, llm_model="qwen"), "s", "u")
    assert server.requests[0]["body"]["model"] == "qwen"


@pytest.mark.localhost
def test_ollama_request_shape(server):
    out = llm.chat(opts(server, llm_backend="ollama", llm_model="llama3.2"), "SYSTEM", "USER")
    assert out == fake_llm_server.DEFAULT_REPLY
    [req] = server.requests
    assert req["path"] == "/api/chat"
    assert req["body"]["model"] == "llama3.2"
    assert req["body"]["stream"] is False
    assert req["body"]["messages"][1] == {"role": "user", "content": "USER"}


def test_ollama_needs_a_model():
    with pytest.raises(SttError, match="--llm-model"):
        llm.chat(TranscribeOptions(llm_backend="ollama", llm_url="http://127.0.0.1:11434"), "s", "u")


def test_ollama_default_port_when_the_url_is_left_alone():
    assert llm.base_url(TranscribeOptions()) == "http://127.0.0.1:8080"
    assert llm.base_url(TranscribeOptions(llm_backend="ollama")) == "http://127.0.0.1:11434"
    assert llm.base_url(TranscribeOptions(llm_backend="ollama", llm_url="http://localhost:9999/")) == (
        "http://localhost:9999"
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com:8080",
        "https://api.openai.com",
        "http://192.168.1.10:11434",
        "http://127.0.0.1.evil.com",
        "http://localhost.example.com",
        "http://user@example.com",
        "file:///etc/passwd",
        "ftp://127.0.0.1",
        "127.0.0.1:8080",
        "",
    ],
)
def test_non_loopback_urls_are_refused_before_any_connection(url, monkeypatch):
    def no_network(*a, **k):
        raise AssertionError("tried to connect")

    monkeypatch.setattr(llm, "_open", no_network)
    with pytest.raises(SttError, match="local models only"):
        llm.chat(TranscribeOptions(llm_url=url), "s", "u")


@pytest.mark.parametrize("url", ["http://127.0.0.1:1", "http://localhost:1", "http://[::1]:1", "https://LOCALHOST"])
def test_loopback_urls_are_accepted(url):
    llm.check_local(url)  # no error


@pytest.mark.localhost
def test_no_server_running_is_a_clear_error():
    with fake_llm_server.serve() as s:
        url = s.url
    # The port is closed now.
    with pytest.raises(SttError) as e:
        llm.chat(TranscribeOptions(llm_url=url), "s", "u")
    message = str(e.value)
    assert "llama.cpp" in message and url in message and "llama-server" in message


@pytest.mark.localhost
def test_no_ollama_running_names_ollama():
    with fake_llm_server.serve() as s:
        url = s.url
    with pytest.raises(SttError, match=r"Ollama.*ollama serve"):
        llm.chat(TranscribeOptions(llm_backend="ollama", llm_model="m", llm_url=url), "s", "u")


@pytest.mark.localhost
def test_http_error_names_backend_url_and_status(server):
    server.status = 500
    with pytest.raises(SttError) as e:
        llm.chat(opts(server), "s", "u")
    assert "500" in str(e.value) and server.url in str(e.value) and "llama.cpp" in str(e.value)
    assert len(server.requests) == 1  # no retry


@pytest.mark.localhost
def test_timeout_is_a_clear_error(server, monkeypatch):
    monkeypatch.setattr(llm, "TIMEOUT", 0.3)
    server.delay = 2
    started = time.monotonic()
    with pytest.raises(SttError, match="did not answer within"):
        llm.chat(opts(server), "s", "u")
    assert time.monotonic() - started < 1.5


@pytest.mark.localhost
def test_proxy_settings_are_ignored(server, monkeypatch):
    """A proxy could forward the text off the Mac: the client never uses one."""
    monkeypatch.setenv("http_proxy", "http://203.0.113.1:3128")
    monkeypatch.setenv("HTTP_PROXY", "http://203.0.113.1:3128")
    monkeypatch.delenv("no_proxy", raising=False)
    monkeypatch.delenv("NO_PROXY", raising=False)
    assert llm.chat(opts(server), "s", "u") == fake_llm_server.DEFAULT_REPLY


@pytest.mark.localhost
def test_redirects_are_not_followed(monkeypatch):
    """A local server that redirects elsewhere does not get the text sent on."""

    class Redirect(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            self.send_response(302)
            self.send_header("Location", "http://example.com/v1/chat/completions")
            self.send_header("Content-Length", "0")
            self.end_headers()

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    thread = threading.Thread(target=httpd.serve_forever, args=(0.05,), daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}"
        with pytest.raises(SttError, match="302"):
            llm.chat(TranscribeOptions(llm_url=url), "s", "u")
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.mark.localhost
def test_a_url_with_the_wrong_path_is_an_http_error(server):
    with pytest.raises(SttError, match="404"):
        llm.chat(opts(server, llm_url=server.url + "/nope"), "s", "u")


# Modes -----------------------------------------------------------------------------


def test_builtin_modes():
    assert set(llm_modes.modes({})) >= {"clean", "email", "notes", "message"}


def test_config_adds_and_overrides_modes():
    cfg = {"modes": {"tweet": {"prompt": "Make it a tweet."}, "clean": {"prompt": "My clean."}}}
    modes = llm_modes.modes(cfg)
    assert modes["tweet"] == "Make it a tweet."
    assert modes["clean"] == "My clean."
    assert "email" in modes


def test_config_mode_without_prompt_is_an_error():
    with pytest.raises(SttError, match=r"\[modes.tweet\]"):
        llm_modes.modes({"modes": {"tweet": {"text": "x"}}})


def test_no_mode_leaves_the_transcript_alone(monkeypatch):
    monkeypatch.setattr(llm, "chat", lambda *a: pytest.fail("called the LLM"))
    t = transcript()
    assert llm_modes.rewrite(t, TranscribeOptions()) is t


def test_unknown_mode_lists_the_known_ones():
    with pytest.raises(SttError, match=r"unknown mode 'poem'.*clean.*email"):
        llm_modes.rewrite(transcript(), TranscribeOptions(mode="poem"))


def test_empty_transcript_is_not_sent(monkeypatch):
    monkeypatch.setattr(llm, "chat", lambda *a: pytest.fail("called the LLM"))
    t = transcript("   ")
    assert llm_modes.rewrite(t, TranscribeOptions(mode="email")) is t


@pytest.mark.localhost
def test_rewrite_replaces_text_and_keeps_segments(server):
    server.reply = "Hi,\n\nShall we meet on Tuesday?\n\nThanks"
    t = transcript()
    out = llm_modes.rewrite(t, opts(server, mode="email"))
    assert out.text == "Hi,\n\nShall we meet on Tuesday?\n\nThanks"
    assert out.segments == t.segments
    assert (out.language, out.engine, out.model, out.duration) == (t.language, t.engine, t.model, t.duration)
    body = server.requests[0]["body"]
    system, user = body["messages"]
    assert llm_modes.BUILTIN_MODES["email"] in system["content"]
    assert "en" in system["content"]  # answer in the transcript's language
    assert user["content"] == t.text


@pytest.mark.localhost
def test_config_mode_prompt_is_sent(server, tmp_path, monkeypatch):
    Path(tmp_path / "jdf-stt-config.toml").write_text('[modes.tweet]\nprompt = "Make it a tweet."\n')
    llm_modes.rewrite(transcript(), opts(server, mode="tweet"))
    assert "Make it a tweet." in server.requests[0]["body"]["messages"][0]["content"]


def test_rewrite_is_registered_at_order_50():
    registry.load_features()
    assert (50, llm_modes.rewrite) in registry._postprocessors


# Command line ----------------------------------------------------------------------


def test_options_parse_into_transcribe_options():
    parser = cli.build_parser()
    ns = parser.parse_args(
        ["transcribe", "a.wav", "--mode", "notes", "--llm-backend", "ollama", "--llm-url", "http://[::1]:1"]
        + ["--llm-model", "llama3.2"]
    )
    o = registry.options_from_args(ns, {})
    assert (o.mode, o.llm_backend, o.llm_url, o.llm_model) == ("notes", "ollama", "http://[::1]:1", "llama3.2")


def test_options_default_to_none_so_config_can_fill_them():
    ns = cli.build_parser().parse_args(["transcribe", "a.wav"])
    for dest in ("mode", "llm_backend", "llm_url", "llm_model"):
        assert getattr(ns, dest) is None
    o = registry.options_from_args(ns, {"transcribe": {"mode": "clean", "llm_backend": "ollama"}})
    assert (o.mode, o.llm_backend) == ("clean", "ollama")


def test_unknown_backend_is_a_usage_error(cli):
    result = cli("transcribe", "a.wav", "--llm-backend", "openai")
    assert result.code == 2 and "invalid choice" in result.err


def test_modes_command_lists_builtin_and_config_modes(cli, tmp_path):
    Path(tmp_path / "jdf-stt-config.toml").write_text('[modes.tweet]\nprompt = "Make it a tweet.\\nShort."\n')
    result = cli("modes")
    assert result.code == 0
    lines = result.out.splitlines()
    names = [line.split()[0] for line in lines]
    assert names == sorted(names)
    assert {"clean", "email", "notes", "message", "tweet"} <= set(names)
    tweet = next(line for line in lines if line.startswith("tweet"))
    assert "Make it a tweet." in tweet and "(config)" in tweet and "Short." not in tweet


@pytest.mark.localhost
@pytest.mark.parametrize("backend", ["llama.cpp", "ollama"])
def test_full_flow_from_the_command_line_through_the_pipeline(backend, server, fake_engine, monkeypatch):
    """`transcribe a.wav --mode email --llm-url <fake>`: parse -> options -> engine -> LLM -> text."""

    def prepare(src, workdir):
        wav = workdir / "audio.wav"
        wav.write_bytes(b"RIFF")
        return wav

    monkeypatch.setattr(audio, "prepare", prepare)
    monkeypatch.setattr(audio, "duration", lambda wav: 1.0)
    server.reply = "Dear team, hello world."
    argv = ["transcribe", "a.wav", "--mode", "email", "--llm-url", server.url]
    argv += ["--llm-backend", backend, "--llm-model", "m"]
    ns = cli.build_parser().parse_args(argv)
    o = registry.options_from_args(ns)
    o = dataclasses.replace(o, engine="fake")  # the --engine option arrives with PR 02
    t = pipeline.transcribe_file("a.wav", o)
    assert t.text == "Dear team, hello world."
    assert t.segments[0].text == "hello world"
    [req] = server.requests
    assert req["path"] == {"llama.cpp": "/v1/chat/completions", "ollama": "/api/chat"}[backend]
    assert req["body"]["messages"][1]["content"] == "hello world"


@pytest.mark.localhost
def test_full_flow_server_down_fails_without_fallback(fake_engine, monkeypatch):
    with fake_llm_server.serve() as s:
        url = s.url
    monkeypatch.setattr(audio, "prepare", lambda src, workdir: workdir / "a.wav")
    monkeypatch.setattr(audio, "duration", lambda wav: 1.0)
    o = TranscribeOptions(engine="fake", mode="clean", llm_url=url)
    with pytest.raises(SttError, match="no llama.cpp server answering"):
        pipeline.transcribe_file("a.wav", o)


@pytest.mark.parametrize(
    ("settings", "error"),
    [
        ({"mode": "emial"}, "unknown mode 'emial'"),
        ({"mode": "email", "llm_url": "https://api.openai.com"}, "local models only"),
        ({"mode": "email", "llm_backend": "ollama"}, "--llm-model"),
    ],
)
def test_bad_llm_settings_fail_before_any_audio_work(settings, error, fake_engine, monkeypatch):
    """A typo in --mode or --llm-url is reported at once, not after a full transcription."""
    registry.load_features()
    monkeypatch.setattr(audio, "prepare", lambda *a: pytest.fail("prepared audio"))
    monkeypatch.setattr(llm, "_open", lambda *a: pytest.fail("tried to connect"))
    with pytest.raises(SttError, match=error):
        pipeline.transcribe_file("a.wav", TranscribeOptions(engine="fake", **settings))
    assert fake_engine.calls == []
