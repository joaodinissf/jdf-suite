"""Tests for the newer-version hint."""

import io
import sys
from pathlib import Path

import pytest

from jdf_hooks import __version__, pypi
from jdf_hooks.cli import main
from jdf_hooks.generate import generate_configs


@pytest.mark.parametrize(
    ("candidate", "installed", "newer"),
    [
        ("1.4.1", "1.4.0", True),
        ("1.10.0", "1.9.9", True),
        ("1.4.0", "1.4.0", False),
        ("1.3.9", "1.4.0", False),
        ("2.0.0rc1", "1.9", True),
    ],
)
def test_is_newer(candidate: str, installed: str, newer: bool):
    assert pypi.is_newer(candidate, installed) is newer


def test_latest_version_never_raises():
    # conftest makes urlopen raise OSError
    assert pypi.latest_version() is None


def test_latest_version_parses_json(monkeypatch: pytest.MonkeyPatch):
    payload = io.BytesIO(b'{"info": {"version": "9.9.9"}}')  # BytesIO is a context manager
    monkeypatch.setattr(pypi.urllib.request, "urlopen", lambda url, timeout: payload)
    assert pypi.latest_version() == "9.9.9"


@pytest.mark.parametrize(("value", "expected"), [("1", True), ("true", True), ("0", False), ("", False)])
def test_offline_env(monkeypatch: pytest.MonkeyPatch, value: str, expected: bool):
    monkeypatch.setenv(pypi.OFFLINE_ENV, value)
    assert pypi.offline_requested() is expected


class TestCheckHint:
    def run(self, monkeypatch, *argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["jdf-hooks", *argv])
        return main()

    def test_hint_when_newer(self, tmp_path: Path, monkeypatch, capsys):
        generate_configs(tmp_path, {"python"}, "lefthook")
        monkeypatch.setattr(pypi, "latest_version", lambda timeout=2.0: "99.0.0")
        assert self.run(monkeypatch, "check", str(tmp_path)) == 0  # never affects the exit code
        assert f"jdf-hooks 99.0.0 is available (installed {__version__})" in capsys.readouterr().out

    def test_no_hint_when_current_or_offline(self, tmp_path: Path, monkeypatch, capsys):
        generate_configs(tmp_path, {"python"}, "lefthook")
        monkeypatch.setattr(pypi, "latest_version", lambda timeout=2.0: __version__)
        self.run(monkeypatch, "check", str(tmp_path))
        assert "is available" not in capsys.readouterr().out

        calls: list[float] = []
        monkeypatch.setattr(pypi, "latest_version", lambda timeout=2.0: calls.append(timeout) or "99.0.0")
        self.run(monkeypatch, "check", "--offline", str(tmp_path))
        monkeypatch.setenv(pypi.OFFLINE_ENV, "1")
        self.run(monkeypatch, "check", str(tmp_path))
        assert calls == []
