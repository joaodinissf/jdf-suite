# JDF Hooks

[![CI Status](https://img.shields.io/github/actions/workflow/status/joaodinissf/jdf-hooks/ci.yml?branch=main&label=CI&logo=github)](https://github.com/joaodinissf/jdf-hooks/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/jdf-hooks?logo=python&logoColor=white)](https://pypi.org/project/jdf-hooks/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A comprehensive Git hooks framework with an **interactive CLI** to set up hooks for any project. Supports both **lefthook** and **pre-commit** for fast local development with standardized CI/CD validation.

## Quick Start

> **Note**: This package is not yet published on PyPI. For now, install directly from GitHub:
>
> ```bash
> uvx --from git+https://github.com/joaodinissf/jdf-hooks jdf-hooks setup
> ```

```bash
# Set up hooks in your project
cd your-project
jdf-hooks setup
```

The CLI will:

1. Auto-detect languages in your project
2. Let you select which hooks to enable
3. Ask which hook manager you prefer (lefthook, pre-commit, or both)
4. Generate the appropriate configuration files

## Philosophy: Hybrid Approach

This repository supports **both** hook managers to get the best of both worlds:

| Feature | Lefthook | Pre-commit |
| ------- | -------- | ---------- |
| **Speed** | Extremely fast (<1s commits) | Slower (5-10s commits) |
| **Parallelization** | Native parallel execution | Sequential by default |
| **Setup** | Requires tool installation | Auto-manages environments |
| **CI/CD** | Works, but less common | Industry standard |
| **Flexibility** | High (direct commands) | Moderate (hook-based) |
| **Best For** | Local development | CI/CD pipelines |

### Recommended Setup

- **Local Development**: Use **lefthook** for fast, parallel hook execution
- **CI/CD**: Use **pre-commit** for reproducible, standardized validation
- **Contributors**: Install both (5-10x faster locally, same results in CI)

## Documentation

- **[docs/INTEGRATION.md](docs/INTEGRATION.md)** - Add these hooks to your existing project
- **[docs/MIGRATION.md](docs/MIGRATION.md)** - Migrate from other hook managers
- **[docs/UPDATE.md](docs/UPDATE.md)** - Keep dependencies up to date
- **[AGENTS.md](AGENTS.md)** - Guidelines for AI assistants

## Supported Languages & Tools

### Python

- **pycln** - Remove unused imports
- **isort** - Sort imports
- **ruff** - Format and lint (replaces black + pylint)
- **pyright** - Type checking (default, fast)
- **ty** - Experimental type checker (10-60x faster, optional)

### JavaScript/TypeScript

- **prettier** - Format JS/TS/JSON/CSS/HTML/Markdown

### Rust

- **rustfmt** - Format Rust code
- **clippy** - Rust linter

### Java

- **google-java-format** - Format Java code
- **PMD** - Java linter
- **CPD** - Copy-paste detector
- **Checkstyle** - Java style checker

### Markdown

- **markdownlint** - Lint Markdown files

### YAML

- **yamlfix** - Format YAML files

### TOML

- **taplo** - Format and lint TOML files

### SQL

- **sqlfluff** - Format and lint SQL (Postgres dialect)

### Shell

- **shfmt** - Format shell scripts

### General File Checks

- **keep-sorted** - Automatically maintain sorted blocks in files
- YAML syntax validation
- End-of-file fixer
- Trailing whitespace trimmer
- Mixed line ending fixer
- Private key detector
- AWS credentials detector
- Large file checker (prevents files >500KB)

## Installation

### Using the CLI (Recommended)

```bash
# Install the CLI tool
pip install jdf-hooks

# Navigate to your project
cd your-project

# Run the interactive setup
jdf-hooks setup
```

### Manual Installation

#### Lefthook

1. Install lefthook:

```bash
# macOS
brew install lefthook

# Or using npm
npm install -g lefthook

# Or using Go
go install github.com/evilmartians/lefthook@latest
```

1. Install hooks:

```bash
lefthook install
```

1. Test:

```bash
lefthook run pre-commit --all-files
```

#### Pre-commit

1. Install pre-commit:

```bash
# Using uv (recommended)
uv tool install pre-commit

# Or using pipx
pipx install pre-commit

# Or using pip
pip install pre-commit
```

1. Install hooks:

```bash
pre-commit install
```

1. Test:

```bash
pre-commit run --all-files
```

## Tool Installation (for Lefthook)

Lefthook requires tools to be installed in your PATH. Pre-commit auto-manages environments, so this is only needed for lefthook.

### Python Tools

```bash
# Using uv (recommended)
uv tool install pycln isort ruff pyright yamlfix sqlfluff

# Or using pipx
pipx install pycln isort ruff pyright yamlfix sqlfluff
```

### JavaScript Tools

```bash
npm install -g prettier markdownlint-cli
```

### Rust Tools

```bash
# Add rustfmt and clippy components
rustup component add rustfmt clippy

# Install taplo for TOML
cargo install taplo-cli
```

### Shell Tools

```bash
# macOS
brew install shfmt

# Ubuntu/Debian
sudo apt-get install shfmt

# Arch Linux
sudo pacman -S shfmt
```

### Java Tools

Java tools (google-java-format, PMD, Checkstyle) are managed automatically by the hooks. CPD is bundled with PMD.

### General Tools

```bash
# Install keep-sorted using Go
go install github.com/google/keep-sorted/cmd/keep-sorted@latest
```

## Usage

### Using Lefthook

Run hooks on staged files:

```bash
git commit
```

Run hooks on all files:

```bash
lefthook run pre-commit --all-files
```

Skip hooks (not recommended):

```bash
LEFTHOOK=0 git commit
```

Skip specific hooks:

```bash
LEFTHOOK_EXCLUDE=ruff-check,pyright git commit
```

### Using Pre-commit

Run hooks on staged files:

```bash
git commit
```

Run hooks on all files:

```bash
pre-commit run --all-files
```

Skip hooks (not recommended):

```bash
SKIP=all git commit
```

Skip specific hooks:

```bash
SKIP=ruff-check,pyright git commit
```

Update hook versions:

```bash
pre-commit autoupdate
```

## Configuration

### Shared Tool Settings

Both lefthook and pre-commit use the same tool configurations from `configs/`:

- `configs/markdown/` - Markdown configs
- `configs/yaml/` - YAML configs
- `configs/toml/` - TOML configs
- `configs/sql/` - SQL configs

### Customizing Hooks

**For Lefthook**: Edit `lefthook.yml`
**For Pre-commit**: Edit `.pre-commit-config.yaml`

Refer to `AGENTS.md` for guidelines on keeping both configurations in sync.

## Project Structure

```text
jdf-hooks/
├── src/jdf_hooks/     # Python CLI package
│   ├── cli.py              # Interactive CLI
│   ├── detect.py           # Language detection
│   └── generate.py         # Config generation
├── configs/                # Tool configuration files
│   ├── markdown/
│   ├── yaml/
│   ├── toml/
│   └── sql/
├── tests/                  # Test suite
├── docs/                   # Documentation
├── .pre-commit-config.yaml # Pre-commit hooks config
├── lefthook.yml            # Lefthook config
└── pyproject.toml          # Package definition
```

## CI/CD Integration

### GitHub Actions (Pre-commit)

```yaml
name: CI
on: [push, pull_request]

jobs:
  pre-commit:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v5
    - uses: actions/setup-python@v6
    - uses: pre-commit/action@v4.0.0
```

### GitHub Actions (Lefthook)

```yaml
name: CI
on: [push, pull_request]

jobs:
  lefthook:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v5
    - name: Install lefthook
      run: npm install -g lefthook
    - name: Install tools
      run: |
        pip install pycln isort ruff pyright yamlfix sqlfluff
        npm install -g prettier markdownlint-cli
        rustup component add rustfmt clippy
    - name: Run lefthook
      run: lefthook run pre-commit --all-files
```

**Recommendation**: Use pre-commit in CI for standardization. This repository's CI runs **both** configurations to ensure consistency.

## Testing

Run the automated test suite:

```bash
uv run pytest tests/test_generate.py
```

Run integration tests (requires actual tools installed):

```bash
uv run python tests/integration/test_precommit.py --verbose
uv run python tests/integration/test_lefthook.py --verbose
```

## Troubleshooting

### Lefthook Issues

#### Hook fails with "command not found"

- Install the missing tool (see Tool Installation section)
- Verify tool is in your PATH: `which <tool>`

#### Lefthook hooks are slow

- Check if tools are using network (especially Docker-based hooks)
- Verify parallel execution is enabled in `lefthook.yml`

#### Hooks don't run

- Verify installation: `lefthook run pre-commit --all-files`
- Check lefthook.yml syntax: `lefthook dump`

### Pre-commit Issues

#### Hooks fail to install

- Update pre-commit: `uv tool install --force pre-commit`
- Clear cache: `pre-commit clean`

#### Pre-commit hooks are slow

- Pre-commit creates isolated environments (this is expected)
- Consider using lefthook for local development

#### Hook version conflicts

- Update hooks: `pre-commit autoupdate`
- Clear cache: `pre-commit clean`

### General Issues

#### Hooks modified files but commit still fails

- Re-stage modified files: `git add .`
- Commit again (hooks will pass on second run)

#### Java hooks fail

- Ensure JDK 11+ is installed: `java -version`
- Check Docker is running (for PMD)

## Contributing

Contributions welcome! Please:

1. Keep lefthook and pre-commit configurations in sync
2. Update `AGENTS.md` when adding new hooks
3. Add test files to `tests/example_files.zip` for new languages
4. Update this README with new tools/hooks
5. Test both configurations before submitting

## License

MIT License - See LICENSE file for details

## Acknowledgments

Built with:

- [lefthook](https://github.com/evilmartians/lefthook) - Fast Git hooks manager
- [pre-commit](https://pre-commit.com) - Multi-language Git hooks framework
- [Astral](https://astral.sh) - ruff, uv, ty, and other amazing Python tooling
- All the amazing open-source tools integrated in this repository

---

**Version**: 1.0.0 | **Hybrid Approach**: Lefthook (local) + Pre-commit (CI)
