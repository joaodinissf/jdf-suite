#!/usr/bin/env python3
"""
Integration test for pre-commit hooks configuration.

This script:
1. Creates a temporary workspace
2. Generates pre-commit config using the CLI's generation logic
3. Copies example files (intentionally badly-formatted)
4. Runs pre-commit on all files
5. Shows the resulting diff for manual inspection

Usage: python tests/integration/test_precommit.py [--verbose]
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


def get_precommit_command():
    """Return the base command used to invoke pre-commit."""
    if shutil.which("pre-commit"):
        return "pre-commit"

    if shutil.which("uvx"):
        return "uvx pre-commit"

    raise RuntimeError("Neither 'pre-commit' nor 'uvx' is available on PATH. Install pre-commit or uv.")


def run_precommit(work_dir, precommit_cmd):
    """Run pre-commit on all files in the working directory."""
    print("Running pre-commit on all files...")

    run_command("git add .", cwd=work_dir)
    result = run_command(f"{precommit_cmd} run --all-files", cwd=work_dir, check=False)

    print(f"Pre-commit completed (exit code: {result.returncode})")
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)

    return result.returncode == 0


def show_diff(work_dir, verbose=False):
    """Show the git diff of changes made by pre-commit."""
    if not verbose:
        print("\nDiff output suppressed. Re-run with --verbose to include full diff.")
        return

    print("\n" + "=" * 60)
    print("DIFF: Changes made by pre-commit hooks")
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


def main():
    """Main test function."""
    parser = argparse.ArgumentParser(description="Integration test: pre-commit hooks against sample files")
    parser.add_argument("-v", "--verbose", action="store_true", help="Display the full git diff after hooks run")
    args = parser.parse_args()

    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    example_dir = script_dir / "example_files"

    print("Pre-commit integration test")
    if not args.verbose:
        print("(pass --verbose to show diff)")
    print(f"Project root: {project_root}")

    if not example_dir.exists():
        print(f"Example files not found: {example_dir}")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir) / "test_workspace"
        work_dir.mkdir()

        print(f"Workspace: {work_dir}")

        try:
            # Initialize git repo
            run_command("git init", cwd=work_dir)
            run_command("git config user.email 'test@example.com'", cwd=work_dir)
            run_command("git config user.name 'Test User'", cwd=work_dir)

            # Generate pre-commit config using the generation logic
            all_languages = {
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
            generate_configs(work_dir, all_languages, "pre-commit")

            # Copy git submodules if they exist
            if (project_root / "hooks").exists():
                shutil.copytree(project_root / "hooks", work_dir / "hooks")

            # Copy example files
            copy_example_files(example_dir, work_dir)

            # Run pre-commit
            precommit_cmd = get_precommit_command()
            print("Installing pre-commit hooks...")
            run_command(f"{precommit_cmd} install", cwd=work_dir)

            success = run_precommit(work_dir, precommit_cmd)
            show_diff(work_dir, verbose=args.verbose)

            print("\n" + "=" * 60)
            if success:
                print("Pre-commit run completed successfully!")
            else:
                print("Pre-commit run completed with issues (expected for formatting)")
            print("=" * 60)

        except Exception as e:
            print(f"Test failed: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
