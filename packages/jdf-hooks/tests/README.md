# Pre-commit Hooks Test Suite

This directory contains tools for testing the pre-commit hooks configuration.

## Files

- `example_files.zip` - Archive containing test files with formatting issues
- `test_precommit.py` - Python script that tests the complete pre-commit workflow
- `README.md` - This file

## Usage

```bash
# Run the test (requires clean git working directory)
python3 test/test_precommit.py
```

## What the test does

1. **Git Status Check**: Ensures working directory is clean before testing
2. **Workspace Setup**: Creates temporary workspace with test files
3. **Pre-commit Installation**: Installs hooks in the temporary workspace
4. **Hook Execution**: Runs pre-commit on all test files
5. **Diff Analysis**: Shows changes made by formatting and linting hooks

## Test Files

The test files in `example_files.zip` contain intentional formatting issues:

- **Python**: Missing spaces, unused imports, formatting violations
- **JavaScript/TypeScript**: Inconsistent spacing, missing semicolons
- **Java**: Missing spaces, inconsistent formatting
- **Rust**: Formatting issues, missing spaces
- **YAML/TOML**: Indentation and formatting issues
- **SQL**: Long lines, missing formatting
- **Shell**: Missing spaces, formatting violations
- **Markdown**: Formatting inconsistencies

These files are designed to trigger our pre-commit hooks and demonstrate their effectiveness.
