from pathlib import Path

import pytest

from jdf_stt import config
from jdf_stt.types import SttError


def test_models_dir_default(monkeypatch):
    monkeypatch.delenv("JDF_STT_MODELS_DIR")
    assert config.models_dir() == Path.home() / ".cache" / "jdf-stt" / "models"


def test_models_dir_env(monkeypatch, tmp_path):
    monkeypatch.setenv("JDF_STT_MODELS_DIR", str(tmp_path / "m"))
    assert config.models_dir() == tmp_path / "m"


def test_config_path_default(monkeypatch):
    monkeypatch.delenv("JDF_STT_CONFIG")
    assert config.config_path() == Path.home() / ".config" / "jdf-stt" / "config.toml"


def test_env_paths_expand_the_home_directory(monkeypatch):
    monkeypatch.setenv("JDF_STT_CONFIG", "~/x.toml")
    assert config.config_path() == Path.home() / "x.toml"


def test_tests_never_see_the_users_files():
    assert not str(config.config_path()).startswith(str(Path.home() / ".config"))
    assert not str(config.models_dir()).startswith(str(Path.home() / ".cache"))


def test_missing_config_is_empty():
    assert not config.config_path().exists()
    assert config.load_config() == {}


def test_load_config_tables():
    config.config_path().write_text(
        """
[transcribe]
model = "base"
expected_languages = ["en", "pt"]

[replace]
"jay dee eff" = "jdf"

[fillers]
pt = ["tipo", "pronto"]

[modes.haiku]
prompt = "Rewrite as a haiku."
""",
        encoding="utf-8",
    )
    cfg = config.load_config()
    assert cfg["transcribe"] == {"model": "base", "expected_languages": ["en", "pt"]}
    assert cfg["replace"] == {"jay dee eff": "jdf"}
    assert cfg["fillers"] == {"pt": ["tipo", "pronto"]}
    assert cfg["modes"]["haiku"]["prompt"] == "Rewrite as a haiku."


def test_broken_config_names_the_file():
    config.config_path().write_text("[transcribe\n", encoding="utf-8")
    with pytest.raises(SttError, match="jdf-stt-config.toml"):
        config.load_config()
