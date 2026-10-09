"""`jdf-stt status [transcription options]`: the effective settings as JSON, for the menu-bar app.

The same precedence as a transcription (command line > config.toml > defaults), so the app's
offline indicator checks the model, VAD model and LLM URL that a dictation would really use.
"""

from __future__ import annotations

import argparse
import json

from jdf_stt import llm, models, registry


@registry.command("status", help="Print the effective model, VAD model and LLM mode as JSON (for the app).")
def setup(parser: argparse.ArgumentParser):
    registry.add_transcribe_options(parser)

    def run(ns: argparse.Namespace) -> int:
        o = registry.options_from_args(ns)
        vad_model = o.vad_model if o.vad and o.engine == "whisper-cpp" else None
        status = {
            "model": o.model,
            "model_downloaded": models.resolve(o.model).is_file(),
            "vad_model": vad_model,
            "vad_model_downloaded": vad_model is not None and models.resolve(vad_model).is_file(),
            "mode": o.mode,
            "llm_url": llm.base_url(o) if o.mode else None,
        }
        print(json.dumps(status))
        return 0

    return run
