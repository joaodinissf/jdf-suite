"""Interactive CLI for setting up JDF hooks."""

import argparse
import shutil
import sys
from pathlib import Path

from . import __version__
from .detect import LANGUAGE_DETECTORS, detect_languages, get_language_display
from .generate import generate_configs, get_templates_dir

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
        "python": ["pycln", "isort", "ruff", "pyright"],
        "javascript": ["prettier (npm install -g prettier)"],
        "rust": ["rustfmt, clippy (rustup component add rustfmt clippy)"],
        "java": ["google-java-format, pmd, checkstyle"],
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
    existing_files: list[str] = []
    if (target_dir / "lefthook.yml").exists():
        existing_files.append("lefthook.yml")
    if (target_dir / ".pre-commit-config.yaml").exists():
        existing_files.append(".pre-commit-config.yaml")
    if (target_dir / "configs").is_dir():
        existing_files.append("configs/")

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

    # Print next steps
    print_next_steps(hook_manager, languages)

    print(f"\n{GREEN}Setup complete!{RESET}\n")
    return 0


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

    return parser


def main() -> int:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if args.command == "setup":
        return setup_command(args)
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
