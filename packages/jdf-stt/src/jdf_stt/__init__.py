"""jdf-stt: private, local dictation and transcription for the Mac."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("jdf-stt")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0+unknown"
