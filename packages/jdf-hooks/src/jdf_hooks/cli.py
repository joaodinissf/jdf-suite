"""Interactive CLI for setting up JDF hooks."""

import argparse
import shutil
import sys
from pathlib import Path

from . import __version__
from .check import CheckReport, FileState, UnmanagedProjectError, check_project, diff_file, undetected_languages
from .detect import LANGUAGE_DETECTORS, detect_languages, get_language_display
from .generate import generate_configs, get_templates_dir
from .lock import LOCK_FILENAME, LockError
from .update import apply_update, plan_update

# ANSI color codes
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RED = "\033[91m"
BOLD = "\033[1m"
RESET = "\033[0m"


def print_banner() -> None:
    """Print the CLI banner."""
    print(f"\n{BOLD}JDF Hooks{RESET} v{__version__}")
    print("=" * 50)


def print_success(msg: str) -> None:
    """Print a success message."""
    print(f"{GREEN}✓{RESET} {msg}")


def print_warning(msg: str) -> None:
    """Print a warning message."""
    print(f"{YELLOW}⚠{RESET} {msg}")


def print_error(msg: str) -> None:
    """Print an error message."""
    print(f"{RED}✗{RESET} {msg}")


def print_info(msg: str) -> None:
    """Print an info message."""
    print(f"{BLUE}→{RESET} {msg}")


def select_languages(detected: dict[str, list[str]]) -> set[str]:
    """Interactive language selection menu.

    Args:
        detected: Dictionary of detected languages and reasons.

    Returns:
        Set of selected language names.
    """
    # All available languages in order
    all_languages = list(LANGUAGE_DETECTORS.keys())
    all_languages.append("general")  # Add general checks at the end

    # Start with detected languages selected
    selected = set(detected.keys())
    selected.add("general")  # Always recommend general checks

    while True:
        print(f"\n{BOLD}Select languages for hooks:{RESET}\n")

        for i, lang in enumerate(all_languages, 1):
            marker = "X" if lang in selected else " "
            display_name = get_language_display(lang) if lang != "general" else "General file checks"

            # Show detection reasons if detected
            if lang in detected:
                reasons = ", ".join(detected[lang][:2])  # Show first 2 reasons
                print(f"  [{marker}] {i:2}. {display_name} ({reasons})")
            elif lang == "general":
                print(f"  [{marker}] {i:2}. {display_name} (recommended)")
            else:
                print(f"  [{marker}] {i:2}. {display_name}")

        print()
        print("  Commands: Enter numbers to toggle (e.g., '3 5 7')")
        print("            'a' = select all, 'n' = select none")
        print("            Press Enter to continue with current selection")
        print()

        try:
            choice = input("  > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(1)

        if not choice:
            # Continue with current selection
            break
        elif choice == "a":
            selected = set(all_languages)
        elif choice == "n":
            selected = set()
        else:
            # Parse numbers
            try:
                numbers = [int(n) for n in choice.split()]
                for num in numbers:
                    if 1 <= num <= len(all_languages):
                        lang = all_languages[num - 1]
                        if lang in selected:
                            selected.discard(lang)
                        else:
                            selected.add(lang)
            except ValueError:
                print_warning("Invalid input. Enter numbers separated by spaces.")

    return selected


def select_hook_manager() -> str:
    """Interactive hook manager selection.

    Returns:
        One of "lefthook", "pre-commit", or "both".
    """
    print(f"\n{BOLD}Select hook manager:{RESET}\n")
    print("  1. lefthook   (fast local development)")
    print("  2. pre-commit (CI/CD standardization)")
    print("  3. Both")
    print()

    while True:
        try:
            choice = input("  Choice [1-3]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(1)

        if choice == "1":
            return "lefthook"
        elif choice == "2":
            return "pre-commit"
        elif choice in ("3", ""):
            return "both"
        else:
            print_warning("Please enter 1, 2, or 3")


def print_next_steps(hook_manager: str, languages: set[str]) -> None:
    """Print guidance for next steps after setup."""
    # Prominent install command guidance
    if hook_manager in ("lefthook", "both"):
        print(f"\n  {BOLD}{GREEN}Run this now:{RESET}  lefthook install")
    if hook_manager in ("pre-commit", "both"):
        print(f"\n  {BOLD}{GREEN}Run this now:{RESET}  pre-commit install")

    print(f"\n{BOLD}Next steps:{RESET}\n")

    if hook_manager in ("lefthook", "both"):
        print(f"  {BOLD}Lefthook:{RESET}")
        if not shutil.which("lefthook"):
            print("    1. Install: brew install lefthook")
            print("              # or: npm install -g lefthook")
            print("              # or: go install github.com/evilmartians/lefthook@latest")
        print("    2. Run: lefthook install")
        print("    3. Test: lefthook run pre-commit --all-files")
        print()

    if hook_manager in ("pre-commit", "both"):
        print(f"  {BOLD}Pre-commit:{RESET}")
        if not shutil.which("pre-commit"):
            print("    1. Install: pip install pre-commit")
            print("              # or: pipx install pre-commit")
            print("              # or: uv tool install pre-commit")
        print("    2. Run: pre-commit install")
        print("    3. Test: pre-commit run --all-files")
        print()

    # Language-specific tool installation hints
    tool_hints: dict[str, list[str]] = {
        "python": ["pycln", "isort", "ruff", "ty"],
        "javascript": ["prettier (npm install -g prettier)"],
        "rust": ["rustfmt, clippy (rustup component add rustfmt clippy)"],
        "java": ["pmd, checkstyle"],
        "markdown": ["markdownlint (npm install -g markdownlint-cli)"],
        "yaml": ["yamlfix (pip install yamlfix)"],
        "toml": ["taplo (cargo install taplo-cli)"],
        "sql": ["sqlfluff (pip install sqlfluff)"],
        "shell": ["shfmt (brew install shfmt)"],
    }

    relevant_tools: list[str] = []
    for lang in languages:
        if lang in tool_hints:
            relevant_tools.extend(tool_hints[lang])

    if relevant_tools and hook_manager in ("lefthook", "both"):
        print(f"  {BOLD}Required tools for lefthook:{RESET}")
        for tool in relevant_tools[:5]:  # Show first 5
            print(f"    - {tool}")
        if len(relevant_tools) > 5:
            print(f"    ... and {len(relevant_tools) - 5} more (see README)")


def find_existing_outputs(target_dir: Path) -> list[str]:
    """List generated files/directories already present in target_dir."""
    candidates = ["lefthook.yml", ".pre-commit-config.yaml", "configs/", LOCK_FILENAME]
    return [name for name in candidates if (target_dir / name.rstrip("/")).exists()]


def setup_command(args: argparse.Namespace) -> int:
    """Run the setup command.

    Args:
        args: Parsed command line arguments.

    Returns:
        Exit code (0 for success).
    """
    target_dir = Path(args.directory).resolve()

    if not target_dir.exists():
        print_error(f"Directory does not exist: {target_dir}")
        return 1

    print_banner()
    print_info(f"Setting up hooks in: {target_dir}")

    # Detect languages
    print(f"\n{BLUE}Scanning project for languages...{RESET}")
    detected = detect_languages(target_dir)

    if detected:
        print_success(f"Found {len(detected)} language(s)")
    else:
        print_warning("No languages detected, showing all options")

    # Interactive language selection
    languages = select_languages(detected)

    if not languages:
        print_error("No languages selected. Aborting.")
        return 1

    # Hook manager selection
    hook_manager = select_hook_manager()

    # Check for existing files that would be overwritten
    existing_files = find_existing_outputs(target_dir)
    if existing_files:
        print(f"\n{YELLOW}The following files/directories already exist:{RESET}")
        for f in existing_files:
            print(f"  - {f}")
        try:
            answer = input("Overwrite? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            return 1
        if answer not in ("y", "yes"):
            print("Aborted.")
            return 1

    # Generate configs
    print(f"\n{BLUE}Generating configuration files...{RESET}\n")

    templates_dir = get_templates_dir()
    if not templates_dir.exists():
        print_error(f"Templates directory not found: {templates_dir}")
        return 1

    result = generate_configs(target_dir, languages, hook_manager, templates_dir)

    # Report created files
    for path in result["hook_files"]:
        print_success(f"Created {path.name}")

    for path in result["configs"]:
        rel_path = path.relative_to(target_dir)
        print_success(f"Created {rel_path}")

    for path in result["lock"]:
        print_success(f"Created {path.name}")

    # Print next steps
    print_next_steps(hook_manager, languages)

    print(f"\n{GREEN}Setup complete!{RESET}\n")
    return 0


# Exit codes for `jdf-hooks check` / `jdf-hooks update`, stable for CI use
CHECK_OK = 0
CHECK_DRIFT = 1
CHECK_UNMANAGED = 2
UPDATE_OK = CHECK_OK
UPDATE_REFUSED = CHECK_DRIFT  # modified files without --force, or --dry-run with changes pending
UPDATE_UNMANAGED = CHECK_UNMANAGED

_STATE_PRINTERS = {
    FileState.UP_TO_DATE: (print_success, "up to date"),
    FileState.UPDATE_AVAILABLE: (print_info, "update available"),
    FileState.MODIFIED: (print_warning, "modified locally"),
    FileState.MISSING: (print_error, "missing"),
    FileState.OBSOLETE: (print_warning, "no longer generated"),
}


def print_check_report(report: CheckReport) -> None:
    """Print one line per generated file plus a summary."""
    versions = f"lock: jdf-hooks {report.lock.jdf_hooks}, installed: {report.tool_version}"
    print(f"\n{BOLD}Generated files:{RESET}  ({versions})\n")
    for f in report.files:
        printer, label = _STATE_PRINTERS[f.state]
        suffix = ""
        if f.new:
            suffix = " (new file in current templates)"
        elif f.state is FileState.MODIFIED and f.stale:
            suffix = " — update also available"
        printer(f"{f.path}: {label}{suffix}")

    print()
    if not report.has_drift:
        print(f"{GREEN}All generated files are up to date.{RESET}")
        return

    counts = {state: sum(1 for f in report.files if f.state is state) for state in FileState}
    parts = [f"{counts[s]} {s.value}" for s in FileState if counts[s] and s is not FileState.UP_TO_DATE]
    print(f"{YELLOW}Drift detected:{RESET} " + ", ".join(parts))


def print_detection_hint(target_dir: Path, languages: list[str]) -> None:
    """Point out languages present in the project that have no hooks yet."""
    for lang, reasons in undetected_languages(target_dir, languages).items():
        why = ", ".join(reasons[:2])
        name = get_language_display(lang)
        print_info(f"Detected {name} ({why}) — not in your hook set; `jdf-hooks update --add {lang}`")


def check_command(args: argparse.Namespace) -> int:
    """Run the check command: report drift between lock, disk, and bundled templates."""
    target_dir = Path(args.directory).resolve()

    if not target_dir.exists():
        print_error(f"Directory does not exist: {target_dir}")
        return CHECK_UNMANAGED

    try:
        report = check_project(target_dir)
    except UnmanagedProjectError as e:
        print_error(str(e))
        return CHECK_UNMANAGED
    except LockError as e:
        print_error(str(e))
        return CHECK_UNMANAGED

    print_check_report(report)
    if report.has_drift:
        print("  Run `jdf-hooks update` to regenerate ")
        print("  (local edits need --force; keep project-specific hooks in lefthook-local.yml)")
    print_detection_hint(target_dir, report.lock.languages)

    if args.diff:
        for f in report.files:
            if f.state is FileState.UP_TO_DATE:
                continue
            diff = diff_file(target_dir, f.path, lock=report.lock)
            if diff:
                print()
                print(diff, end="")

    return CHECK_DRIFT if report.has_drift else CHECK_OK


def update_command(args: argparse.Namespace) -> int:
    """Run the update command: regenerate from the lock, overwriting drift."""
    target_dir = Path(args.directory).resolve()

    if not target_dir.exists():
        print_error(f"Directory does not exist: {target_dir}")
        return UPDATE_UNMANAGED

    try:
        plan = plan_update(target_dir, add=set(args.add), remove=set(args.remove))
    except (UnmanagedProjectError, LockError, ValueError) as e:
        print_error(str(e))
        return UPDATE_UNMANAGED

    print_check_report(plan.report)
    if plan.languages_changed:
        print_info(f"Languages: {', '.join(plan.report.lock.languages)} → {', '.join(plan.languages)}")

    if plan.blocked and not args.force:
        print(f"\n{RED}Refusing to overwrite locally modified files:{RESET}")
        for path in plan.blocked:
            print(f"  - {path}")
        print("  Re-run with --force to overwrite, or move project-specific hooks to lefthook-local.yml.")
        print_detection_hint(target_dir, plan.languages)
        return UPDATE_REFUSED

    to_write = plan.to_write(force=args.force)
    if plan.is_noop(force=args.force):
        print(f"\n{GREEN}Nothing to update.{RESET}")
        print_detection_hint(target_dir, plan.languages)
        return UPDATE_OK

    if args.dry_run:
        print(f"\n{BOLD}Dry run:{RESET} would write {len(to_write)} file(s), delete {len(plan.to_delete)} file(s).")
        for path in to_write:
            print(f"  write  {path}")
        for path in plan.to_delete:
            print(f"  delete {path}")
        print_detection_hint(target_dir, plan.languages)
        return UPDATE_REFUSED

    # plan.blocked was handled above, so apply_update cannot raise ModifiedFilesError here.
    result = apply_update(target_dir, plan, force=args.force)

    print()
    for path in result.deleted:
        print_success(f"Removed {path}")
    for path in result.written:
        print_success(f"Updated {path}")
    print_success(f"Updated {LOCK_FILENAME}")
    print_detection_hint(target_dir, plan.languages)
    return UPDATE_OK


def create_parser() -> argparse.ArgumentParser:
    """Create the argument parser."""
    parser = argparse.ArgumentParser(
        prog="jdf-hooks",
        description="Interactive CLI to set up JDF hooks for any project.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # setup command
    setup_parser = subparsers.add_parser(
        "setup",
        help="Set up hooks in a project directory",
    )
    setup_parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Target project directory (default: current directory)",
    )

    # check command
    check_parser = subparsers.add_parser(
        "check",
        help=f"Report generated files that are stale or modified (reads {LOCK_FILENAME}); "
        f"exit {CHECK_OK} = up to date, {CHECK_DRIFT} = drift, {CHECK_UNMANAGED} = no lock",
    )
    check_parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Project directory to check (default: current directory)",
    )
    check_parser.add_argument(
        "--diff",
        action="store_true",
        help="Show a unified diff from each drifted file to a fresh render",
    )

    # update command
    update_parser = subparsers.add_parser(
        "update",
        help=f"Regenerate hook files from {LOCK_FILENAME}, overwriting drift; "
        f"exit {UPDATE_OK} = done/nothing to do, {UPDATE_REFUSED} = refused or dry-run pending, "
        f"{UPDATE_UNMANAGED} = no lock",
    )
    update_parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Project directory to update (default: current directory)",
    )
    update_parser.add_argument(
        "--add",
        action="append",
        default=[],
        metavar="LANG",
        help="Add a language to the hook set (repeatable)",
    )
    update_parser.add_argument(
        "--remove",
        action="append",
        default=[],
        metavar="LANG",
        help="Remove a language from the hook set (repeatable)",
    )
    update_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite files that were modified locally",
    )
    update_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing anything",
    )

    return parser


def main() -> int:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if args.command == "setup":
        return setup_command(args)
    elif args.command == "check":
        return check_command(args)
    elif args.command == "update":
        return update_command(args)
    elif args.command is None:
        # Default to setup in current directory
        args.command = "setup"
        args.directory = "."
        return setup_command(args)
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    sys.exit(main())
