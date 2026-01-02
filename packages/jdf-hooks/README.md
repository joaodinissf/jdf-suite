# Sensible Pre-Commit Hooks

A comprehensive Git hooks repository supporting both **lefthook** and **pre-commit**, providing fast local development with standardized CI/CD validation.

## Philosophy: Hybrid Approach

This repository supports **both** hook managers to get the best of both worlds:

| Feature | Lefthook | Pre-commit |
|---------|----------|------------|
| **Speed** | ⚡ Extremely fast (<1s commits) | Slower (5-10s commits) |
| **Parallelization** | Native parallel execution | Sequential by default |
| **Setup** | Requires tool installation | Auto-manages environments |
| **CI/CD** | Works, but less common | Industry standard |
| **Flexibility** | High (direct commands) | Moderate (hook-based) |
| **Best For** | Local development | CI/CD pipelines |

### Recommended Setup

- **Local Development**: Use **lefthook** for fast, parallel hook execution
- **CI/CD**: Use **pre-commit** for reproducible, standardized validation
- **Contributors**: Install both (5-10x faster locally, same results in CI)

Both configurations are **automatically kept in sync** and use the same tool settings from `.pre-commit/`.

## Documentation

- **[INTEGRATION.md](INTEGRATION.md)** - Add these hooks to your existing project
- **[MIGRATION.md](MIGRATION.md)** - Migrate from other hook managers
- **[UPDATE.md](UPDATE.md)** - Keep dependencies up to date
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

- YAML syntax validation
- End-of-file fixer
- Trailing whitespace trimmer
- Mixed line ending fixer
- Private key detector
- AWS credentials detector
- Large file checker (prevents files >500KB)

## Installation

### Quick Start (Recommended)

Run the interactive installation script:

```bash
./install.sh
```

The script will:

1. Detect available tools (lefthook, pre-commit)
1. Prompt you to choose: lefthook, pre-commit, or both
1. Install the selected hook(s)
1. Display test commands

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

Both lefthook and pre-commit use the same tool configurations from `.pre-commit/`:

- `.pre-commit/python/` - Python tool configs
- `.pre-commit/rust/` - Rust tool configs
- `.pre-commit/java/` - Java tool configs
- `.pre-commit/markdown/` - Markdown configs
- `.pre-commit/sql/` - SQL configs

### Customizing Hooks

**For Lefthook**: Edit `lefthook.yml`
**For Pre-commit**: Edit `.pre-commit-config.yaml`

Refer to `AGENTS.md` for guidelines on keeping both configurations in sync.

## ty Type Checker (Experimental)

### What is ty?

[ty](https://astral.sh/ty) is Astral's new Python type checker, written in Rust. It's **10-60x faster** than mypy/pyright but is currently in **early preview (v0.0.8)**.

### Current Status

⚠️ **ty is NOT production-ready**:

- Hundreds of open issues
- Missing essential features
- May occasionally fail
- Early preview release

**Recommendation**: Use **pyright** (default) for stable type checking. Try **ty** if you want to experiment with cutting-edge tooling.

### How to Enable ty

ty is **already enabled** in both configurations as an experimental hook:

- **Pre-commit**: ty hook runs alongside pyright
- **Lefthook**: ty runs in parallel with other checks

### Disabling ty

**Lefthook**: Comment out the `ty` job in `lefthook.yml`:

```yaml
# - name: ty
#   run: ty check {staged_files}
#   glob: '*.py'
```

**Pre-commit**: Comment out the ty hook in `.pre-commit-config.yaml`:

```yaml
# - repo: local
#   hooks:
#   - id: ty
#     ...
```

### Switching to mypy

To use mypy instead of pyright:

1. **Uncomment mypy** in `.pre-commit-config.yaml`
2. **Comment out pyright** in `.pre-commit-config.yaml`
3. **Update lefthook.yml** to use mypy instead of pyright
4. Install mypy: `uv tool install mypy` (for lefthook)

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

Test the pre-commit configuration:

```bash
python test/test_precommit.py
python test/test_precommit.py --verbose  # Show full diff
```

Test the lefthook configuration:

```bash
python test/test_lefthook.py
python test/test_lefthook.py --verbose  # Show full diff
```

Both test suites:

- Create a temporary workspace
- Extract example files with intentional issues
- Run all hooks
- Show the diff of changes made
- Verify hooks work correctly

## Getting Started

### New Project
See **[INTEGRATION.md](INTEGRATION.md)** for step-by-step instructions to add these hooks to your project.

### Existing Hooks
See **[MIGRATION.md](MIGRATION.md)** for migrating from husky, lint-staged, or other hook managers.

### Keeping Updated
See **[UPDATE.md](UPDATE.md)** for maintaining dependencies and hook versions.

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

### ty-Specific Issues

#### ty fails with "unresolved import"

- This is expected for missing dependencies in test files
- ty is experimental and may have false positives
- Consider disabling ty if it causes issues

#### ty is too strict/lenient

- ty is in early preview with limited configuration options
- Switch to pyright (default) or mypy for more control

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
3. Add test files to `test/example_files.zip` for new languages
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

**Version**: 2.0.0 | **Hybrid Approach**: Lefthook (local) + Pre-commit (CI)
