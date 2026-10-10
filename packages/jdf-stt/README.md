# jdf-stt

Private, local dictation and transcription for the Mac. jdf-stt turns speech into text with
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) on your own machine: no account, no cloud,
no telemetry. The only network use is downloading models, each checked against a published
sha256: Whisper models only when you start it, and the 0.8 MB voice-activity model automatically
(see [Models](#models)).

Status: v0.1.0, the first release ([jdf-suite#30](https://github.com/joaodinissf/jdf-suite/issues/30)). macOS on Apple silicon first; transcribing files also works on Linux.

## Install

jdf-stt is a Python command-line tool with no Python dependencies. It runs `whisper-cli` and
`ffmpeg`, so install those first:

```sh
brew install whisper-cpp ffmpeg
```

Then run it with [uv](https://docs.astral.sh/uv/), without installing anything else:

```sh
uvx jdf-stt talk.m4a          # transcribe a file and print the text
uvx jdf-stt --mic             # dictate: Enter stops and transcribes, Esc or Ctrl+C cancels
uvx jdf-stt --help            # every command and option
```

To keep it on your PATH, `uv tool install jdf-stt` (the MCP server needs `uv tool install 'jdf-stt[mcp]'`).
The first transcription asks before downloading the default model (`small`, about 490 MB); see Models.

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

```sh
jdf-stt --mic                    # Enter stops and transcribes; Esc or Ctrl+C cancels
jdf-stt --mic --until-silence    # also stops by itself after a 1.5 s pause
jdf-stt --mic --until-silence --silence-seconds 3 --keep-audio ~/note.wav
```

jdf-stt records the default input device with ffmpeg (`-f avfoundation -i :default`) into a
temporary 16 kHz mono wav, then transcribes it like a file. The recording is deleted afterwards
unless you pass `--keep-audio PATH`. The first time, macOS asks whether your terminal may use
the microphone.

- In a terminal: Enter stops, Esc or Ctrl+C cancels (exit code 130, nothing kept).
- From another program (the menu-bar app, a script): with stdin a pipe, a newline stops; closing
  stdin (EOF), SIGINT or SIGTERM cancels. A program that runs `jdf-stt --mic --until-silence`
  must keep stdin open (or write the newline itself), since EOF counts as cancel.
- `--until-silence` uses ffmpeg's `silencedetect` (below -35 dB for `--silence-seconds`); silence
  before you start speaking does not count.

## Privacy

Nothing leaves your Mac. In detail:

- **Your audio and text stay on your machine.** whisper.cpp and ffmpeg run as local programs.
  There is no account, no telemetry, no crash reporting and no cloud fallback: if a local tool or
  model is missing, jdf-stt stops and tells you, it never sends your audio anywhere instead.
- **The only network use is a model download that you start.** jdf-stt asks first (or you run
  `jdf-stt models download NAME`), fetches the file from Hugging Face over HTTPS, and checks its
  size and sha256 against the values built into jdf-stt before using it. A file that does not
  match is deleted. Models live in `~/.cache/jdf-stt/models`; `--model PATH` uses your own file and
  downloads nothing.
- **Local LLM modes talk to localhost only.** The rewrite modes reach llama.cpp's `llama-server`
  or Ollama on `127.0.0.1`; jdf-stt refuses any other address.
- **Recordings are temporary.** Microphone audio and the converted 16 kHz copy of a file are
  deleted when the transcription ends, unless you ask to keep them (`--keep-audio PATH`).
  Outputs are written only where you ask (stdout, `-o DIR`, or next to the audio in a watch folder).

How this is checked, on every pull request (`tests/test_offline.py`):

- a source scan: only `models.py` (the download) and `llm.py` (the localhost client) import
  network modules, and no code runs a network tool such as `curl`;
- the file, watch-folder, bench, model-listing and Parakeet commands run with fake tools, the
  network blocked and every connection or name lookup recorded, so even a failed attempt fails
  the test; the model download may reach only the server it was given. Three things are not
  run this way: `--mic` (the tests never open a microphone), the LLM modes (they talk to a
  server on localhost on purpose) and the MCP server (it speaks over stdin and stdout). Their
  tests, like every other test, run under a guard that refuses any connection that is not to
  localhost.

And on a Mac (`tests/real/test_real_offline.py`, run by hand): a real transcription with
`whisper-cli`, `ffmpeg` and jdf-stt under `sandbox-exec` with a profile that denies all network
access still gives the right words.

## Local LLM modes

`--mode` rewrites the transcript with a language model running on your Mac, never a cloud
service. jdf-stt talks to [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server` or
to [Ollama](https://ollama.com) over localhost, and refuses any URL that is not on 127.0.0.1,
::1 or localhost. Proxy settings are ignored and redirects are not followed, so the text stays on
the machine. jdf-stt does not download or start a model for you.

```sh
llama-server -m some-model.gguf                  # listens on http://127.0.0.1:8080
jdf-stt --mode email talk.m4a

ollama serve                                     # listens on http://127.0.0.1:11434
jdf-stt --mode notes --llm-backend ollama --llm-model llama3.2 talk.m4a
```

Built-in modes (`jdf-stt modes` lists them, with any you add):

| Mode | What you get |
|---|---|
| `clean` | punctuation and capitals fixed, no rewording |
| `email` | a clear, polite email body |
| `notes` | short bullet points |
| `message` | a short, casual chat message |

Add your own, or replace a built-in one, in `~/.config/jdf-stt/config.toml`:

```toml
[modes.tweet]
prompt = "Rewrite this as a tweet."

[transcribe]          # optional defaults, so a plain `jdf-stt --mode tweet` works
llm_backend = "ollama"
llm_model = "llama3.2"
```

Options: `--llm-backend llama.cpp|ollama` (default `llama.cpp`), `--llm-url URL` (default
`http://127.0.0.1:8080`, or `http://127.0.0.1:11434` for Ollama), `--llm-model NAME` (needed for
Ollama; llama-server uses the model it loaded). The reply replaces the text; srt, vtt and json
segments keep the words as transcribed. If no server answers, or it takes more than 120 seconds,
jdf-stt stops with an error that names the backend and URL. It never tries anywhere else.

## Watch folders

Drop audio into a folder and the transcript appears next to it:

```sh
jdf-stt watch ~/Recordings                    # runs until Ctrl+C, looking every 2 s
jdf-stt watch ~/Recordings -f txt -f srt      # talk.m4a -> talk.txt and talk.srt
jdf-stt watch ~/Inbox ~/Voice --recursive     # several folders, subfolders too
jdf-stt watch ~/Recordings --once             # one pass, then exit (for cron or Shortcuts)
```

- Files ending in wav, mp3, m4a, flac, ogg, aiff, mp4 or mov count; hidden files and folders do not.
- A file is picked up once its size has stopped changing between two looks, so a recording or
  copy still in progress waits. `--interval SECONDS` sets the gap (default 2).
- A file is skipped when every output you asked for already exists, so running it again only
  does new work. Delete `talk.txt` to have `talk.m4a` transcribed again.
- A file that fails is reported and the others carry on; it is tried again once it changes.
  With `--once`, the exit code is 1 if any file failed.
- Every transcription option works here too (`-m`, `--language`, `--vocab`, `--mode`, ...).

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
- `src/jdf_stt/registry.py` is where engines, commands, option groups, option checks and
  postprocessors plug in.
  Files in `engines/` and `features/` are found automatically: a new feature is a new file.
- `src/jdf_stt/pipeline.py` runs one file through the option checks, audio preparation, the
  engine and the postprocessors.
- Tests never touch the network: a guard in `tests/conftest.py` blocks every connection except
  to 127.0.0.1 in tests marked `localhost`. The fakes in `tests/fakes/` stand in for `whisper-cli`
  and `ffmpeg`; their switches are listed in `tests/fakes/_common.py`.

CI (`.github/workflows/jdf-stt-ci.yml`) runs the unit tests on Ubuntu for every pull request.
A macOS job with real `whisper-cli` and the tiny model runs only when started by hand.
