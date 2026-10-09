"""`jdf-stt bench`: how long a transcription takes on this machine.

`jdf-stt bench FILE` times one full transcription (audio preparation, model load, decoding,
postprocessing: what you wait for) and prints the real-time factor, wall clock / audio length.
`jdf-stt bench --raw` runs whisper.cpp's own `whisper-bench -m M -t N -w 0` and prints its timings.
"""

from __future__ import annotations

import argparse
import re
import time
from pathlib import Path

from jdf_stt import pipeline, procs, registry
from jdf_stt.features.live import model_path
from jdf_stt.types import SttError

_TIMING = re.compile(r"whisper_print_timings:\s+(\w+) time =\s+([\d.]+) ms")


def parse_timings(stderr: str) -> dict[str, float]:
    """`{"load": 1552.03, "encode": 734.0, ..., "total": 2220.7}` from whisper-bench's stderr."""
    return {name: float(ms) for name, ms in _TIMING.findall(stderr)}


def _table(rows: list[tuple[str, str]]) -> str:
    width = max(len(label) for label, _ in rows) + 2
    return "\n".join(f"{label:<{width}}{value}" for label, value in rows)


def bench_file(path: Path, ns: argparse.Namespace) -> str:
    o = registry.options_from_args(ns)
    start = time.perf_counter()
    t = pipeline.transcribe_file(path, o)
    wall = time.perf_counter() - start
    factor = "n/a"
    if t.duration:
        rtf = wall / t.duration
        speed = f"{1 / rtf:.1f}x faster than real time" if rtf < 1 else "slower than real time"
        factor = f"{rtf:.2f} ({speed})"
    rows = [
        ("file", path.name),
        ("engine", t.engine),
        ("model", t.model),
        ("audio", "n/a" if t.duration is None else f"{t.duration:.2f} s"),
        ("wall clock", f"{wall:.2f} s"),
        ("real-time factor", factor),
    ]
    return _table(rows)


def bench_raw(ns: argparse.Namespace) -> str:
    o = registry.options_from_args(ns)
    model = model_path(o.model)
    threads = o.threads or 4
    proc = procs.run([procs.require_tool("whisper-bench"), "-m", str(model), "-t", str(threads), "-w", "0"])
    timings = parse_timings(proc.stderr)
    if not timings:
        raise SttError("whisper-bench printed no timings")
    rows = [("whisper-bench", f"{model.name}, {threads} threads")]
    rows += [(name, f"{ms:.2f} ms") for name, ms in timings.items()]
    return _table(rows)


@registry.command("bench", help="Measure transcription latency on this machine (real-time factor).")
def setup(parser: argparse.ArgumentParser):
    parser.add_argument("input", nargs="?", metavar="FILE", help="audio file to transcribe and time")
    parser.add_argument("-m", "--model", dest="model", default=None, help="model name or path (default: small)")
    parser.add_argument("--engine", dest="engine", default=None, help="engine (default: whisper-cpp)")
    parser.add_argument("-t", "--threads", dest="threads", type=int, default=None, help="threads")
    parser.add_argument("--raw", action="store_true", help="run whisper.cpp's whisper-bench instead of a file")

    def run(ns: argparse.Namespace) -> int:
        if ns.raw:
            print(bench_raw(ns))
        elif ns.input:
            print(bench_file(Path(ns.input), ns))
        else:
            parser.error("give a FILE to transcribe, or --raw")
        return 0

    return run
