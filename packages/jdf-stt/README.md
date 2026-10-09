# jdf-stt

Private, local dictation and transcription for the Mac. jdf-stt turns speech into text with
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) on your own machine: no account, no cloud,
no telemetry. The only network use is a model download that you start, checked against a
published sha256.

Status: in development ([jdf-suite#30](https://github.com/joaodinissf/jdf-suite/issues/30)). Not on PyPI yet.

## Install

jdf-stt is a Python command-line tool with no Python dependencies. It runs `whisper-cli` and
`ffmpeg`, so install those first:

```sh
brew install whisper-cpp ffmpeg
```

Until the first release, run it from a checkout of this repository:

```sh
uv run --package jdf-stt jdf-stt --help
```

## Quick start

<!-- 02 -->

## Models

<!-- 02 -->

## Output formats and languages

<!-- 03 -->

## Silence, vocabulary and fixes

<!-- 04 -->

## Microphone

<!-- 05 -->

## Privacy

<!-- 06 -->

## Local LLM modes

<!-- 07 -->

## Watch folders

<!-- 08 -->

## MCP server

<!-- 09 -->

## Menu-bar app

<!-- 10 -->

<!-- 11 -->

## Engines, live preview and latency

<!-- 12 -->

## Development

From the repository root or this directory:

```sh
uv sync --package jdf-stt --extra mcp
uv run --package jdf-stt --extra mcp pytest            # unit tests, with fake whisper-cli and ffmpeg
uv run --package jdf-stt ruff check && uv run --package jdf-stt ruff format --check
```

Real runs use a real model and macOS `say` for speech. They are skipped unless asked for:

```sh
JDF_STT_REAL=1 JDF_STT_REAL_MODEL=/path/to/ggml-large-v3-turbo.bin \
  uv run --package jdf-stt --extra mcp pytest -m real
```

How the code is laid out:

- `src/jdf_stt/types.py` holds the shared options (`TranscribeOptions`) and the result
  (`Transcript`); `Transcript.to_dict()` is the JSON shape every consumer reads.
- `src/jdf_stt/registry.py` is where engines, commands, option groups and postprocessors plug in.
  Files in `engines/` and `features/` are found automatically: a new feature is a new file.
- `src/jdf_stt/pipeline.py` runs one file through audio preparation, the engine and the
  postprocessors.
- Tests never touch the network: a guard in `tests/conftest.py` blocks every connection except
  to 127.0.0.1 in tests marked `localhost`. The fakes in `tests/fakes/` stand in for `whisper-cli`
  and `ffmpeg`; their switches are listed in `tests/fakes/_common.py`.

CI (`.github/workflows/jdf-stt-ci.yml`) runs the unit tests on Ubuntu for every pull request.
A macOS job with real `whisper-cli` and the tiny model runs only when started by hand.
