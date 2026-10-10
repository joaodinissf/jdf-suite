"""`jdf-stt models list|download|path`: what is on disk, fetching a model, where it lives."""

from __future__ import annotations

import argparse
import sys

from jdf_stt import config, models, registry


def _list() -> int:
    print(f"{'NAME':<16} {'SIZE':>8}  {'STATUS':<10}  FILE")
    for name, info in models.MODELS.items():
        status = "downloaded" if models.is_downloaded(name) else "missing"
        note = ""
        if name == models.DEFAULT_MODEL:
            note = "  (default)"
        elif name == models.DEFAULT_VAD:
            note = "  (default VAD)"
        print(f"{name:<16} {models.human_size(info.size):>8}  {status:<10}  {info.file}{note}")
    print(f"\nModels directory: {config.models_dir()}")
    return 0


def _download(names: list[str]) -> int:
    for name in names:
        if models.is_downloaded(name):
            print(f"{name}: already downloaded", file=sys.stderr)
        print(models.ensure(name, download=True))
    return 0


@registry.command("models", help="List, download or locate models (the only command that uses the network).")
def setup(parser: argparse.ArgumentParser):
    sub = parser.add_subparsers(dest="models_action", metavar="ACTION")
    sub.add_parser("list", help="every known model with its size and whether it is downloaded")
    dl = sub.add_parser("download", help="download models (sha256-checked) into the models directory")
    dl.add_argument("names", nargs="+", metavar="NAME")
    path = sub.add_parser("path", help="the models directory, or where a model's file lives")
    path.add_argument("name", nargs="?", metavar="NAME")

    def run(ns: argparse.Namespace) -> int:
        action = ns.models_action or "list"
        if action == "download":
            return _download(ns.names)
        if action == "path":
            print(models.resolve(ns.name) if ns.name else config.models_dir())
            return 0
        return _list()

    return run
