#!/usr/bin/env python3
"""
Integration test for lefthook hooks configuration.

This script:
1. Checks that lefthook is installed
2. Creates a temporary workspace
3. Generates lefthook config using the CLI's generation logic
4. Copies example files (intentionally badly-formatted)
5. Runs lefthook on all files
6. Shows the resulting diff for manual inspection

Usage: python tests/integration/test_lefthook.py [--verbose]
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from jdf_hooks.generate import generate_configs


def run_command(cmd, cwd=None, check=True):
    """Run a shell command and return the result."""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, check=check)
        return result
    except subprocess.CalledProcessError as e:
        print(f"Command failed: {cmd}")
        print(f"Exit code: {e.returncode}")
        print(f"Stdout: {e.stdout}")
        print(f"Stderr: {e.stderr}")
        raise


def check_lefthook():
    """Check if lefthook is installed."""
    if shutil.which("lefthook"):
        return True
    print("lefthook is not installed")
    print("Install with: brew install lefthook")
    return False


def check_required_tools():
    """Check if required tools are installed."""
    tools = {
        "Python": ["pycln", "isort", "ruff", "pyright", "ty"],
        "JavaScript": ["npx"],
        "Rust": ["rustfmt", "cargo"],
        "Markdown": ["markdownlint"],
        "YAML": ["yamlfix"],
        "TOML": ["taplo"],
        "SQL": ["sqlfluff"],
        "Shell": ["shfmt"],
    }

    missing = {}
    for category, tool_list in tools.items():
        missing_tools = [t for t in tool_list if not shutil.which(t)]
        if missing_tools:
            missing[category] = missing_tools

    if missing:
        print("Some tools are missing:")
        for category, tool_list in missing.items():
            print(f"  {category}: {', '.join(tool_list)}")
        print("\nSome hooks may fail. See README for installation instructions.")
        return False

    print("All required tools are installed")
    return True


def copy_example_files(example_dir, work_dir):
    """Copy example files to the workspace."""
    print(f"Copying example files from {example_dir}...")

    for item in example_dir.iterdir():
        dest = work_dir / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)

    print(f"Example files copied to {work_dir}")


def show_diff(work_dir, verbose=False):
    """Show the git diff of changes made by lefthook."""
    if not verbose:
        print("\nDiff output suppressed. Re-run with --verbose to include full diff.")
        return

    print("\n" + "=" * 60)
    print("DIFF: Changes made by lefthook hooks")
    print("=" * 60)

    result = run_command("git diff --cached", cwd=work_dir, check=False)
    if result.stdout:
        print(result.stdout)
    else:
        print("No changes detected in staged files.")

    result = run_command("git diff", cwd=work_dir, check=False)
    if result.stdout:
        print("\n" + "-" * 40)
        print("Additional unstaged changes:")
        print("-" * 40)
        print(result.stdout)

    print("=" * 60)


ALL_LANGUAGES = {
    "python",
    "javascript",
    "rust",
    "java",
    "markdown",
    "yaml",
    "toml",
    "sql",
    "shell",
    "general",
}


def setup_and_run(work_dir, project_root, example_dir, verbose):
    """Set up workspace, generate config, and run lefthook."""
    run_command("git init", cwd=work_dir)
    run_command("git config user.email 'test@example.com'", cwd=work_dir)
    run_command("git config user.name 'Test User'", cwd=work_dir)

    generate_configs(work_dir, ALL_LANGUAGES, "lefthook")

    if (project_root / "hooks").exists():
        shutil.copytree(project_root / "hooks", work_dir / "hooks")

    copy_example_files(example_dir, work_dir)

    print("Installing lefthook hooks...")
    run_command("lefthook install", cwd=work_dir)

    print("Running lefthook on all files...")
    run_command("git add .", cwd=work_dir)
    result = run_command("lefthook run pre-commit --all-files", cwd=work_dir, check=False)

    print(f"Lefthook completed (exit code: {result.returncode})")
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)

    show_diff(work_dir, verbose=verbose)

    print("\n" + "=" * 60)
    if result.returncode == 0:
        print("Lefthook run completed successfully!")
    else:
        print("Lefthook run completed with issues (expected for formatting)")
    print("=" * 60)


def main():
    """Main test function."""
    parser = argparse.ArgumentParser(description="Integration test: lefthook hooks against sample files")
    parser.add_argument("-v", "--verbose", action="store_true", help="Display the full git diff after hooks run")
    args = parser.parse_args()

    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    example_dir = script_dir / "example_files"

    print("Lefthook integration test")
    if not args.verbose:
        print("(pass --verbose to show diff)")
    print(f"Project root: {project_root}")

    if not check_lefthook():
        sys.exit(1)

    print()
    check_required_tools()
    print()

    if not example_dir.exists():
        print(f"Example files not found: {example_dir}")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir) / "test_workspace"
        work_dir.mkdir()
        print(f"Workspace: {work_dir}")

        try:
            setup_and_run(work_dir, project_root, example_dir, args.verbose)
        except Exception as e:
            print(f"Test failed: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
