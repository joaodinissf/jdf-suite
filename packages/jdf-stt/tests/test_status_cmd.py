import json

from jdf_stt import config


def status(cli, *args):
    result = cli("status", *args)
    assert result.code == 0, result.err
    return json.loads(result.out)


def test_defaults_with_nothing_downloaded(cli):
    assert status(cli) == {
        "model": "small",
        "model_downloaded": False,
        "vad_model": "silero-v6.2.0",
        "vad_model_downloaded": False,
        "mode": None,
        "llm_url": None,
    }


def test_config_toml_and_the_command_line_are_what_counts(cli, tmp_path):
    d = config.models_dir()
    d.mkdir(parents=True)
    (d / "ggml-base.bin").write_bytes(b"x")
    (d / "ggml-silero-v6.2.0.bin").write_bytes(b"x")
    (tmp_path / "jdf-stt-config.toml").write_text(
        '[transcribe]\nmodel = "base"\nmode = "clean"\nllm_url = "http://192.168.1.5:8080"\n', encoding="utf-8"
    )
    got = status(cli)
    assert (got["model"], got["model_downloaded"], got["vad_model_downloaded"]) == ("base", True, True)
    assert (got["mode"], got["llm_url"]) == ("clean", "http://192.168.1.5:8080")
    assert status(cli, "-m", "tiny")["model"] == "tiny"


def test_no_vad_needs_no_vad_model(cli):
    assert status(cli, "--no-vad")["vad_model"] is None


def test_a_missing_model_file_is_an_error(cli, tmp_path):
    result = cli("status", "-m", str(tmp_path / "nope.bin"))
    assert result.code == 1 and "model file not found" in result.err
