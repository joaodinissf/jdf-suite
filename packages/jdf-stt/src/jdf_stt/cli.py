"""The `jdf-stt` command line, assembled from whatever the features register."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from jdf_stt import __version__, registry
from jdf_stt.types import Cancelled, SttError

DEFAULT_COMMAND = "transcribe"
_TOP_LEVEL = ("-h", "--help", "--version")


def build_parser() -> argparse.ArgumentParser:
    registry.load_features()
    parser = argparse.ArgumentParser(
        prog="jdf-stt",
        description="Private, local dictation and transcription. Nothing leaves your Mac.",
        epilog=f"With no command, `{DEFAULT_COMMAND}` is assumed: `jdf-stt talk.m4a` or `jdf-stt --mic`.",
    )
    parser.add_argument("--version", action="version", version=f"jdf-stt {__version__}")
    sub = parser.add_subparsers(title="commands", metavar="COMMAND")
    for name, (help_text, setup) in sorted(registry.commands().items()):
        child = sub.add_parser(name, help=help_text, description=help_text)
        child.set_defaults(_run=setup(child))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        parser = build_parser()
        if not args:
            parser.print_help()
            return 0
        if args[0] not in registry.commands() and args[0] not in _TOP_LEVEL:
            args.insert(0, DEFAULT_COMMAND)
        ns = parser.parse_args(args)
        return ns._run(ns) or 0
    except Cancelled as e:
        print(f"jdf-stt: {str(e) or 'cancelled'}", file=sys.stderr)
        return 130
    except SttError as e:
        print(f"jdf-stt: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("jdf-stt: cancelled", file=sys.stderr)
        return 130
