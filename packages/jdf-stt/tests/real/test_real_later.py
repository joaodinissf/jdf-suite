"""Real runs for PR 12: whisper-bench and `jdf-stt bench` with the local turbo model."""

import re

import pytest

from jdf_stt import registry

pytestmark = pytest.mark.real


def test_bench_raw_with_the_real_whisper_bench(cli, real_model):
    r = cli("bench", "--raw", "-m", real_model)
    assert r.code == 0, r.err
    assert re.search(r"^encode\s+\d+\.\d+ ms$", r.out, re.M)
    assert re.search(r"^total\s+\d+\.\d+ ms$", r.out, re.M)


def test_bench_a_real_transcription(cli, real_model, say_wav):
    if "whisper-cpp" not in registry.engine_names():
        pytest.skip("needs PR 02's whisper-cli engine and audio preparation (runs after rebasing onto 02)")
    wav = say_wav("Benchmarks tell you how long a transcription takes on this Mac.")
    r = cli("bench", wav, "-m", real_model)
    assert r.code == 0, r.err
    m = re.search(r"^real-time factor\s+(\d+\.\d+) \(", r.out, re.M)
    assert m, r.out
    assert float(m.group(1)) > 0  # not < 1: a loaded machine (or a cold first load) can be slower than real time
