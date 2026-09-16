"""`jdf-hooks adopt`: bring a project generated before the lock file existed (< 1.2.0) under management."""

from dataclasses import dataclass
from pathlib import Path

from . import __version__
from .generate import (
    LANGUAGE_CONFIGS,
    LANGUAGE_FRAGMENTS,
    LEFTHOOK_FILENAME,
    PRECOMMIT_FILENAME,
    get_templates_dir,
    validate_languages,
)
from .lock import LOCK_FILENAME, LockFile, hash_bytes, read_lock, write_lock


class NothingToAdoptError(Exception):
    """No generated hook files were found."""


class AlreadyManagedError(Exception):
    """The project already has a lock file."""


@dataclass(frozen=True)
class Adoption:
    manager: str
    languages: list[str]
    files: list[str]  # relative paths recorded in the lock, in lock order


def section_headers(templates_dir: Path | None = None) -> dict[str, str]:
    """Map each fragment's section header comment (line 2 of the fragment) to its language."""
    if templates_dir is None:
        templates_dir = get_templates_dir()
    headers: dict[str, str] = {}
    for lang, fragment_names in LANGUAGE_FRAGMENTS.items():
        for name in fragment_names:
            path = templates_dir / "lefthook" / f"{name}.yml"
            if path.exists():
                lines = path.read_text().splitlines()
                if len(lines) > 1:
                    headers[lines[1].strip()] = lang
    return headers


def infer_languages(target_dir: Path, hook_files: list[str], templates_dir: Path | None = None) -> set[str]:
    """Languages whose section headers appear in the existing generated hook files."""
    headers = section_headers(templates_dir)
    found: set[str] = set()
    for rel_path in hook_files:
        for line in (target_dir / rel_path).read_text().splitlines():
            lang = headers.get(line.strip())
            if lang:
                found.add(lang)
    return found


def plan_adoption(
    target_dir: Path,
    *,
    manager: str | None = None,
    languages: set[str] | None = None,
    templates_dir: Path | None = None,
) -> Adoption:
    """Decide manager, languages and the files to record — without writing anything.

    Raises:
        AlreadyManagedError: a lock already exists.
        NothingToAdoptError: neither hook file exists.
        ValueError: unknown language name, or the requested manager's file is missing.
    """
    if read_lock(target_dir) is not None:
        raise AlreadyManagedError(f"{target_dir} already has {LOCK_FILENAME}; use `jdf-hooks check` / `update`.")

    present = [f for f in (LEFTHOOK_FILENAME, PRECOMMIT_FILENAME) if (target_dir / f).is_file()]
    if not present:
        raise NothingToAdoptError(
            f"No {LEFTHOOK_FILENAME} or {PRECOMMIT_FILENAME} in {target_dir}; run `jdf-hooks setup` instead."
        )

    by_manager = {"lefthook": LEFTHOOK_FILENAME, "pre-commit": PRECOMMIT_FILENAME}
    if manager is None:
        manager = "both" if len(present) == 2 else next(m for m, f in by_manager.items() if f == present[0])
    wanted = [f for m, f in by_manager.items() if manager in (m, "both")]
    missing = [f for f in wanted if f not in present]
    if missing:
        raise ValueError(f"--manager {manager} needs {', '.join(missing)}, which does not exist.")

    if languages is None:
        languages = infer_languages(target_dir, wanted, templates_dir)
    else:
        validate_languages(languages)
    if not languages:
        raise ValueError("Could not infer any languages from the hook files; pass --languages.")

    files = list(wanted)
    for lang in sorted(languages):
        for config_path in LANGUAGE_CONFIGS.get(lang, []):
            if (target_dir / config_path).is_file():
                files.append(config_path)

    return Adoption(manager=manager, languages=sorted(languages), files=files)


def apply_adoption(target_dir: Path, adoption: Adoption) -> Path:
    """Write a lock recording the files *as they are on disk*.

    Content that predates the current templates then shows up in `check` as
    "update available", and `update` brings it forward. Hand edits made before
    adoption cannot be told apart from old template output.
    """
    lock = LockFile(
        jdf_hooks=__version__,
        manager=adoption.manager,
        languages=adoption.languages,
        files={rel: hash_bytes((target_dir / rel).read_bytes()) for rel in adoption.files},
    )
    return write_lock(target_dir, lock)
