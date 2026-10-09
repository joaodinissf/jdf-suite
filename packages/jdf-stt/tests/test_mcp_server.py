"""`jdf-stt mcp`: the tool functions directly, a real stdio session through the SDK client, and
the message shown when the optional extra is missing.
"""

from __future__ import annotations

import asyncio
import json
import sys
import textwrap
from pathlib import Path

import pytest

from jdf_stt import audio, formats, models, registry
from jdf_stt.config import models_dir
from jdf_stt.features import mcp_server
from jdf_stt.types import SttError


def spec_resolve(name_or_path: str) -> Path:
    """`models.resolve` as the spec defines it (PR 02 implements it; this branch has the stub)."""
    path = Path(name_or_path).expanduser()
    if path.exists() or name_or_path not in models.MODELS:
        return path
    return models_dir() / models.MODELS[name_or_path].file


@pytest.fixture
def server_env(monkeypatch, tmp_path, fake_engine):
    """The fake engine via config.toml, a 2.5 s placeholder wav, and the spec's `models.resolve`."""

    def prepare(src, workdir):
        if not src.is_file():
            raise SttError(f"{src}: no such file")
        wav = workdir / "audio.wav"
        wav.write_bytes(b"RIFF")
        return wav

    monkeypatch.setattr(audio, "prepare", prepare)
    monkeypatch.setattr(audio, "duration", lambda wav: 2.5)
    monkeypatch.setattr(models, "resolve", spec_resolve)
    registry._postprocessors.clear()  # no other feature's postprocessors (clean_registry restores them)
    config = tmp_path / "jdf-stt-config.toml"
    config.write_text('[transcribe]\nengine = "fake"\n', encoding="utf-8")
    talk = tmp_path / "talk.m4a"
    talk.write_bytes(b"not really audio")
    return talk


def test_mcp_is_a_command(cli):
    result = cli("--help")
    assert "mcp" in result.out


def test_transcribe_file_returns_the_text(server_env, fake_engine, fake_model):
    text = mcp_server.transcribe_file(str(server_env), model=str(fake_model))
    assert text == "hello world\n"
    ((audio_path, options),) = fake_engine.calls
    assert options.engine == "fake"  # config.toml still applies
    assert options.model == str(fake_model)
    assert options.language == "auto"


def test_the_configured_language_applies_unless_one_is_passed(server_env, fake_engine, fake_model, monkeypatch):
    config = server_env.parent / "jdf-stt-config.toml"
    config.write_text('[transcribe]\nengine = "fake"\nlanguage = "pt"\n', encoding="utf-8")
    mcp_server.transcribe_file(str(server_env), model=str(fake_model))
    mcp_server.transcribe_file(str(server_env), language="auto", model=str(fake_model))
    assert [call[1].language for call in fake_engine.calls] == ["pt", "auto"]


def test_transcribe_file_passes_the_language(server_env, fake_engine, fake_model):
    mcp_server.transcribe_file(str(server_env), language="pt", model=str(fake_model))
    assert fake_engine.calls[0][1].language == "pt"


def test_transcribe_file_json_is_the_shared_contract(server_env, fake_model):
    try:
        out = mcp_server.transcribe_file(str(server_env), format="json", model=str(fake_model))
    except NotImplementedError:
        pytest.skip("json rendering arrives with PR 03 (formats)")
    doc = json.loads(out)
    assert doc["text"] == "hello world"
    assert doc["language"] == "en"
    assert doc["duration"] == 2.5
    assert doc["segments"] == [{"start": 0.0, "end": 1.0, "text": "hello world"}]


def test_transcribe_file_expands_home(server_env, fake_engine, fake_model, monkeypatch):
    monkeypatch.setenv("HOME", str(server_env.parent))
    assert mcp_server.transcribe_file("~/talk.m4a", model=str(fake_model)) == "hello world\n"


def test_missing_file_is_an_error(server_env, tmp_path):
    with pytest.raises(SttError, match="no such file"):
        mcp_server.transcribe_file(str(tmp_path / "nope.wav"))


def test_unknown_format_is_an_error(server_env, fake_model):
    with pytest.raises(SttError, match="unknown format 'docx'"):
        mcp_server.transcribe_file(str(server_env), format="docx", model=str(fake_model))


def test_a_missing_model_is_never_downloaded(server_env, fake_engine, monkeypatch):
    def no_download(*args, **kwargs):
        raise AssertionError("the MCP server must not download")

    monkeypatch.setattr(models, "ensure", no_download)
    with pytest.raises(SttError, match="jdf-stt models download small"):
        mcp_server.transcribe_file(str(server_env))  # default model "small", not downloaded
    assert fake_engine.calls == []


def test_a_missing_vad_model_is_never_downloaded(server_env, fake_model, tmp_path):
    (tmp_path / "jdf-stt-config.toml").write_text('[transcribe]\nengine = "whisper-cpp"\n', encoding="utf-8")
    with pytest.raises(SttError, match="jdf-stt models download silero-v6.2.0"):
        mcp_server.transcribe_file(str(server_env), model=str(fake_model))


def test_vad_model_is_only_checked_for_whisper_cpp(server_env, fake_engine, fake_model):
    mcp_server.transcribe_file(str(server_env), model=str(fake_model))  # engine "fake", vad on, no VAD file
    assert len(fake_engine.calls) == 1


def test_a_missing_model_file_is_an_error(server_env, tmp_path):
    with pytest.raises(SttError, match="model not found"):
        mcp_server.transcribe_file(str(server_env), model=str(tmp_path / "ggml-gone.bin"))


def test_list_models_reports_sizes_downloads_and_engines(server_env, fake_engine):
    models_dir().mkdir(parents=True)
    (models_dir() / "ggml-tiny.bin").write_bytes(b"x")
    report = mcp_server.list_models()
    by_name = {m["name"]: m for m in report["models"]}
    assert set(by_name) == set(models.MODELS)
    assert by_name["tiny"] == {
        "name": "tiny",
        "file": "ggml-tiny.bin",
        "size": models.MODELS["tiny"].size,
        "downloaded": True,
    }
    assert by_name["small"]["downloaded"] is False
    assert report["models_dir"] == str(models_dir())
    assert "fake" in report["engines"]
    assert report["default_model"] == "small"


def hide_mcp(monkeypatch):
    for name in [n for n in sys.modules if n == "mcp" or n.startswith("mcp.")] + ["mcp"]:
        monkeypatch.setitem(sys.modules, name, None)


def test_without_the_extra_the_command_says_how_to_install(cli, monkeypatch):
    hide_mcp(monkeypatch)
    result = cli("mcp")
    assert result.code == 1
    assert "uvx --from 'jdf-stt[mcp]' jdf-stt mcp" in result.err
    assert result.out == ""


def test_without_the_extra_the_tools_still_import(monkeypatch):
    hide_mcp(monkeypatch)
    assert callable(mcp_server.transcribe_file)  # the SDK is imported only by build_server()


# A real stdio session ------------------------------------------------------------

# The server under test: `jdf-stt mcp` (cli.main) in a child process, with the fake engine in
# place of whisper-cli, so the session runs over real pipes with the real SDK on both ends.
SERVER = textwrap.dedent(
    """
    import sys
    from pathlib import Path

    from jdf_stt import audio, models, registry
    from jdf_stt.cli import main
    from jdf_stt.types import Segment, Transcript


    class Fake:
        name = "fake"

        def transcribe(self, wav, o):
            print("engine chatter must not reach stdout", file=sys.stderr)
            return Transcript("Hello over stdio.", (Segment(0.0, 1.5, "Hello over stdio."),), "en", "fake", o.model)


    def prepare(src, workdir):
        wav = workdir / "audio.wav"
        wav.write_bytes(b"RIFF")
        return wav


    registry.register_engine("fake", Fake)
    audio.prepare = prepare
    audio.duration = lambda wav: 1.5
    models.resolve = lambda name: Path(name)
    sys.exit(main(["mcp"]))
    """
)


def run_session(tmp_path, steps):
    pytest.importorskip("mcp", reason="the mcp extra is not installed")
    from mcp import ClientSession, StdioServerParameters  # noqa: PLC0415 (optional extra)
    from mcp.client.stdio import stdio_client  # noqa: PLC0415 (optional extra)

    script = tmp_path / "server.py"
    script.write_text(SERVER, encoding="utf-8")
    config = tmp_path / "jdf-stt-config.toml"
    config.write_text('[transcribe]\nengine = "fake"\nvad = false\n', encoding="utf-8")
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(script)],
        env={"JDF_STT_CONFIG": str(config), "JDF_STT_MODELS_DIR": str(tmp_path / "models"), "PATH": ""},
    )

    async def session():
        async with stdio_client(params) as (read, write), ClientSession(read, write) as client:
            await client.initialize()
            return await steps(client)

    return asyncio.run(asyncio.wait_for(session(), timeout=60))


def test_stdio_session_lists_both_tools_and_transcribes(tmp_path, fake_model):
    talk = tmp_path / "talk.wav"
    talk.write_bytes(b"RIFF")

    async def steps(client):
        tools = await client.list_tools()
        text = await client.call_tool("transcribe_file", {"path": str(talk), "model": str(fake_model)})
        listing = await client.call_tool("list_models", {})
        missing = await client.call_tool("transcribe_file", {"path": str(tmp_path / "nope.wav")})
        return tools, text, listing, missing

    tools, text, listing, missing = run_session(tmp_path, steps)

    by_name = {t.name: t for t in tools.tools}
    assert set(by_name) == {"transcribe_file", "list_models"}
    schema = by_name["transcribe_file"].inputSchema
    assert schema["required"] == ["path"]
    assert set(schema["properties"]) == {"path", "format", "language", "model"}
    assert by_name["transcribe_file"].description.startswith("Transcribe an audio or video file")

    assert not text.isError
    assert text.content[0].text == "Hello over stdio.\n"

    report = json.loads(listing.content[0].text)
    assert {m["name"] for m in report["models"]} == set(models.MODELS)
    assert {"fake", "whisper-cpp"} <= set(report["engines"])

    assert missing.isError
    assert "no such file" in missing.content[0].text


def test_formats_list_matches_the_tool_description():
    assert all(fmt in mcp_server.transcribe_file.__doc__ for fmt in formats.FORMATS)


def test_the_format_is_rendered_by_formats(server_env, fake_model, monkeypatch):
    seen = []
    monkeypatch.setattr(formats, "render", lambda t, fmt: seen.append((t.text, fmt)) or "rendered")
    assert mcp_server.transcribe_file(str(server_env), format="srt", model=str(fake_model)) == "rendered"
    assert seen == [("hello world", "srt")]
