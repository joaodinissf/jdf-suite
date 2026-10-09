import hashlib
import sys
from pathlib import Path

import pytest

from jdf_stt import config, models

sys.path.insert(0, str(Path(__file__).parent / "fakes"))
from fake_http import serve  # noqa: E402

DATA = b"tiny fake model" * 100


def test_list_shows_sizes_and_status(cli):
    d = config.models_dir()
    d.mkdir(parents=True)
    (d / "ggml-base.bin").write_bytes(b"x")
    result = cli("models", "list")
    assert result.code == 0
    lines = {line.split()[0]: line for line in result.out.splitlines()[1:] if line.strip()}
    assert set(models.MODELS) <= set(lines)
    assert "465 MB" in lines["small"] and "missing" in lines["small"] and "default" in lines["small"]
    assert "downloaded" in lines["base"]
    assert "0.8 MB" in lines["silero-v6.2.0"]
    assert str(d) in result.out


def test_models_alone_lists(cli):
    assert "ggml-small.bin" in cli("models").out


def test_path(cli):
    assert cli("models", "path").out == f"{config.models_dir()}\n"
    assert cli("models", "path", "small").out == f"{config.models_dir() / 'ggml-small.bin'}\n"
    result = cli("models", "path", "nope")
    assert result.code == 1 and "unknown model" in result.err


@pytest.mark.localhost
def test_download(cli, monkeypatch):
    info = models.ModelInfo("t/r", "ggml-t.bin", len(DATA), hashlib.sha256(DATA).hexdigest())
    monkeypatch.setitem(models.MODELS, "t", info)
    with serve({"/t/r/resolve/main/ggml-t.bin": DATA}) as srv:
        monkeypatch.setenv("JDF_STT_MODEL_BASE_URL", srv.url)
        result = cli("models", "download", "t")
        assert result.code == 0, result.err
        assert result.out == f"{config.models_dir() / 'ggml-t.bin'}\n"
        again = cli("models", "download", "t")
        assert again.code == 0 and "already downloaded" in again.err
        assert len(srv.requests) == 1


def test_download_unknown(cli):
    result = cli("models", "download", "nope")
    assert result.code == 1 and "unknown model 'nope'" in result.err
