"""Tests for `jdf-hooks adopt`."""

import sys
from pathlib import Path

import pytest

from jdf_hooks.adopt import AlreadyManagedError, NothingToAdoptError, apply_adoption, plan_adoption, section_headers
from jdf_hooks.check import FileState, check_project
from jdf_hooks.cli import main
from jdf_hooks.generate import LANGUAGE_FRAGMENTS, generate_configs, render_lefthook, render_precommit
from jdf_hooks.lock import LOCK_FILENAME, read_lock
from jdf_hooks.update import apply_update, plan_update


@pytest.fixture
def legacy(tmp_path: Path) -> Path:
    """A project with hook files but no lock, as jdf-hooks < 1.2.0 left it — with slightly older content."""
    (tmp_path / "lefthook.yml").write_text(
        render_lefthook({"python", "general"}).replace("ruff format", "ruff  format")
    )
    (tmp_path / ".pre-commit-config.yaml").write_text(render_precommit({"python", "general"}))
    return tmp_path


def test_section_headers_cover_every_language():
    assert set(section_headers().values()) == set(LANGUAGE_FRAGMENTS)


class TestPlan:
    def test_infers_manager_and_languages(self, legacy: Path):
        adoption = plan_adoption(legacy)
        assert adoption.manager == "both"
        assert adoption.languages == ["general", "python"]
        assert adoption.files == ["lefthook.yml", ".pre-commit-config.yaml"]

    def test_single_manager(self, legacy: Path):
        (legacy / ".pre-commit-config.yaml").unlink()
        assert plan_adoption(legacy).manager == "lefthook"

    def test_records_existing_config_files(self, tmp_path: Path):
        generate_configs(tmp_path, {"markdown"}, "lefthook")
        (tmp_path / LOCK_FILENAME).unlink()
        assert plan_adoption(tmp_path).files == ["lefthook.yml", "configs/markdown/markdownlint.json"]

    def test_overrides(self, legacy: Path):
        adoption = plan_adoption(legacy, manager="lefthook", languages={"python"})
        assert adoption.manager == "lefthook"
        assert adoption.languages == ["python"]
        assert adoption.files == ["lefthook.yml"]

    def test_manager_file_missing(self, legacy: Path):
        (legacy / ".pre-commit-config.yaml").unlink()
        with pytest.raises(ValueError, match="pre-commit-config"):
            plan_adoption(legacy, manager="both")

    def test_unknown_language(self, legacy: Path):
        with pytest.raises(ValueError, match="bogus"):
            plan_adoption(legacy, languages={"bogus"})

    def test_nothing_to_adopt(self, tmp_path: Path):
        with pytest.raises(NothingToAdoptError):
            plan_adoption(tmp_path)

    def test_already_managed(self, tmp_path: Path):
        generate_configs(tmp_path, {"python"}, "lefthook")
        with pytest.raises(AlreadyManagedError):
            plan_adoption(tmp_path)

    def test_no_headers_found(self, tmp_path: Path):
        (tmp_path / "lefthook.yml").write_text("pre-commit:\n  jobs: []\n")
        with pytest.raises(ValueError, match="--languages"):
            plan_adoption(tmp_path)


class TestApplyThenUpdate:
    def test_adopt_records_as_is_then_update_brings_forward(self, legacy: Path):
        apply_adoption(legacy, plan_adoption(legacy))
        lock = read_lock(legacy)
        assert lock is not None and lock.languages == ["general", "python"]

        states = {f.path: f.state for f in check_project(legacy).files}
        assert states["lefthook.yml"] is FileState.UPDATE_AVAILABLE  # old content, not "modified"
        assert states[".pre-commit-config.yaml"] is FileState.UP_TO_DATE

        result = apply_update(legacy, plan_update(legacy))
        assert result.written == ["lefthook.yml"]
        assert not check_project(legacy).has_drift


class TestCli:
    def run(self, monkeypatch, *argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["jdf-hooks", *argv])
        return main()

    def test_adopt_exit_0(self, legacy: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "adopt", str(legacy)) == 0
        out = capsys.readouterr().out
        assert "Manager: both; languages: general, python" in out
        assert f"Created {LOCK_FILENAME}" in out
        assert read_lock(legacy) is not None

    def test_dry_run_writes_nothing(self, legacy: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "adopt", "--dry-run", str(legacy)) == 0
        assert "Dry run" in capsys.readouterr().out
        assert read_lock(legacy) is None

    def test_errors_exit_2(self, tmp_path: Path, legacy: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "adopt", str(tmp_path / "nope")) == 2
        assert self.run(monkeypatch, "adopt", "--languages", "bogus", str(legacy)) == 2
        assert "bogus" in capsys.readouterr().out
        assert self.run(monkeypatch, "adopt", str(legacy)) == 0
        assert self.run(monkeypatch, "adopt", str(legacy)) == 2

    def test_check_hint_mentions_adopt(self, legacy: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "check", str(legacy)) == 2
        assert "jdf-hooks adopt" in capsys.readouterr().out
