"""JDF Hooks - Interactive CLI for setting up Git hooks."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("jdf-hooks")
except PackageNotFoundError:  # running from a source checkout without an install
    __version__ = "0.0.0+unknown"

from .cli import main

__all__ = ["main", "__version__"]
