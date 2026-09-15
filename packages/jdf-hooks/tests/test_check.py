"""Tests for drift detection (`jdf-hooks check`)."""

import shutil
import sys
from pathlib import Path

import pytest

import jdf_hooks
from jdf_hooks import generate
from jdf_hooks.check import FileState, UnmanagedProjectError, check_project, diff_file
from jdf_hooks.cli import CHECK_DRIFT, CHECK_OK, CHECK_UNMANAGED, main
from jdf_hooks.generate import generate_configs, get_templates_dir
from jdf_hooks.lock import LOCK_FILENAME, read_lock

LANGUAGES = {"python", "markdown", "general"}


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A freshly generated project (both managers, python+markdown+general)."""
    target = tmp_path / "proj"
    target.mkdir()
    generate_configs(target, LANGUAGES, "both")
    return target


@pytest.fixture
def modified_templates(tmp_path: Path) -> Path:
    """A copy of the bundled templates with one lefthook fragment changed."""
    dest = tmp_path / "templates"
    shutil.copytree(get_templates_dir(), dest)
    fragment = dest / "lefthook" / "python.yml"
    fragment.write_text(fragment.read_text() + "      - name: extra\n        run: echo extra\n")
    return dest


class TestGenerateWritesLock:
    def test_lock_created(self, project: Path):
        lock = read_lock(project)
        assert lock is not None
        assert lock.jdf_hooks == jdf_hooks.__version__
        assert lock.manager == "both"
        assert lock.languages == sorted(LANGUAGES)
        assert set(lock.files) == {"lefthook.yml", ".pre-commit-config.yaml", "configs/markdown/markdownlint.json"}

    def test_generate_configs_reports_lock(self, tmp_path: Path):
        result = generate_configs(tmp_path, {"python"}, "lefthook")
        assert result["lock"] == [tmp_path / LOCK_FILENAME]
        assert [p.name for p in result["hook_files"]] == ["lefthook.yml"]
        assert result["configs"] == []


class TestCheckProject:
    def test_fresh_project_is_up_to_date(self, project: Path):
        report = check_project(project)
        assert not report.has_drift
        assert not report.version_changed
        assert {f.state for f in report.files} == {FileState.UP_TO_DATE}
        assert [f.path for f in report.files] == sorted(f.path for f in report.files)

    def test_local_edit_is_modified(self, project: Path):
        (project / "lefthook.yml").write_text((project / "lefthook.yml").read_text() + "# tweak\n")
        report = check_project(project)
        assert report.has_drift
        states = {f.path: f for f in report.files}
        assert states["lefthook.yml"].state is FileState.MODIFIED
        assert states["lefthook.yml"].stale is False
        assert states[".pre-commit-config.yaml"].state is FileState.UP_TO_DATE

    def test_deleted_file_is_missing(self, project: Path):
        (project / "configs/markdown/markdownlint.json").unlink()
        states = {f.path: f.state for f in check_project(project).files}
        assert states["configs/markdown/markdownlint.json"] is FileState.MISSING

    def test_changed_template_is_update_available(self, project: Path, modified_templates: Path):
        states = {f.path: f for f in check_project(project, templates_dir=modified_templates).files}
        assert states["lefthook.yml"].state is FileState.UPDATE_AVAILABLE
        assert states["lefthook.yml"].stale is True
        # pre-commit fragment untouched
        assert states[".pre-commit-config.yaml"].state is FileState.UP_TO_DATE

    def test_modified_and_stale(self, project: Path, modified_templates: Path):
        (project / "lefthook.yml").write_text("# rewritten\n")
        f = {f.path: f for f in check_project(project, templates_dir=modified_templates).files}["lefthook.yml"]
        assert f.state is FileState.MODIFIED
        assert f.stale is True

    def test_new_template_file_is_reported(self, project: Path, modified_templates: Path, monkeypatch):
        # Simulate a config file added to the templates after the project was generated.
        (modified_templates / "configs/python").mkdir()
        (modified_templates / "configs/python/ruff.toml").write_text("line-length = 120\n")
        monkeypatch.setitem(generate.LANGUAGE_CONFIGS, "python", ["configs/python/ruff.toml"])
        f = {f.path: f for f in check_project(project, templates_dir=modified_templates).files}
        assert f["configs/python/ruff.toml"].state is FileState.UPDATE_AVAILABLE
        assert f["configs/python/ruff.toml"].new is True

    def test_no_lock_raises(self, tmp_path: Path):
        with pytest.raises(UnmanagedProjectError):
            check_project(tmp_path)

    def test_version_changed(self, project: Path):
        lock_path = project / LOCK_FILENAME
        lock_path.write_text(lock_path.read_text().replace(jdf_hooks.__version__, "0.9.0"))
        assert check_project(project).version_changed


class TestDiff:
    def test_diff_shows_local_change(self, project: Path):
        (project / "lefthook.yml").write_text((project / "lefthook.yml").read_text() + "# tweak\n")
        diff = diff_file(project, "lefthook.yml")
        assert diff.startswith("--- lefthook.yml (current)")
        assert "+++ lefthook.yml" in diff
        assert "-# tweak" in diff

    def test_diff_identical_is_empty(self, project: Path):
        assert diff_file(project, "lefthook.yml") == ""


class TestCli:
    def run(self, monkeypatch, *argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["jdf-hooks", *argv])
        return main()

    def test_up_to_date_exit_0(self, project: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "check", str(project)) == CHECK_OK
        assert "All generated files are up to date" in capsys.readouterr().out

    def test_drift_exit_1(self, project: Path, monkeypatch, capsys):
        (project / "lefthook.yml").unlink()
        assert self.run(monkeypatch, "check", str(project)) == CHECK_DRIFT
        out = capsys.readouterr().out
        assert "lefthook.yml: missing" in out
        assert "Drift detected" in out

    def test_diff_flag_prints_diff(self, project: Path, monkeypatch, capsys):
        (project / "lefthook.yml").write_text("# rewritten\n")
        assert self.run(monkeypatch, "check", "--diff", str(project)) == CHECK_DRIFT
        out = capsys.readouterr().out
        assert "--- lefthook.yml (current)" in out
        assert "-# rewritten" in out

    def test_unmanaged_exit_2(self, tmp_path: Path, monkeypatch, capsys):
        assert self.run(monkeypatch, "check", str(tmp_path)) == CHECK_UNMANAGED
        assert LOCK_FILENAME in capsys.readouterr().out

    def test_invalid_lock_exit_2(self, tmp_path: Path, monkeypatch, capsys):
        (tmp_path / LOCK_FILENAME).write_text("{")
        assert self.run(monkeypatch, "check", str(tmp_path)) == CHECK_UNMANAGED
        assert "Invalid" in capsys.readouterr().out

    def test_missing_directory_exit_2(self, tmp_path: Path, monkeypatch):
        assert self.run(monkeypatch, "check", str(tmp_path / "nope")) == CHECK_UNMANAGED
