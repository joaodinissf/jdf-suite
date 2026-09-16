"""Tests for the tool table and `jdf-hooks doctor`."""

import sys
from pathlib import Path

import pytest

from jdf_hooks import tools
from jdf_hooks.cli import main
from jdf_hooks.generate import LANGUAGE_FRAGMENTS, generate_configs
from jdf_hooks.tools import MANAGER_TOOLS, TOOLS_BY_LANGUAGE, Tool, missing_tools, required_tools


def test_every_language_has_tools():
    assert set(TOOLS_BY_LANGUAGE) == set(LANGUAGE_FRAGMENTS)
    assert all(t.install for lang in TOOLS_BY_LANGUAGE.values() for t in lang)


def test_required_tools_managers_first_and_deduplicated():
    names = [t.name for t in required_tools({"python", "rust"}, "both")]
    assert names[:2] == ["lefthook", "pre-commit"]
    assert names[2:] == ["pycln", "isort", "ruff", "ty", "rustfmt", "cargo"]
    assert len(names) == len(set(names))
    assert [t.name for t in required_tools({"python"}, "lefthook")][:1] == ["lefthook"]
    assert "pre-commit" not in [t.name for t in required_tools({"python"}, "lefthook")]


def test_missing_tools_uses_which(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(tools.shutil, "which", lambda name: None if name == "ty" else f"/usr/bin/{name}")
    assert [t.name for t in missing_tools({"python"}, "lefthook")] == ["ty"]


def test_tool_binary_override():
    assert Tool("clippy", "x", binary="cargo").executable == "cargo"
    assert MANAGER_TOOLS["lefthook"].executable == "lefthook"


class TestDoctorCli:
    def run(self, monkeypatch, *argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["jdf-hooks", *argv])
        return main()

    def test_all_installed_exit_0(self, tmp_path: Path, monkeypatch, capsys):
        generate_configs(tmp_path, {"python"}, "lefthook")
        monkeypatch.setattr(tools.shutil, "which", lambda name: f"/usr/bin/{name}")
        assert self.run(monkeypatch, "doctor", str(tmp_path)) == 0
        out = capsys.readouterr().out
        assert "Hook set from .jdf-hooks.lock: python (lefthook)" in out
        assert "All tools installed" in out
        assert "pre-commit" not in out

    def test_missing_exit_1_with_hint(self, tmp_path: Path, monkeypatch, capsys):
        generate_configs(tmp_path, {"python"}, "lefthook")
        monkeypatch.setattr(tools.shutil, "which", lambda name: None if name == "ruff" else "/usr/bin/x")
        assert self.run(monkeypatch, "doctor", str(tmp_path)) == 1
        out = capsys.readouterr().out
        assert "ruff  →  uv tool install ruff" in out
        assert "1 tool(s) missing" in out

    def test_no_lock_uses_detection(self, tmp_path: Path, monkeypatch, capsys):
        (tmp_path / "Cargo.toml").write_text("[package]\n")
        monkeypatch.setattr(tools.shutil, "which", lambda name: "/usr/bin/x")
        assert self.run(monkeypatch, "doctor", str(tmp_path)) == 0
        out = capsys.readouterr().out
        assert "No .jdf-hooks.lock" in out
        assert "rustfmt" in out and "keep-sorted" in out

    def test_invalid_lock_exit_2(self, tmp_path: Path, monkeypatch):
        (tmp_path / ".jdf-hooks.lock").write_text("{")
        assert self.run(monkeypatch, "doctor", str(tmp_path)) == 2
