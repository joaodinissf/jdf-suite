import dataclasses
from pathlib import Path

import pytest

from jdf_stt import audio, language, pipeline, registry
from jdf_stt.types import SttError, TranscribeOptions, Transcript


@pytest.fixture
def events(monkeypatch, fake_engine):
    """Record the pipeline's steps; audio.prepare writes a placeholder wav into the temp dir."""
    log = []

    def prepare(src, workdir):
        log.append(("prepare", src, workdir))
        wav = workdir / "audio.wav"
        wav.write_bytes(b"RIFF")
        return wav

    def duration(wav):
        log.append(("duration", wav))
        return 3.5

    monkeypatch.setattr(audio, "prepare", prepare)
    monkeypatch.setattr(audio, "duration", duration)
    registry._postprocessors.clear()  # only this test's postprocessors (clean_registry restores them)
    return log


def options(**kw):
    return TranscribeOptions(engine="fake", **kw)


def test_steps_run_in_order_and_the_temp_audio_is_deleted(events, fake_engine):
    for order in (30, 10, 20):

        @registry.postprocessor(order)
        def step(t, o, order=order):
            events.append(("post", order))
            return dataclasses.replace(t, text=f"{t.text}+{order}")

    t = pipeline.transcribe_file("talk.m4a", options())
    kinds = [e[0] for e in events]
    assert kinds == ["prepare", "duration", "post", "post", "post"]
    assert [e[1] for e in events if e[0] == "post"] == [10, 20, 30]
    assert t.text == "hello world+10+20+30"
    assert t.duration == 3.5

    src, workdir = events[0][1], events[0][2]
    assert src == Path("talk.m4a")
    assert fake_engine.calls[0][0] == workdir / "audio.wav"
    assert not workdir.exists()


def test_engine_duration_is_kept(events, fake_engine):
    fake_engine.respond = lambda wav, o: Transcript("x", (), "en", "fake", o.model, duration=9.0)
    assert pipeline.transcribe_file("a.wav", options()).duration == 9.0
    assert "duration" not in [e[0] for e in events]


def test_language_retry_reruns_once_with_the_returned_language(events, fake_engine, monkeypatch):
    fake_engine.detected_language = "nn"
    asked = []

    def retry(t, o):
        asked.append(t.language)
        return "pt"

    monkeypatch.setattr(language, "retry_language", retry)
    t = pipeline.transcribe_file("a.wav", options(expected_languages=("pt",)))
    assert asked == ["nn"]  # asked once, not after the rerun
    assert [o.language for _, o in fake_engine.calls] == ["auto", "pt"]
    assert t.language == "pt"


def test_no_retry_by_default(events, fake_engine):
    pipeline.transcribe_file("a.wav", options())
    assert len(fake_engine.calls) == 1


def test_temp_audio_is_deleted_when_the_engine_fails(events, fake_engine):
    def fail(wav, o):
        raise SttError("engine failed")

    fake_engine.respond = fail
    with pytest.raises(SttError, match="engine failed"):
        pipeline.transcribe_file("a.wav", options())
    assert not events[0][2].exists()


def test_unknown_engine_fails_before_any_work(events):
    with pytest.raises(SttError, match="unknown engine"):
        pipeline.transcribe_file("a.wav", TranscribeOptions(engine="nope"))
    assert events == []
