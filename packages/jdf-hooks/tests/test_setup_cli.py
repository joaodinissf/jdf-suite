"""Tests for non-interactive `jdf-hooks setup` and the generated GitHub workflow."""

import sys
from pathlib import Path

import pytest
import yaml

from jdf_hooks.check import FileState, check_project
from jdf_hooks.cli import main
from jdf_hooks.generate import GITHUB_WORKFLOW_FILENAME, generate_configs, render_all
from jdf_hooks.lock import read_lock
from jdf_hooks.update import apply_update, plan_update


def run(monkeypatch: pytest.MonkeyPatch, *argv: str) -> int:
    monkeypatch.setattr(sys, "argv", ["jdf-hooks", *argv])
    return main()


class TestNonInteractiveSetup:
    def test_languages_and_manager(self, tmp_path: Path, monkeypatch, capsys):
        assert run(monkeypatch, "setup", "--languages", "python,general", "--manager", "lefthook", str(tmp_path)) == 0
        lock = read_lock(tmp_path)
        assert lock is not None
        assert lock.languages == ["general", "python"]
        assert lock.manager == "lefthook"
        assert (tmp_path / "lefthook.yml").exists()
        assert not (tmp_path / ".pre-commit-config.yaml").exists()
        assert "Languages: general, python; manager: lefthook" in capsys.readouterr().out

    def test_auto_uses_detection_plus_general(self, tmp_path: Path, monkeypatch):
        (tmp_path / "Cargo.toml").write_text("[package]\n")
        assert run(monkeypatch, "setup", "--languages", "auto", str(tmp_path)) == 0
        lock = read_lock(tmp_path)
        assert lock is not None
        assert lock.languages == ["general", "rust", "toml"]
        assert lock.manager == "both"

    def test_unknown_language_exit_2(self, tmp_path: Path, monkeypatch, capsys):
        assert run(monkeypatch, "setup", "--languages", "python,bogus", str(tmp_path)) == 2
        assert "Unknown language(s): bogus" in capsys.readouterr().out
        assert read_lock(tmp_path) is None

    def test_existing_files_need_yes(self, tmp_path: Path, monkeypatch, capsys):
        generate_configs(tmp_path, {"python"}, "lefthook")
        monkeypatch.setattr(sys.stdin, "isatty", lambda: False)
        assert run(monkeypatch, "setup", "--languages", "python", str(tmp_path)) == 1
        assert "pass --yes" in capsys.readouterr().out
        assert run(monkeypatch, "setup", "--languages", "rust", "--yes", str(tmp_path)) == 0
        lock = read_lock(tmp_path)
        assert lock is not None and lock.languages == ["rust"]

    def test_missing_directory(self, tmp_path: Path, monkeypatch):
        assert run(monkeypatch, "setup", "--languages", "python", str(tmp_path / "nope")) == 1


class TestGithubWorkflow:
    def test_setup_writes_workflow_and_option(self, tmp_path: Path, monkeypatch):
        assert run(monkeypatch, "setup", "--languages", "python", "--github-workflow", str(tmp_path)) == 0
        workflow = tmp_path / GITHUB_WORKFLOW_FILENAME
        assert workflow.exists()
        data = yaml.safe_load(workflow.read_text())
        assert "uvx jdf-hooks check" in str(data["jobs"]["check"]["steps"])
        lock = read_lock(tmp_path)
        assert lock is not None
        assert lock.options == {"github_workflow": True}
        assert GITHUB_WORKFLOW_FILENAME in lock.files
        assert not check_project(tmp_path).has_drift

    def test_render_all_includes_workflow_only_when_asked(self):
        assert GITHUB_WORKFLOW_FILENAME not in render_all({"python"}, "lefthook")
        assert GITHUB_WORKFLOW_FILENAME in render_all({"python"}, "lefthook", github_workflow=True)

    def test_update_toggles_workflow(self, tmp_path: Path, monkeypatch):
        generate_configs(tmp_path, {"python"}, "lefthook")
        assert run(monkeypatch, "update", "--github-workflow", str(tmp_path)) == 0
        assert (tmp_path / GITHUB_WORKFLOW_FILENAME).exists()
        lock = read_lock(tmp_path)
        assert lock is not None and lock.options == {"github_workflow": True}

        plan = plan_update(tmp_path, github_workflow=False)
        states = {f.path: f.state for f in plan.report.files}
        assert states[GITHUB_WORKFLOW_FILENAME] is FileState.OBSOLETE
        result = apply_update(tmp_path, plan)
        assert result.deleted == [GITHUB_WORKFLOW_FILENAME]
        assert not (tmp_path / ".github").exists()
        lock = read_lock(tmp_path)
        assert lock is not None and lock.options == {}

    def test_update_keeps_setting_by_default(self, tmp_path: Path, monkeypatch):
        generate_configs(tmp_path, {"python"}, "lefthook", github_workflow=True)
        assert run(monkeypatch, "update", str(tmp_path)) == 0
        assert (tmp_path / GITHUB_WORKFLOW_FILENAME).exists()

    def test_old_lock_without_options_still_parses(self, tmp_path: Path):
        generate_configs(tmp_path, {"python"}, "lefthook")
        lock_path = tmp_path / ".jdf-hooks.lock"
        assert '"options"' not in lock_path.read_text()
        lock = read_lock(tmp_path)
        assert lock is not None and lock.options == {}
