"""Shared types: the options every engine and feature reads, and the transcript they return.

Frozen after PR 01: features add behaviour, not fields.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def _default_fillers() -> dict[str, tuple[str, ...]]:
    return {"en": ("um", "uh", "erm", "er", "ah", "hmm")}


@dataclass(frozen=True)
class TranscribeOptions:
    engine: str = "whisper-cpp"
    model: str = "small"  # registry name or a file path
    threads: int | None = None
    language: str = "auto"  # -l; "auto" detects
    expected_languages: tuple[str, ...] = ()  # retry with [0] if detection falls outside
    vad: bool = True
    vad_model: str = "silero-v6.2.0"  # registry name or path
    vad_threshold: float = 0.5
    no_speech_threshold: float = 0.6  # -nth
    suppress_nst: bool = True  # -sns
    prompt: str = ""  # free text for --prompt
    vocabulary: tuple[str, ...] = ()  # terms appended to the prompt
    replacements: tuple[tuple[str, str], ...] = ()  # whole-word, case-insensitive
    remove_fillers: bool = True
    fillers: dict[str, tuple[str, ...]] = field(default_factory=_default_fillers)
    formats: tuple[str, ...] = ("txt",)  # txt srt vtt json
    output_dir: str | None = None  # None: stdout for one input + one format
    mic: bool = False
    mic_input: tuple[str, ...] = ()  # ffmpeg input args; () = avfoundation default. Tests pass lavfi.
    until_silence: bool = False
    silence_seconds: float = 1.5
    keep_audio: str | None = None  # path to keep the recording; default: deleted
    mode: str | None = None  # local-LLM rewrite mode
    llm_backend: str = "llama.cpp"  # or "ollama"
    llm_url: str = "http://127.0.0.1:8080"  # Ollama default http://127.0.0.1:11434
    llm_model: str | None = None

    def effective_prompt(self) -> str:
        """The text passed as whisper's --prompt: the free prompt, then `Names in this recording: a, b.`

        Whisper ignores a bare list of terms as the prompt but follows the same terms inside a
        sentence (seen with large-v3-turbo on two `say` clips), so the vocabulary is wrapped.
        """
        terms = ", ".join(term.strip() for term in self.vocabulary if term.strip())
        glossary = f"Names in this recording: {terms}." if terms else ""
        return " ".join(part for part in (self.prompt.strip(), glossary) if part)


@dataclass(frozen=True)
class Segment:
    start: float  # seconds
    end: float  # seconds
    text: str


@dataclass(frozen=True)
class Transcript:
    text: str
    segments: tuple[Segment, ...]
    language: str | None
    engine: str
    model: str
    duration: float | None = None  # seconds of audio

    def to_dict(self) -> dict:
        """THE json contract, shared by `--format json`, the MCP server and the Swift app."""
        return {
            "text": self.text.strip(),
            "language": self.language,
            "engine": self.engine,
            "model": self.model,
            "duration": None if self.duration is None else float(self.duration),
            "segments": [{"start": float(s.start), "end": float(s.end), "text": s.text.strip()} for s in self.segments],
        }


class SttError(Exception):
    """A problem the user can act on: the message is shown as is and the CLI exits 1."""


class ToolMissing(SttError):  # noqa: N818 (name fixed by the spec)
    """A required program (whisper-cli, ffmpeg, ...) is not on PATH."""


class Cancelled(SttError):  # noqa: N818 (name fixed by the spec)
    """The user cancelled (Esc, Ctrl+C, EOF from the app). The CLI exits 130."""
