import dataclasses
import json
import wave

import pytest

from jdf_stt import config, registry
from jdf_stt.engines import whisper_cpp
from jdf_stt.types import Segment, SttError, ToolMissing, TranscribeOptions

# Every TranscribeOptions field, and whether the whisper-cli engine turns it into flags.
# A new field must be added here: either mapped by the engine or explicitly someone else's.
ENGINE_FIELDS = {
    "model": "-m",
    "threads": "-t",
    "language": "-l",
    "vad": "--vad",
    "vad_model": "-vm",
    "vad_threshold": "-vt",
    "no_speech_threshold": "-nth",
    "suppress_nst": "-sns",
    "prompt": "--prompt",
    "vocabulary": "--prompt",
}
NOT_ENGINE_FIELDS = {
    "engine": "selects the engine (registry)",
    "expected_languages": "language retry (pipeline, PR 03)",
    "replacements": "postprocessor (PR 04)",
    "remove_fillers": "postprocessor (PR 04)",
    "fillers": "postprocessor (PR 04)",
    "formats": "output rendering (formats.py)",
    "output_dir": "transcribe command",
    "mic": "recording (PR 05)",
    "mic_input": "recording (PR 05)",
    "until_silence": "recording (PR 05)",
    "silence_seconds": "recording (PR 05)",
    "keep_audio": "recording (PR 05)",
    "mode": "LLM postprocessor (PR 07)",
    "llm_backend": "LLM postprocessor (PR 07)",
    "llm_url": "LLM postprocessor (PR 07)",
    "llm_model": "LLM postprocessor (PR 07)",
}


@pytest.fixture
def wav(tmp_path):
    path = tmp_path / "in.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    return path


@pytest.fixture
def vad_model(tmp_path):
    path = tmp_path / "ggml-silero-fake.bin"
    path.write_bytes(b"fake vad")
    return path


@pytest.fixture
def opts(fake_model, vad_model):
    return TranscribeOptions(model=str(fake_model), vad_model=str(vad_model))


def run(fake_bin, wav, options):
    t = whisper_cpp.WhisperCppEngine().transcribe(wav, options)
    return t, fake_bin.calls("whisper-cli")[-1]


def flag(argv, name):
    return argv[argv.index(name) + 1]


def test_every_option_field_is_classified():
    fields = {f.name for f in dataclasses.fields(TranscribeOptions)}
    assert fields == set(ENGINE_FIELDS) | set(NOT_ENGINE_FIELDS)
    assert not set(ENGINE_FIELDS) & set(NOT_ENGINE_FIELDS)


def test_default_command(fake_bin, wav, opts, fake_model, vad_model):
    _, argv = run(fake_bin, wav, opts)
    out = argv[argv.index("-of") + 1]
    assert argv == [
        "-m",
        str(fake_model),
        "-f",
        str(wav),
        "-l",
        "auto",
        "-oj",
        "-of",
        out,
        "-np",
        "-nth",
        "0.6",
        "-sns",
        "--vad",
        "-vm",
        str(vad_model),
        "-vt",
        "0.5",
    ]
    assert out.endswith("/out")


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("threads", 6, ["-t", "6"]),
        ("language", "pt", ["-l", "pt"]),
        ("vad_threshold", 0.35, ["-vt", "0.35"]),
        ("no_speech_threshold", 0.8, ["-nth", "0.8"]),
        ("prompt", "Huddle, jdf-stt.", ["--prompt", "Huddle, jdf-stt."]),
        ("vocabulary", ("Huddle", "OpenRouter"), ["--prompt", "Huddle, OpenRouter"]),
    ],
)
def test_each_engine_field_reaches_its_flag(fake_bin, wav, opts, field, value, expected):
    _, argv = run(fake_bin, wav, dataclasses.replace(opts, **{field: value}))
    i = argv.index(expected[0])
    assert argv[i : i + len(expected)] == expected


def test_prompt_and_vocabulary_are_joined(fake_bin, wav, opts):
    o = dataclasses.replace(opts, prompt="A talk about tabs.", vocabulary=("Huddle",))
    _, argv = run(fake_bin, wav, o)
    assert flag(argv, "--prompt") == "A talk about tabs. Huddle"
    assert argv.count("--prompt") == 1


def test_no_threads_or_prompt_by_default(fake_bin, wav, opts):
    _, argv = run(fake_bin, wav, opts)
    assert "-t" not in argv and "--prompt" not in argv


def test_switches_turn_flags_off(fake_bin, wav, opts):
    _, argv = run(fake_bin, wav, dataclasses.replace(opts, vad=False, suppress_nst=False))
    for gone in ("--vad", "-vm", "-vt", "-sns"):
        assert gone not in argv
    assert flag(argv, "-nth") == "0.6"  # the no-speech threshold always applies


def test_fields_owned_elsewhere_do_not_change_the_command(fake_bin, wav, opts):
    _, base = run(fake_bin, wav, opts)
    other = dataclasses.replace(
        opts,
        engine="whisper-cpp",
        expected_languages=("en", "pt"),
        replacements=(("tab", "Tab"),),
        remove_fillers=False,
        fillers={"pt": ("hã",)},
        formats=("srt", "json"),
        output_dir="/tmp/x",
        mic=True,
        mic_input=("-f", "lavfi"),
        until_silence=True,
        silence_seconds=3.0,
        keep_audio="/tmp/k.wav",
        mode="email",
        llm_backend="ollama",
        llm_url="http://127.0.0.1:11434",
        llm_model="qwen",
    )
    _, argv = run(fake_bin, wav, other)
    strip = lambda a: [x for x in a if not x.endswith("/out")]  # noqa: E731 (temp dir differs)
    assert strip(argv) == strip(base)


def test_parses_the_json(fake_bin, wav, opts, monkeypatch):
    monkeypatch.setenv("FAKE_WHISPER_SEGMENTS", json.dumps([[0, 1500, " Hello there."], [1500, 3250, " Bom dia."]]))
    monkeypatch.setenv("FAKE_WHISPER_LANG", "pt")
    t, _ = run(fake_bin, wav, opts)
    assert t.text == "Hello there. Bom dia."
    assert t.segments == (Segment(0.0, 1.5, "Hello there."), Segment(1.5, 3.25, "Bom dia."))
    assert t.language == "pt"
    assert (t.engine, t.model) == ("whisper-cpp", opts.model)


def test_no_speech_is_an_empty_transcript(fake_bin, wav, opts, monkeypatch):
    monkeypatch.setenv("FAKE_WHISPER_SEGMENTS", "[]")
    t, _ = run(fake_bin, wav, opts)
    assert (t.text, t.segments) == ("", ())


def test_whisper_failure_shows_its_stderr(fake_bin, wav, opts, monkeypatch):
    monkeypatch.setenv("FAKE_WHISPER_EXIT", "4")
    monkeypatch.setenv("FAKE_WHISPER_STDERR", "ggml_metal_init: boom")
    with pytest.raises(SttError, match=r"(?s)whisper-cli failed \(exit 4\).*boom"):
        run(fake_bin, wav, opts)


def test_whisper_cli_missing(tmp_path, wav, opts, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    with pytest.raises(ToolMissing, match="brew install whisper-cpp"):
        whisper_cpp.WhisperCppEngine().transcribe(wav, opts)


def test_models_by_name_come_from_the_models_dir(fake_bin, wav, opts):
    d = config.models_dir()
    d.mkdir(parents=True)
    (d / "ggml-base.bin").write_bytes(b"x")
    (d / "ggml-silero-v6.2.0.bin").write_bytes(b"x")
    _, argv = run(fake_bin, wav, dataclasses.replace(opts, model="base", vad_model="silero-v6.2.0"))
    assert flag(argv, "-m") == str(d / "ggml-base.bin")
    assert flag(argv, "-vm") == str(d / "ggml-silero-v6.2.0.bin")


def test_a_missing_model_is_not_downloaded_off_a_terminal(fake_bin, wav, opts):
    # stdin is not a terminal under pytest: no prompt, no download, a clear error instead.
    with pytest.raises(SttError, match="jdf-stt models download small"):
        run(fake_bin, wav, dataclasses.replace(opts, model="small"))
    assert fake_bin.calls("whisper-cli") == []


def test_the_engine_is_registered():
    assert "whisper-cpp" in registry.engine_names()
    assert registry.get_engine("whisper-cpp").name == "whisper-cpp"
