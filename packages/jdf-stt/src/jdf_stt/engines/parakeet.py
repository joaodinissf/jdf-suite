"""NVIDIA Parakeet through whisper.cpp's `parakeet-cli`, in the engine slot as `--engine parakeet`.

`parakeet-cli -m MODEL -f WAV -np -ps [-t N]`. There is no model registry entry and no
download: `--model` must be the path of a ggml Parakeet model. Parakeet reports no language.

The segment lines are parsed from the format the binary prints with `-ps`
(`Segment %d: [%lld -> %lld] "%s"`, read from its format strings). Their time unit is assumed
to be centiseconds, like whisper.cpp's; that is unchecked until a real run with a model.
"""

from __future__ import annotations

import re
from pathlib import Path

from jdf_stt import procs, registry
from jdf_stt.types import Segment, SttError, ToolMissing, TranscribeOptions, Transcript

_SEGMENT = re.compile(r'^Segment \d+: \[(-?\d+) -> (-?\d+)\] "(.*)"$')
_UNIT = 0.01  # seconds per t0/t1 tick (assumed, as in whisper.cpp)


def parse_segments(stdout: str) -> tuple[Segment, ...]:
    segments = []
    for line in stdout.splitlines():
        m = _SEGMENT.match(line.strip())
        if m and m.group(3).strip():
            segments.append(Segment(int(m.group(1)) * _UNIT, int(m.group(2)) * _UNIT, m.group(3).strip()))
    return tuple(segments)


class ParakeetEngine:
    name = "parakeet"

    def transcribe(self, audio_path: Path, options: TranscribeOptions) -> Transcript:
        model = Path(options.model).expanduser()
        if not model.is_file():
            raise SttError(
                f"the parakeet engine needs --model PATH to a ggml Parakeet model (got {options.model!r}); "
                "jdf-stt does not download Parakeet models"
            )
        try:
            exe = procs.require_tool("parakeet-cli")
        except ToolMissing:
            raise ToolMissing("parakeet-cli not found. Install: brew install whisper-cpp") from None
        cmd = [exe, "-m", str(model), "-f", str(audio_path), "-np", "-ps"]
        if options.threads:
            cmd += ["-t", str(options.threads)]
        segments = parse_segments(procs.run(cmd).stdout)
        text = " ".join(s.text for s in segments)
        return Transcript(text, segments, None, self.name, model.name)


registry.register_engine("parakeet", ParakeetEngine)
