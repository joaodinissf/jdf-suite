import hashlib
import io
import sys
from pathlib import Path

import pytest

from jdf_stt import config, models
from jdf_stt.types import SttError

sys.path.insert(0, str(Path(__file__).parent / "fakes"))
from fake_http import serve  # noqa: E402

DATA = b"fake ggml weights " * 4096  # ~72 KB: several read chunks
URL_PATH = "/test/repo/resolve/main/ggml-test.bin"


@pytest.fixture
def entry(monkeypatch):
    """A registry entry `test` whose sha256 matches DATA."""
    info = models.ModelInfo("test/repo", "ggml-test.bin", len(DATA), hashlib.sha256(DATA).hexdigest())
    monkeypatch.setitem(models.MODELS, "test", info)
    return info


@pytest.fixture
def server(monkeypatch, entry):
    with serve({URL_PATH: DATA}) as srv:
        monkeypatch.setenv("JDF_STT_MODEL_BASE_URL", srv.url)
        yield srv


def test_registry_matches_the_spec_table():
    assert models.MODELS["small"].file == "ggml-small.bin"
    assert models.MODELS["small"].size == 487601967
    assert models.DEFAULT_VAD == "silero-v6.2.0" and models.DEFAULT_VAD in models.MODELS
    for info in models.MODELS.values():
        assert len(info.sha256) == 64 and int(info.sha256, 16) >= 0


def test_human_size():
    assert models.human_size(487601967) == "465 MB"
    assert models.human_size(885098) == "0.8 MB"
    assert models.human_size(1624555275) == "1.5 GB"


def test_resolve_an_existing_path_is_used_as_is(fake_model):
    assert models.resolve(str(fake_model)) == fake_model


def test_resolve_a_name_goes_to_the_models_dir():
    assert models.resolve("small") == config.models_dir() / "ggml-small.bin"


def test_resolve_a_registry_name_wins_over_a_same_named_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "small").write_bytes(b"not a model")
    assert models.resolve("small") == config.models_dir() / "ggml-small.bin"


def test_resolve_unknown_name_lists_the_known_ones():
    with pytest.raises(SttError, match=r"unknown model 'nope'.*small"):
        models.resolve("nope")


def test_resolve_a_missing_path_says_so(tmp_path):
    with pytest.raises(SttError, match="model file not found"):
        models.resolve(str(tmp_path / "missing.bin"))


def test_url_uses_the_base_url_override(monkeypatch, entry):
    assert models.url("test") == "https://huggingface.co/test/repo/resolve/main/ggml-test.bin"
    monkeypatch.setenv("JDF_STT_MODEL_BASE_URL", "http://127.0.0.1:9/")
    assert models.url("test") == "http://127.0.0.1:9/test/repo/resolve/main/ggml-test.bin"


def test_ensure_present_model_never_downloads(entry):
    path = config.models_dir() / entry.file
    path.parent.mkdir(parents=True)
    path.write_bytes(b"already here")
    assert models.ensure("test", download=True) == path  # the socket guard would fail any download


def test_ensure_missing_without_download_tells_how(entry):
    with pytest.raises(SttError, match=r"jdf-stt models download test"):
        models.ensure("test", download=False)


@pytest.mark.localhost
def test_download_streams_verifies_and_renames(server, entry, capsys):
    path = models.ensure("test", download=True)
    assert path == config.models_dir() / "ggml-test.bin"
    assert path.read_bytes() == DATA
    assert not path.with_name(path.name + ".part").exists()
    assert server.requests == [URL_PATH]
    err = capsys.readouterr().err
    assert "ggml-test.bin" in err and "sha256 ok" in err


@pytest.mark.localhost
def test_wrong_hash_deletes_the_part_file(server, entry, monkeypatch):
    monkeypatch.setitem(models.MODELS, "test", entry._replace(sha256="0" * 64))
    with pytest.raises(SttError, match="sha256 mismatch"):
        models.ensure("test", download=True)
    assert list(config.models_dir().iterdir()) == []


@pytest.mark.localhost
def test_wrong_size_deletes_the_part_file(server, entry, monkeypatch):
    monkeypatch.setitem(models.MODELS, "test", entry._replace(size=len(DATA) + 1))
    with pytest.raises(SttError, match="size mismatch"):
        models.ensure("test", download=True)
    assert list(config.models_dir().iterdir()) == []


@pytest.mark.localhost
def test_dropped_connection_deletes_the_part_file(monkeypatch, entry):
    with serve({URL_PATH: DATA}, truncate={URL_PATH: 1000}) as srv:
        monkeypatch.setenv("JDF_STT_MODEL_BASE_URL", srv.url)
        # urllib reports a short body either as an error or as a short read: both must fail cleanly.
        with pytest.raises(SttError, match=r"download of ggml-test.bin(: size mismatch| failed)"):
            models.ensure("test", download=True)
    assert list(config.models_dir().iterdir()) == []


@pytest.mark.localhost
def test_http_error_is_clear(monkeypatch, entry):
    with serve({}) as srv:
        monkeypatch.setenv("JDF_STT_MODEL_BASE_URL", srv.url)
        with pytest.raises(SttError, match=r"download of ggml-test.bin failed.*404"):
            models.ensure("test", download=True)
    assert not config.models_dir().exists() or list(config.models_dir().iterdir()) == []


def test_download_with_the_network_blocked_is_a_clear_error(entry):
    # The socket guard stands in for an offline Mac: no connection, a readable error, no .part left.
    with pytest.raises(SttError, match="download of ggml-test.bin failed"):
        models.ensure("test", download=True)
    assert list(config.models_dir().iterdir()) == []


# Consent ------------------------------------------------------------------------


class _Tty(io.StringIO):
    def isatty(self):
        return True


def test_consent_asks_on_a_terminal(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", _Tty("y\n"))
    monkeypatch.setattr(sys, "stderr", _Tty())
    assert models.ask_to_download("small") is True
    prompt = sys.stderr.getvalue()
    assert f"Download ggml-small.bin (465 MB) to {config.models_dir()}? [y/N]" in prompt


@pytest.mark.parametrize("answer", ["\n", "n\n", "no\n", ""])
def test_consent_defaults_to_no(monkeypatch, answer):
    monkeypatch.setattr(sys, "stdin", _Tty(answer))
    monkeypatch.setattr(sys, "stderr", _Tty())
    assert models.ask_to_download("small") is False


def test_consent_never_asks_without_a_terminal(monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO("y\n"))  # a pipe: the Swift app, MCP, scripts
    assert models.ask_to_download("small") is False


def test_consent_not_needed_for_paths_or_present_models(monkeypatch, fake_model):
    monkeypatch.setattr(sys, "stdin", _Tty("y\n"))
    monkeypatch.setattr(sys, "stderr", _Tty())
    assert models.ask_to_download(str(fake_model)) is False
    present = config.models_dir() / "ggml-small.bin"
    present.parent.mkdir(parents=True)
    present.write_bytes(b"x")
    assert models.ask_to_download("small") is False
    assert sys.stderr.getvalue() == ""
