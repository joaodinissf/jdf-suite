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

`-f/--format` picks the output: `txt` (default), `srt`, `vtt` or `json`. Repeat it for several;
with more than one, or with `-o DIR`, each goes to its own file (`talk.srt`, `talk.json`, ...).

```sh
jdf-stt talk.m4a -f srt -f json -o subs/
```

- `srt` and `vtt` have one cue per segment (`HH:MM:SS,mmm` and `HH:MM:SS.mmm`).
- `json` is the same object the menu-bar app and the MCP server read: `text`, `language`,
  `engine`, `model`, `duration` and `segments` (`start`, `end` in seconds, `text`).
- With no speech, txt and srt are empty, vtt is just its `WEBVTT` header and json still has every key.

The language is detected by default (`-l auto`) and shown on stderr as `language: pt`
(and in the json); `-q` / `--quiet` hides that line and the `wrote …` lines. `-l pt` skips detection. Codes like `pt-BR` or `pt_PT` are read as `pt`.

Detection can go wrong on very short clips. `--expected-language en,pt` (or the option repeated) lists
the languages you speak: when the detected one is not in the list, the clip is transcribed again
in the first one. Put it in `~/.config/jdf-stt/config.toml` to keep it:

```toml
[transcribe]
expected_languages = ["pt", "en"]
formats = ["txt"]
```

## Silence, vocabulary and fixes

**Silence never becomes made-up text.** Whisper models tend to "hear" words in silence (a classic is
"Thank you." on a quiet recording). jdf-stt stops that in three places:

- Before the model, voice-activity detection (Silero VAD, through whisper.cpp) skips the parts with no
  speech. It is on by default. Its model, `ggml-silero-v6.2.0.bin` (under 1 MB, sha256-checked), is
  downloaded once into `~/.cache/jdf-stt/models` the first time it is needed.
- Inside the model, whisper's no-speech threshold (`-nth`) and non-speech-token suppression apply.
- After the model, segments that are only markers such as `[BLANK_AUDIO]`, `(music)` or `♪` are dropped.
  If nothing is left, jdf-stt prints nothing, says `no speech` on stderr and exits 0.

```sh
jdf-stt quiet.wav                       # prints nothing when nobody speaks
jdf-stt talk.m4a --vad-threshold 0.6    # stricter about what counts as speech (0-1, default 0.5)
jdf-stt talk.m4a --no-vad               # turn VAD off; also --vad-model PATH, --no-speech-threshold N,
                                        # --no-suppress-nst
```

**Vocabulary.** Names and jargon go to whisper as its prompt, which nudges its spelling:

```sh
jdf-stt talk.m4a --prompt "I use the Huddle Tab Sorter and Ollama."
jdf-stt talk.m4a --vocab words.txt      # one term per line; blank lines and # comments ignored
```

`--vocab` terms are sent as one sentence, `Names in this recording: a, b.`, because whisper ignores a bare
list. A sentence of your own that uses the terms (`--prompt`) works as well; both together are joined.

**Find and replace.** For words the model still gets wrong, a list of `from => to` lines fixes them after
transcription. Matching is whole-word and case-insensitive, and the longest match wins:

```text
# fixes.txt
huddle tab sorter => Huddle Tab Sorter
jay dee eff => JDF
```

```sh
jdf-stt talk.m4a --replace fixes.txt
```

The same pairs can live in `~/.config/jdf-stt/config.toml`; `--replace` adds to them and wins on a clash:

```toml
[replace]
"huddle tab sorter" = "Huddle Tab Sorter"
```

**Filler words.** `um`, `uh`, `erm`, `er`, `ah` and `hmm` are removed from English, with the commas
around them tidied ("So, um, I think" becomes "So, I think"). Words in capitals such as "ER" or "AH-64" are
acronyms and stay. Use `--keep-fillers` to keep them. Lists
apply per detected language and can be set in the config:

```toml
[fillers]
en = ["um", "uh", "like"]   # replaces the English list
pt = ["hã", "tipo"]         # adds Portuguese
```

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
