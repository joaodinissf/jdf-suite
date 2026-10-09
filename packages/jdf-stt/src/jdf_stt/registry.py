"""The plug-in points: engines, commands, transcription option groups and postprocessors.

Modules in `jdf_stt.engines` and `jdf_stt.features` are discovered automatically
(`pkgutil.iter_modules`), so a new engine or feature is a new file that registers
itself here at import time; nothing shared is edited.

Rules for option groups: every argparse `dest` must be a `TranscribeOptions` field,
and every default must be `None` (including `store_true`/`store_false` flags), so that
`options_from_args` can tell "not given" from "given" and let config.toml fill the gap.
"""

from __future__ import annotations

import argparse
import dataclasses
import importlib
import pkgutil
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from jdf_stt import config
from jdf_stt.types import SttError, TranscribeOptions, Transcript


class Engine(Protocol):
    name: str

    def transcribe(self, audio_path: Path, options: TranscribeOptions) -> Transcript: ...


EngineFactory = Callable[[], Engine]
CommandSetup = Callable[[argparse.ArgumentParser], Callable[[argparse.Namespace], int]]
OptionGroup = Callable[[argparse._ArgumentGroup], None]
Postprocessor = Callable[[Transcript, TranscribeOptions], Transcript]
OptionCheck = Callable[[TranscribeOptions], None]

_engines: dict[str, EngineFactory] = {}
_commands: dict[str, tuple[str, CommandSetup]] = {}
_option_groups: list[OptionGroup] = []
_postprocessors: list[tuple[int, Postprocessor]] = []
_option_checks: list[OptionCheck] = []


def _discover(package_name: str) -> None:
    package = importlib.import_module(package_name)
    for module in pkgutil.iter_modules(package.__path__):
        importlib.import_module(f"{package_name}.{module.name}")


def load_engines() -> None:
    """Import every module in `jdf_stt.engines` (each registers itself)."""
    _discover("jdf_stt.engines")


def load_features() -> None:
    """Import every module in `jdf_stt.features` (each registers itself)."""
    _discover("jdf_stt.features")


# Engines ---------------------------------------------------------------------


def register_engine(name: str, factory: EngineFactory) -> None:
    _engines[name] = factory


def engine_names() -> list[str]:
    load_engines()
    return sorted(_engines)


def get_engine(name: str) -> Engine:
    """A fresh engine instance; unknown names raise `SttError` listing the known ones."""
    load_engines()
    try:
        factory = _engines[name]
    except KeyError:
        known = ", ".join(sorted(_engines)) or "none"
        raise SttError(f"unknown engine {name!r} (available: {known})") from None
    return factory()


# Commands --------------------------------------------------------------------


def command(name: str, help: str) -> Callable[[CommandSetup], CommandSetup]:
    """Register a subcommand: decorates `def setup(parser) -> run`, where `run(ns) -> exit code`."""

    def decorate(setup: CommandSetup) -> CommandSetup:
        _commands[name] = (help, setup)
        return setup

    return decorate


def commands() -> dict[str, tuple[str, CommandSetup]]:
    return dict(_commands)


# Transcription options --------------------------------------------------------


def transcribe_options(add: OptionGroup) -> OptionGroup:
    """Register `def add(group)`, which adds arguments shared by every transcribing command."""
    _option_groups.append(add)
    return add


def add_transcribe_options(parser: argparse.ArgumentParser) -> None:
    """Add every registered option group to `parser` (used by `transcribe`, `watch`, ...)."""
    group = parser.add_argument_group("transcription options")
    for add in _option_groups:
        add(group)


# Postprocessors ---------------------------------------------------------------


def postprocessor(order: int) -> Callable[[Postprocessor], Postprocessor]:
    """Register `def fn(t, o) -> Transcript`; lower `order` runs first.

    Orders in use: 10 silence guard, 20 find-and-replace, 30 fillers, 50 LLM mode.
    """

    def decorate(fn: Postprocessor) -> Postprocessor:
        _postprocessors.append((order, fn))
        return fn

    return decorate


def postprocessors() -> list[Postprocessor]:
    return [fn for _, fn in sorted(_postprocessors, key=lambda item: item[0])]


# Option checks ------------------------------------------------------------------


def option_check(fn: OptionCheck) -> OptionCheck:
    """Register `def fn(options)`, which raises `SttError` for options that cannot work.

    The pipeline runs every check before any audio work, so a typo fails at once
    instead of after a full transcription.
    """
    _option_checks.append(fn)
    return fn


def check_options(options: TranscribeOptions) -> None:
    for fn in _option_checks:
        fn(options)


# Options from the command line --------------------------------------------------

_FIELDS = {f.name for f in dataclasses.fields(TranscribeOptions)}


def _freeze(value: object) -> object:
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value


def _from_config(cfg: dict) -> dict:
    values: dict = {}
    for key, value in cfg.get("transcribe", {}).items():
        if key not in _FIELDS:
            raise SttError(f"{config.config_path()}: [transcribe] has an unknown option {key!r}")
        values[key] = _freeze(value)
    if "replace" in cfg:
        values["replacements"] = tuple((str(k), str(v)) for k, v in cfg["replace"].items())
    if "fillers" in cfg:
        defaults = TranscribeOptions().fillers
        values["fillers"] = defaults | {lang: tuple(words) for lang, words in cfg["fillers"].items()}
    return values


def options_from_args(ns: argparse.Namespace, cfg: dict | None = None) -> TranscribeOptions:
    """Build options with precedence: command line > config.toml > `TranscribeOptions` defaults.

    Only attributes named like a field and not `None` count; lists become tuples.
    Find-and-replace pairs from the command line are added to those from `[replace]`
    (the command line wins when both define the same word).
    """
    if cfg is None:
        cfg = config.load_config()
    values = _from_config(cfg)
    given = {key: _freeze(value) for key, value in vars(ns).items() if key in _FIELDS and value is not None}
    if "replacements" in given and "replacements" in values:
        merged = {src.lower(): (src, dst) for src, dst in values["replacements"]}
        merged |= {src.lower(): (src, dst) for src, dst in given["replacements"]}
        given["replacements"] = tuple(merged.values())
    return TranscribeOptions(**(values | given))
