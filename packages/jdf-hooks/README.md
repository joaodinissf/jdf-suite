# The Pre-Commit Hooks to Rule Them All

A centralized repository containing a comprehensive collection of pre-commit hooks for multiple programming languages and file types. This repository serves as a single source of truth for consistent code quality enforcement across all projects.

## Intent

This repository consolidates all the pre-commit hooks I use across different projects, providing:

- **Consistency**: Same code quality standards across all repositories
- **Maintainability**: Single place to update hook configurations
- **Reusability**: Easy to reference from any project
- **Comprehensiveness**: Covers multiple languages and file formats

## Repository Structure

- `.pre-commit-hooks.yaml` - Complete pre-commit configuration with hooks for various languages
- `.pre-commit-config.yaml` - Example showing how to reference this repository from other projects
- `install.sh` - Convenience script to install pre-commit hooks
- `README.md` - This documentation

## Usage

### Option 1: Copy Configuration

Copy the entire `.pre-commit-hooks.yaml` content to your project's `.pre-commit-config.yaml`.

### Option 2: Reference This Repository

Reference this repository directly in your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/joao/the-pre-commit-hooks-to-rule-them-all
    rev: main  # Use a specific tag for production
    hooks:
      - id: your-hook-id
```

### Installing Hooks

Run the convenience script to install pre-commit hooks:

```bash
./install.sh
```

The script automatically detects and uses either `pre-commit` or `uvx pre-commit` for installation.

## Supported Languages & Tools

The configuration includes hooks for:

- Python (Ruff, MyPy)
- Rust (rustfmt)
- JavaScript/TypeScript (Prettier)
- Markdown (markdownlint)
- TOML (Taplo)
- SQL (SQLFluff)
- YAML (yamlfix)
- General file checks (trailing whitespace, EOF, YAML syntax)
