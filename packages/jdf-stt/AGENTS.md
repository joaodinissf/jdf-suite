# Guide for AI coding assistants

This package lives at `packages/jdf-stt/` in the jdf-suite monorepo. Paths below are relative to
this directory. CI: `.github/workflows/jdf-stt-ci.yml` (path-filtered to this package, `uv.lock`
and the root `pyproject.toml`).

## What it is

A private, local dictation and transcription CLI for the Mac. One engine slot (whisper.cpp's
`whisper-cli` by default), files or the microphone in, txt/srt/vtt/json out.

## Rules that do not bend

- **Nothing leaves the Mac.** The only network code is the user-triggered, sha256-checked model
  download in `models.py`, and the localhost-only LLM client in `llm.py`. No telemetry, no cloud
  fallback.
- **Zero runtime dependencies.** Stdlib only; external programs run as subprocesses through
  `procs.run`. The MCP SDK is the optional `mcp` extra and is imported lazily.
- **Tooling:** uv and ruff (`uv run --package jdf-stt ruff check`, `ruff format`). No pip, no black.
- Simplest correct design; no machinery for sub-second edge cases.

## How it fits together

- `types.py`: `TranscribeOptions` (every option any feature reads), `Segment`, `Transcript`
  (`to_dict()` is the JSON contract for `--format json`, the MCP server and the Swift app),
  `SttError` (exit 1), `ToolMissing`, `Cancelled` (exit 130). Do not add fields casually.
- `registry.py`: `register_engine`, `@command`, `@transcribe_options`, `@postprocessor(order)`,
  `options_from_args`. Modules in `engines/` and `features/` are auto-discovered, so a feature is
  a new file that edits nothing shared.
  - An option's argparse `dest` must be a `TranscribeOptions` field and its default must be `None`
    (also for `store_true`/`store_false`), so config.toml can fill unset options.
  - Postprocessor orders: 10 silence guard, 20 find-and-replace, 30 fillers, 50 LLM mode.
- `cli.py`: builds the parser from the registry; anything that is not a command runs `transcribe`.
- `pipeline.py`: `audio.prepare` -> engine -> `language.retry_language` -> postprocessors.
- `config.py`: `$JDF_STT_MODELS_DIR` (default `~/.cache/jdf-stt/models`), `$JDF_STT_CONFIG`
  (default `~/.config/jdf-stt/config.toml`).

## Tests

- `uv run --package jdf-stt --extra mcp pytest` runs everything except real runs.
- Socket guard (autouse): connections raise `OSError("network disabled in tests")`; tests marked
  `localhost` may reach 127.0.0.1 / ::1 only.
- Config and models directories point into `tmp_path` for every test (not for `real` tests' models).
- `fake_bin` puts `tests/fakes/` first on PATH; `fake_bin.calls("whisper-cli")` returns each argv.
  Fake behaviour switches are documented at the top of `tests/fakes/_common.py`. Fakes are
  `#!/usr/bin/env python3`, stdlib only, Python 3.8 syntax.
- Other fixtures: `fake_engine` (an in-process engine named `fake`), `fake_model`, `cli`
  (`cli("--version").out`), `clean_registry`, `add_module`, `say_wav(text, voice=None)`, `real_model`.
- Markers: `real` (needs `JDF_STT_REAL=1`, whisper-cli, ffmpeg and `$JDF_STT_REAL_MODEL`),
  `ffmpeg` (the real ffmpeg with lavfi sources; never a microphone), `localhost`.
- Never open the real microphone or trigger a macOS permission prompt in tests or scripts.
