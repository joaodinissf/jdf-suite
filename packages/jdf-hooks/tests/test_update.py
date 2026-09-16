"""Tests for `jdf-hooks update`."""

import shutil
import sys
from pathlib import Path

import pytest

import jdf_hooks
from jdf_hooks.check import FileState, UnmanagedProjectError, check_project
from jdf_hooks.cli import UPDATE_OK, UPDATE_REFUSED, UPDATE_UNMANAGED, main
from jdf_hooks.generate import generate_configs, get_templates_dir
from jdf_hooks.lock import LOCK_FILENAME, read_lock
from jdf_hooks.update import ModifiedFilesError, apply_update, plan_update

LANGUAGES = {"python", "markdown", "general"}
MD_CONFIG = "configs/markdown/markdownlint.json"


@pytest.fixture
def project(tmp_path: Path) -> Path:
    target = tmp_path / "proj"
    target.mkdir()
    generate_configs(target, LANGUAGES, "both")
    return target


@pytest.fixture
def modified_templates(tmp_path: Path) -> Path:
    dest = tmp_path / "templates"
    shutil.copytree(get_templates_dir(), dest)
    fragment = dest / "lefthook" / "python.yml"
    fragment.write_text(fragment.read_text() + "      - name: extra\n        run: echo extra\n")
    return dest


def lock_of(project: Path):
    lock = read_lock(project)
    assert lock is not None
    return lock


class TestPlan:
    def test_fresh_project_is_noop(self, project: Path):
        plan = plan_update(project)
        assert plan.is_noop(force=False)
        assert plan.blocked == []
        assert plan.to_delete == []
        assert plan.languages == sorted(LANGUAGES)

    def test_stale_template_is_written(self, project: Path, modified_templates: Path):
        plan = plan_update(project, templates_dir=modified_templates)
        assert plan.to_write(force=False) == ["lefthook.yml"]
        assert not plan.is_noop(force=False)

    def test_modified_is_blocked_unless_forced(self, project: Path):
        (project / "lefthook.yml").write_text("# mine\n")
        plan = plan_update(project)
        assert plan.blocked == ["lefthook.yml"]
        assert plan.to_write(force=False) == []
        assert plan.to_write(force=True) == ["lefthook.yml"]

    def test_add_and_remove_languages(self, project: Path):
        plan = plan_update(project, add={"rust"}, remove={"markdown"})
        assert plan.languages == ["general", "python", "rust"]
        assert plan.languages_changed
        assert plan.to_delete == [MD_CONFIG]
        assert set(plan.to_write(force=False)) == {"lefthook.yml", ".pre-commit-config.yaml"}

    def test_unknown_language(self, project: Path):
        with pytest.raises(ValueError, match="bogus"):
            plan_update(project, add={"bogus"})

    def test_unmanaged(self, tmp_path: Path):
        with pytest.raises(UnmanagedProjectError):
            plan_update(tmp_path)


class TestApply:
    def test_noop_leaves_lock_identical(self, project: Path):
        before = (project / LOCK_FILENAME).read_text()
        result = apply_update(project, plan_update(project))
        assert result.written == [] and result.deleted == []
        assert (project / LOCK_FILENAME).read_text() == before

    def test_stale_file_is_regenerated_and_lock_refreshed(self, project: Path, modified_templates: Path):
        old_hash = lock_of(project).files["lefthook.yml"]
        plan = plan_update(project, templates_dir=modified_templates)
        result = apply_update(project, plan, templates_dir=modified_templates)
        assert result.written == ["lefthook.yml"]
        assert "echo extra" in (project / "lefthook.yml").read_text()
        assert lock_of(project).files["lefthook.yml"] != old_hash
        assert not check_project(project, templates_dir=modified_templates).has_drift

    def test_missing_file_is_restored(self, project: Path):
        (project / MD_CONFIG).unlink()
        result = apply_update(project, plan_update(project))
        assert result.written == [MD_CONFIG]
        assert (project / MD_CONFIG).exists()

    def test_modified_refused_and_untouched(self, project: Path):
        (project / "lefthook.yml").write_text("# mine\n")
        (project / MD_CONFIG).unlink()  # would otherwise be restored
        with pytest.raises(ModifiedFilesError) as exc:
            apply_update(project, plan_update(project))
        assert exc.value.paths == ["lefthook.yml"]
        assert (project / "lefthook.yml").read_text() == "# mine\n"
        assert not (project / MD_CONFIG).exists()

    def test_force_overwrites(self, project: Path):
        (project / "lefthook.yml").write_text("# mine\n")
        result = apply_update(project, plan_update(project), force=True)
        assert result.written == ["lefthook.yml"]
        assert "# mine" not in (project / "lefthook.yml").read_text()
        assert not check_project(project).has_drift

    def test_remove_language_deletes_config_and_prunes_dirs(self, project: Path):
        plan = plan_update(project, remove={"markdown"})
        result = apply_update(project, plan)
        assert result.deleted == [MD_CONFIG]
        assert not (project / "configs").exists()
        lock = lock_of(project)
        assert lock.languages == ["general", "python"]
        assert MD_CONFIG not in lock.files
        assert "MARKDOWN" not in (project / "lefthook.yml").read_text()

    def test_add_language_updates_hooks_and_lock(self, project: Path):
        apply_update(project, plan_update(project, add={"rust"}))
        assert "rust" in lock_of(project).languages
        assert "RUST" in (project / "lefthook.yml").read_text()
        assert not check_project(project).has_drift


class TestVersionRestamp:
    def test_newer_tool_restamps_lock(self, project: Path, monkeypatch, capsys):
        lock_path = project / LOCK_FILENAME
        lock_path.write_text(lock_path.read_text().replace(jdf_hooks.__version__, "0.9.0"))
        plan = plan_update(project)
        assert not plan.is_noop(force=False)
        assert plan.to_write(force=False) == []
        monkeypatch.setattr(sys, "argv", ["jdf-hooks", "update", str(project)])
        assert main() == UPDATE_OK
        assert "re-stamping" in capsys.readouterr().out
        assert lock_of(project).jdf_hooks == jdf_hooks.__version__


class TestObsoleteState:
    def test_check_reports_obsolete_with_language_override(self, project: Path):
        states = {f.path: f.state for f in check_project(project, languages={"python", "general"}).files}
        assert states[MD_CONFIG] is FileState.OBSOLETE


class TestCli:
    def run(self, monkeypatch, *argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["jdf-hooks", *argv])
        return main()

    def test_noop_exit_0(self, project: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "update", str(project)) == UPDATE_OK
        assert "Nothing to update" in capsys.readouterr().out

    def test_refused_exit_1(self, project: Path, monkeypatch, capsys):
        (project / "lefthook.yml").write_text("# mine\n")
        assert self.run(monkeypatch, "update", str(project)) == UPDATE_REFUSED
        out = capsys.readouterr().out
        assert "Refusing to overwrite" in out and "--force" in out
        assert (project / "lefthook.yml").read_text() == "# mine\n"

    def test_force_exit_0(self, project: Path, monkeypatch, capsys):
        (project / "lefthook.yml").write_text("# mine\n")
        assert self.run(monkeypatch, "update", "--force", str(project)) == UPDATE_OK
        assert "Updated lefthook.yml" in capsys.readouterr().out

    def test_dry_run_writes_nothing(self, project: Path, monkeypatch, capsys):
        before = (project / "lefthook.yml").read_text()
        assert self.run(monkeypatch, "update", "--add", "rust", "--dry-run", str(project)) == UPDATE_REFUSED
        out = capsys.readouterr().out
        assert "Dry run" in out and "write  lefthook.yml" in out
        assert (project / "lefthook.yml").read_text() == before
        assert "rust" not in lock_of(project).languages

    def test_dry_run_clean_exit_0(self, project: Path, monkeypatch):
        assert self.run(monkeypatch, "update", "--dry-run", str(project)) == UPDATE_OK

    def test_add_remove_exit_0(self, project: Path, monkeypatch, capsys):
        code = self.run(monkeypatch, "update", "--add", "rust", "--remove", "markdown", str(project))
        assert code == UPDATE_OK
        out = capsys.readouterr().out
        assert f"Removed {MD_CONFIG}" in out
        assert "Languages: general, markdown, python → general, python, rust" in out
        assert lock_of(project).languages == ["general", "python", "rust"]

    def test_unknown_language_exit_2(self, project: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "update", "--add", "bogus", str(project)) == UPDATE_UNMANAGED
        assert "Unknown language" in capsys.readouterr().out

    def test_unmanaged_exit_2(self, tmp_path: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "update", str(tmp_path)) == UPDATE_UNMANAGED
        assert LOCK_FILENAME in capsys.readouterr().out

    def test_detection_hint(self, project: Path, monkeypatch, capsys):
        (project / "Cargo.toml").write_text("[package]\n")
        self.run(monkeypatch, "check", str(project))
        assert "Detected Rust (Cargo.toml)" in capsys.readouterr().out
        # After adding rust the hint must be gone (computed from the new set, not the old lock).
        self.run(monkeypatch, "update", "--add", "rust", str(project))
        assert "Detected Rust" not in capsys.readouterr().out
