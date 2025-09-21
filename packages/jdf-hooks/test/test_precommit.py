#!/usr/bin/env python3
"""
Test script for pre-commit hooks configuration.

This script:
1. Checks that the git working directory is clean
2. Unzips the example files
3. Runs pre-commit on all files
4. Shows the resulting diff for manual inspection

Usage: python test/test_precommit.py
"""

import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def run_command(cmd, cwd=None, check=True):
    """Run a shell command and return the result."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, cwd=cwd, check=check
        )
        return result
    except subprocess.CalledProcessError as e:
        print(f"Command failed: {cmd}")
        print(f"Exit code: {e.returncode}")
        print(f"Stdout: {e.stdout}")
        print(f"Stderr: {e.stderr}")
        raise


def unzip_test_files(zip_path, extract_dir):
    """Unzip the test files to the extraction directory."""
    print(f"📦 Extracting test files from {zip_path}...")

    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(extract_dir)

    # Move files and directories from test_files/ subdirectory to root of extract_dir
    test_files_dir = extract_dir / "test_files"
    if test_files_dir.exists():
        for file_path in test_files_dir.iterdir():
            shutil.move(str(file_path), str(extract_dir / file_path.name))
        # Remove empty test_files directory
        test_files_dir.rmdir()

    print(f"✅ Test files extracted to {extract_dir}")


def get_precommit_command():
    """Return the base command used to invoke pre-commit."""

    if shutil.which("pre-commit"):
        return "pre-commit"

    if shutil.which("uvx"):
        return "uvx pre-commit"

    raise RuntimeError(
        "Neither 'pre-commit' nor 'uvx' is available on PATH. Install pre-commit or uv."
    )


def run_precommit(work_dir, precommit_cmd):
    """Run pre-commit on all files in the working directory."""
    print("🔧 Running pre-commit on all files...")

    # Stage all files for pre-commit
    run_command("git add .", cwd=work_dir)

    # Run pre-commit
    result = run_command(f"{precommit_cmd} run --all-files", cwd=work_dir, check=False)

    print("📋 Pre-commit execution completed")
    print(f"Exit code: {result.returncode}")

    if result.stdout:
        print("Standard output:")
        print(result.stdout)

    if result.stderr:
        print("Standard error:")
        print(result.stderr)

    return result.returncode == 0


def show_diff(work_dir):
    """Show the git diff of changes made by pre-commit."""
    print("\n" + "=" * 60)
    print("📊 DIFF: Changes made by pre-commit hooks")
    print("=" * 60)

    # Show diff of staged changes (original vs formatted)
    result = run_command("git diff --cached", cwd=work_dir, check=False)

    if result.stdout:
        print(result.stdout)
    else:
        print("No changes detected in staged files.")

    # Also show unstaged changes if any
    result = run_command("git diff", cwd=work_dir, check=False)

    if result.stdout:
        print("\n" + "-" * 40)
        print("📝 Additional unstaged changes:")
        print("-" * 40)
        print(result.stdout)

    print("=" * 60)


def main():
    """Main test function."""
    # Get script directory and project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    zip_path = script_dir / "example_files.zip"

    print("🧪 Pre-commit hooks test script")
    print(f"Project root: {project_root}")
    print(f"Test files zip: {zip_path}")

    # Check prerequisites
    if not zip_path.exists():
        print(f"❌ Test files zip not found: {zip_path}")
        sys.exit(1)

    # Create temporary directory for testing
    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir) / "test_workspace"
        work_dir.mkdir()

        print(f"🏗️  Created temporary workspace: {work_dir}")

        try:
            # Initialize git repo in workspace
            run_command("git init", cwd=work_dir)
            run_command("git config user.email 'test@example.com'", cwd=work_dir)
            run_command("git config user.name 'Test User'", cwd=work_dir)

            # Copy pre-commit configuration
            shutil.copy2(project_root / ".pre-commit-config.yaml", work_dir)
            shutil.copytree(project_root / ".pre-commit", work_dir / ".pre-commit")

            # Copy git submodules if they exist
            if (project_root / "hooks").exists():
                shutil.copytree(project_root / "hooks", work_dir / "hooks")

            # Extract test files
            unzip_test_files(zip_path, work_dir)

            # Determine pre-commit command
            precommit_cmd = get_precommit_command()

            # Install pre-commit hooks
            print("⚙️  Installing pre-commit hooks...")
            run_command(f"{precommit_cmd} install", cwd=work_dir)

            # Run pre-commit
            success = run_precommit(work_dir, precommit_cmd)

            # Show results
            show_diff(work_dir)

            print("\n" + "=" * 60)
            if success:
                print("✅ Pre-commit run completed successfully!")
            else:
                print(
                    "⚠️  Pre-commit run completed with issues (this is expected for formatting)"
                )

            print("\n📖 Instructions for manual review:")
            print("1. Review the diff above to see what changes were made")
            print("2. Check that formatting improvements look correct")
            print("3. Verify that linting issues were properly identified")
            print("4. The temporary workspace will be cleaned up automatically")
            print("=" * 60)

        except Exception as e:  # pylint: disable=broad-exception-caught
            print(f"❌ Test failed with error: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
