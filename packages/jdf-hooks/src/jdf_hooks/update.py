"""`jdf-hooks update`: regenerate a project's hook files from its lock, overwriting drift."""

from dataclasses import dataclass, field
from pathlib import Path

from .check import CheckReport, FileState, UnmanagedProjectError, check_project
from .generate import generate_configs, validate_languages
from .lock import LOCK_FILENAME, read_lock


class ModifiedFilesError(Exception):
    """Refusing to overwrite files that were edited locally (use --force)."""

    def __init__(self, paths: list[str]) -> None:
        self.paths = paths
        super().__init__("Locally modified: " + ", ".join(paths))


@dataclass(frozen=True)
class UpdatePlan:
    languages: list[str]
    manager: str
    report: CheckReport
    github_workflow: bool = False

    @property
    def blocked(self) -> list[str]:
        """Files that would be overwritten but were edited locally."""
        return [f.path for f in self.report.files if f.state is FileState.MODIFIED]

    @property
    def to_delete(self) -> list[str]:
        return [f.path for f in self.report.files if f.state is FileState.OBSOLETE]

    def to_write(self, *, force: bool) -> list[str]:
        states = {FileState.UPDATE_AVAILABLE, FileState.MISSING}
        if force:
            states.add(FileState.MODIFIED)
        return [f.path for f in self.report.files if f.state in states]

    @property
    def languages_changed(self) -> bool:
        return self.languages != self.report.lock.languages

    @property
    def options_changed(self) -> bool:
        return self.github_workflow != self.report.lock.options.get("github_workflow", False)

    def is_noop(self, *, force: bool) -> bool:
        return (
            not self.to_write(force=force)
            and not self.to_delete
            and not self.languages_changed
            and not self.options_changed
            and not self.report.version_changed  # a newer jdf-hooks re-stamps the lock even if files match
        )


@dataclass(frozen=True)
class UpdateResult:
    written: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)


def plan_update(
    target_dir: Path,
    *,
    add: set[str] | None = None,
    remove: set[str] | None = None,
    github_workflow: bool | None = None,
    templates_dir: Path | None = None,
) -> UpdatePlan:
    """Work out what `update` would change, without touching anything.

    Raises:
        UnmanagedProjectError: no lock file.
        LockError: unparsable lock file.
        ValueError: unknown language in add/remove.
    """
    lock = read_lock(target_dir)
    if lock is None:
        raise UnmanagedProjectError(
            f"No {LOCK_FILENAME} in {target_dir} — run `jdf-hooks adopt` (existing files) or "
            "`jdf-hooks setup` (fresh) first; `update` only works on managed projects."
        )

    add = add or set()
    remove = remove or set()
    validate_languages(add | remove)

    languages = sorted((set(lock.languages) | add) - remove)
    workflow = lock.options.get("github_workflow", False) if github_workflow is None else github_workflow
    report = check_project(target_dir, templates_dir, languages=set(languages), github_workflow=workflow)
    return UpdatePlan(languages=languages, manager=lock.manager, report=report, github_workflow=workflow)


def apply_update(
    target_dir: Path,
    plan: UpdatePlan,
    *,
    force: bool = False,
    templates_dir: Path | None = None,
) -> UpdateResult:
    """Write the plan to disk: delete obsolete files, regenerate everything, rewrite the lock.

    Raises:
        ModifiedFilesError: locally modified files exist and force is False. Nothing is written.
    """
    if plan.blocked and not force:
        raise ModifiedFilesError(plan.blocked)

    deleted: list[str] = []
    for rel_path in plan.to_delete:
        path = target_dir / rel_path
        if path.is_file():
            path.unlink()
            deleted.append(rel_path)
        # Prune now-empty directories, but never the project root itself.
        parent = path.parent
        while parent != target_dir and parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent

    # Deterministic render: unchanged files are rewritten with identical bytes.
    generate_configs(target_dir, set(plan.languages), plan.manager, templates_dir, github_workflow=plan.github_workflow)

    return UpdateResult(written=plan.to_write(force=force), deleted=deleted)
