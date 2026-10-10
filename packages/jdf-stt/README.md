# jdf-stt

Private, local dictation and transcription for the Mac. jdf-stt turns speech into text with
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) on your own machine: no account, no cloud,
no telemetry. The only network use is downloading models, each checked against a published
sha256: Whisper models only when you start it, and the 0.8 MB voice-activity model automatically
(see [Models](#models)).

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

Transcribe a file and print the text:

```sh
jdf-stt talk.m4a
```

Anything ffmpeg can read works (m4a, mp3, aiff, flac, mp4, mov, ...); a 16 kHz mono wav is used
as is. More options:

```sh
jdf-stt talk.m4a -m large-v3-turbo         # another model from the list below
jdf-stt talk.m4a -m ~/models/ggml-x.bin    # or any ggml model file
jdf-stt a.m4a b.mp3                        # several files: writes a.txt and b.txt next to them
jdf-stt talk.m4a -o notes/                 # writes notes/talk.txt
jdf-stt talk.m4a -t 8                      # CPU threads for whisper-cli
```

With one file and one format the text goes to stdout; otherwise each file's output is written
into `-o DIR`, or next to the file. A file that fails is reported and the others still run (exit 1).

## Models

The default model is `small` (465 MB), a good balance of speed and accuracy. Models live in
`~/.cache/jdf-stt/models` (set `JDF_STT_MODELS_DIR` to move them).

```sh
jdf-stt models list                  # every model, its size and whether it is downloaded
jdf-stt models download small        # download (sha256-checked); also: tiny, base, medium, large-v3-turbo
jdf-stt models path small            # where the file lives
```

The first time you transcribe in a terminal without the model, jdf-stt asks before downloading
it (`[y/N]`, no by default). Without a terminal (scripts, the menu-bar app, the MCP server) it
never downloads a Whisper model on its own: it stops and tells you to run `jdf-stt models download`.
The download is streamed to a `.part` file, its size and sha256 are checked against the values
recorded in jdf-stt, and only then is it put in place; a mismatch deletes it.

The small Silero voice-activity model (`silero-v6.2.0`, 0.8 MB), which keeps silence from turning
into made-up text, is the one exception: it is downloaded automatically, without asking and
even without a terminal, the first time a transcription needs it (same `.part` and sha256 checks).
That one 0.8 MB file from Hugging Face is the only download jdf-stt ever starts by itself.

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
