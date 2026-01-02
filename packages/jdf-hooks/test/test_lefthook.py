#!/usr/bin/env python3
"""
Test script for lefthook hooks configuration.

This script:
1. Checks that lefthook is installed
2. Checks for required tools (warns if missing)
3. Creates a temporary workspace
4. Unzips the example files
5. Runs lefthook on all files
6. Shows the resulting diff for manual inspection

Usage: python test/test_lefthook.py
"""

import argparse
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


def check_lefthook():
    """Check if lefthook is installed."""
    if shutil.which("lefthook"):
        return True
    print("❌ lefthook is not installed")
    print("Install with:")
    print("  brew install lefthook")
    print("  # or")
    print("  npm install -g lefthook")
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
        print("⚠️  Some tools are missing:")
        for category, tool_list in missing.items():
            print(f"  {category}: {', '.join(tool_list)}")
        print("\nSome hooks may fail. See README for installation instructions.")
        return False

    print("✅ All required tools are installed")
    return True


def unzip_test_files(zip_path, extract_dir):
    """Unzip the test files to the extraction directory."""
    print(f"📦 Extracting test files from {zip_path}...")

    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(extract_dir)

    # Move files from test_files/ subdirectory to root
    test_files_dir = extract_dir / "test_files"
    if test_files_dir.exists():
        for file_path in test_files_dir.iterdir():
            shutil.move(str(file_path), str(extract_dir / file_path.name))
        test_files_dir.rmdir()

    print(f"✅ Test files extracted to {extract_dir}")


def run_lefthook(work_dir):
    """Run lefthook on all files in the working directory."""
    print("🔧 Running lefthook on all files...")

    # Stage all files for lefthook
    run_command("git add .", cwd=work_dir)

    # Run lefthook
    result = run_command(
        "lefthook run pre-commit --all-files", cwd=work_dir, check=False
    )

    print("📋 Lefthook execution completed")
    print(f"Exit code: {result.returncode}")

    if result.stdout:
        print("Standard output:")
        print(result.stdout)

    if result.stderr:
        print("Standard error:")
        print(result.stderr)

    return result.returncode == 0


def show_diff(work_dir, verbose=False):
    """Show the git diff of changes made by lefthook."""
    if not verbose:
        print(
            "\n📊 Diff output suppressed. Re-run with --verbose to include full diff."
        )
        return

    print("\n" + "=" * 60)
    print("📊 DIFF: Changes made by lefthook hooks")
    print("=" * 60)

    # Show diff of staged changes
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


def setup_workspace(work_dir, project_root, zip_path):
    """Set up the test workspace with configuration and test files."""
    # Initialize git repo in workspace
    run_command("git init", cwd=work_dir)
    run_command("git config user.email 'test@example.com'", cwd=work_dir)
    run_command("git config user.name 'Test User'", cwd=work_dir)

    # Copy lefthook configuration
    shutil.copy2(project_root / "lefthook.yml", work_dir)
    shutil.copytree(project_root / ".pre-commit", work_dir / ".pre-commit")

    # Copy git submodules if they exist
    if (project_root / "hooks").exists():
        shutil.copytree(project_root / "hooks", work_dir / "hooks")

    # Extract test files
    unzip_test_files(zip_path, work_dir)


def run_test(work_dir, verbose):
    """Run the lefthook test and display results."""
    # Install lefthook hooks
    print("⚙️  Installing lefthook hooks...")
    run_command("lefthook install", cwd=work_dir)

    # Run lefthook
    success = run_lefthook(work_dir)

    # Show results
    show_diff(work_dir, verbose=verbose)

    print("\n" + "=" * 60)
    if success:
        print("✅ Lefthook run completed successfully!")
    else:
        print("⚠️  Lefthook run completed with issues (this is expected for formatting)")

    print("\n📖 Instructions for manual review:")
    print("1. Review the diff above to see what changes were made")
    print("2. Check that formatting improvements look correct")
    print("3. Verify that linting issues were properly identified")
    print("4. The temporary workspace will be cleaned up automatically")
    print("=" * 60)


def main():
    """Main test function."""
    parser = argparse.ArgumentParser(
        description="Test lefthook hooks against sample files"
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Display the full git diff after hooks run",
    )
    args = parser.parse_args()

    # Get script directory and project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    zip_path = script_dir / "example_files.zip"

    print("🧪 Lefthook hooks test script")
    if not args.verbose:
        print("🔕 Diff output is disabled by default; pass --verbose to show it.")
    print(f"Project root: {project_root}")
    print(f"Test files zip: {zip_path}")

    # Check prerequisites
    if not check_lefthook():
        sys.exit(1)

    print()
    check_required_tools()  # Warning only, don't fail
    print()

    if not zip_path.exists():
        print(f"❌ Test files zip not found: {zip_path}")
        sys.exit(1)

    # Create temporary directory for testing
    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir) / "test_workspace"
        work_dir.mkdir()

        print(f"🏗️  Created temporary workspace: {work_dir}")

        try:
            setup_workspace(work_dir, project_root, zip_path)
            run_test(work_dir, args.verbose)

        except Exception as e:  # pylint: disable=broad-exception-caught
            print(f"❌ Test failed with error: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
