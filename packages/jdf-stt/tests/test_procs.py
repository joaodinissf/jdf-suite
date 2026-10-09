import os
import sys

import pytest

from jdf_stt import procs
from jdf_stt.types import SttError, ToolMissing


def test_run_captures_stdout_and_stderr():
    proc = procs.run([sys.executable, "-c", "import sys; print('out'); print('err', file=sys.stderr)"])
    assert proc.stdout == "out\n" and proc.stderr == "err\n"


def test_run_passes_input():
    proc = procs.run([sys.executable, "-c", "import sys; print(sys.stdin.read().upper())"], input="q\n")
    assert proc.stdout.strip() == "Q"


def test_a_child_never_reads_our_stdin():
    """Under `jdf-stt mcp` our stdin is the protocol pipe; children get /dev/null instead."""
    read, write = os.pipe()
    os.write(write, b"protocol bytes\n")
    os.close(write)  # EOF after the bytes, so a child that does read stdin cannot hang
    saved = os.dup(0)
    os.dup2(read, 0)
    try:
        proc = procs.run([sys.executable, "-c", "import sys; print(repr(sys.stdin.read()))"])
    finally:
        os.dup2(saved, 0)
        for fd in (saved, read):
            os.close(fd)
    assert proc.stdout.strip() == "''"


def test_failure_carries_the_last_stderr_lines():
    script = "import sys\nfor i in range(20): print(f'line {i}', file=sys.stderr)\nsys.exit(3)"
    with pytest.raises(SttError) as info:
        procs.run([sys.executable, "-c", script])
    message = str(info.value)
    assert "exit 3" in message and "line 19" in message and "line 12" in message
    assert "line 11" not in message


def test_failure_without_stderr():
    with pytest.raises(SttError, match=r"failed \(exit 1\)$"):
        procs.run([sys.executable, "-c", "raise SystemExit(1)"])


def test_missing_program_is_tool_missing_with_install_hint(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(ToolMissing, match="whisper-cli not found. Install: brew install whisper-cpp"):
        procs.run(["whisper-cli", "--help"])


def test_timeout():
    with pytest.raises(SttError, match="timed out after 0.2 s"):
        procs.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.2)


def test_require_tool(monkeypatch, tmp_path):
    tool = tmp_path / "ffmpeg"
    tool.write_text("#!/bin/sh\n")
    tool.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    assert procs.require_tool("ffmpeg") == str(tool)
    with pytest.raises(ToolMissing, match=r"^nothing-here not found\.$"):
        procs.require_tool("nothing-here")


def test_missing_program_by_path_is_named_by_its_basename():
    with pytest.raises(ToolMissing, match="^ffmpeg not found. Install: brew install ffmpeg$"):
        procs.run(["/nonexistent/ffmpeg", "-version"])
