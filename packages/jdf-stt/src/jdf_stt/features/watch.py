"""`jdf-stt watch DIR...`: audio dropped into a folder is transcribed to txt/srt/vtt/json next to it
(or into `output_dir` when one is set, e.g. in config.toml).

Plain polling with the stdlib. A file counts once its size and modification time are unchanged
across two polls (so a file still being copied or recorded waits), and it is skipped when every
requested output already exists (so a rerun does nothing new). Any error on one file is reported
and the loop goes on; that file is tried again only after it changes.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Iterable
from pathlib import Path

from jdf_stt import formats, pipeline, registry
from jdf_stt.types import SttError, TranscribeOptions

AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aiff", ".mp4", ".mov"}


def _hidden(path: Path, root: Path) -> bool:
    return any(part.startswith(".") for part in path.relative_to(root).parts)


def scan(dirs: Iterable[Path], *, recursive: bool) -> list[Path]:
    """Audio files in `dirs` (hidden files and folders left out), sorted."""
    found = []
    for root in dirs:
        candidates = root.rglob("*") if recursive else root.iterdir()
        for path in candidates:
            if path.suffix.lower() in AUDIO_EXTENSIONS and path.is_file() and not _hidden(path, root):
                found.append(path)
    return sorted(found)


def output_stem(path: Path, output_dir: str | None) -> Path:
    """`talk.m4a` -> `talk` next to it, or `<output_dir>/talk` when an output folder is set."""
    return Path(output_dir) / path.stem if output_dir else path.with_suffix("")


def is_done(path: Path, options: TranscribeOptions) -> bool:
    """True when `talk.m4a` already has `talk.<fmt>` for every requested format."""
    stem = output_stem(path, options.output_dir)
    return all(stem.with_name(f"{stem.name}.{fmt}").exists() for fmt in options.formats)


def _signature(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_size, st.st_mtime_ns)


class Watcher:
    """Remembers what each file looked like on the last poll, and which ones failed."""

    def __init__(self, dirs: list[Path], options: TranscribeOptions, *, recursive: bool) -> None:
        self.dirs = dirs
        self.options = options
        self.recursive = recursive
        self.seen: dict[Path, tuple[int, int]] = {}
        self.failed: dict[Path, tuple[int, int]] = {}
        self.errors = 0

    def poll(self) -> int:
        """One pass over the folders; returns how many files were transcribed."""
        done = 0
        current = {}
        for path in scan(self.dirs, recursive=self.recursive):
            sig = _signature(path)
            if sig is None:
                continue
            current[path] = sig
            settled = self.seen.get(path) == sig and sig[0] > 0
            if not settled or self.failed.get(path) == sig or is_done(path, self.options):
                continue
            if self._transcribe(path, sig):
                done += 1
        self.seen = current
        return done

    def _transcribe(self, path: Path, sig: tuple[int, int]) -> bool:
        try:
            t = pipeline.transcribe_file(path, self.options)
            written = formats.write_outputs(t, output_stem(path, self.options.output_dir), self.options.formats)
        except Exception as e:  # one bad file must not end the watch; Ctrl+C still gets through
            self.failed[path] = sig
            self.errors += 1
            reason = str(e) if isinstance(e, (SttError, OSError)) else f"{type(e).__name__}: {e}"
            print(f"jdf-stt: {path}: {reason}", file=sys.stderr)
            return False
        self.failed.pop(path, None)
        names = ", ".join(p.name for p in written)
        print(f"{path} -> {names}", file=sys.stderr)
        return True


@registry.command("watch", help="Transcribe audio files as they appear in folders, writing the results next to them.")
def setup(parser: argparse.ArgumentParser):
    parser.add_argument("dirs", nargs="+", metavar="DIR", type=Path, help="folders to watch")
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between polls (default 2)")
    parser.add_argument("--once", action="store_true", help="look twice (one interval apart), transcribe, exit")
    parser.add_argument("--recursive", action="store_true", help="also watch subfolders")
    registry.add_transcribe_options(parser)

    def run(ns: argparse.Namespace) -> int:
        for d in ns.dirs:
            if not d.is_dir():
                raise SttError(f"{d}: not a folder")
        options = registry.options_from_args(ns)
        watcher = Watcher(list(ns.dirs), options, recursive=ns.recursive)
        if ns.once:
            watcher.poll()
            time.sleep(ns.interval)
            watcher.poll()
            return 1 if watcher.errors else 0
        names = ", ".join(str(d) for d in ns.dirs)
        print(
            f"watching {names} every {ns.interval:g} s for {', '.join(options.formats)}; Ctrl+C stops", file=sys.stderr
        )
        try:
            while True:
                watcher.poll()
                time.sleep(ns.interval)
        except KeyboardInterrupt:
            print("jdf-stt: stopped watching", file=sys.stderr)
            return 0

    return run
