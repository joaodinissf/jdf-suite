# Guide for AI Coding Assistants

This document helps AI assistants (Claude, GitHub Copilot, GPT, etc.) understand this project and work with it effectively.

## Project Overview

**Name**: JDF Hooks
**Purpose**: A comprehensive Git hooks framework with interactive CLI, supporting both **lefthook** and **pre-commit**
**Version**: 1.0.0 (Fragment-based templates + CLI UX + automated tests)

### What This Repository Provides

A centralized collection of Git hooks for enforcing code quality across multiple languages and file types:

- **Python**: pycln, isort, ruff (format & check), mypy, ty (experimental)
- **JavaScript/TypeScript**: prettier
- **Rust**: rustfmt, clippy
- **Java**: google-java-format, pmd, cpd, checkstyle
- **Markdown**: markdownlint
- **YAML**: yamlfix
- **TOML**: taplo (format & lint)
- **SQL**: sqlfluff (Postgres)
- **Shell**: shfmt
- **General**: file checks, whitespace, line endings, security (private keys, large files)

### Architecture: Hybrid Approach

This repository supports **two hook managers** with identical functionality:

1. **lefthook** (`lefthook.yml`) - Fast local development
   - Parallel execution
   - Direct command invocation
   - 5-10x faster commits
   - Requires tools pre-installed

2. **pre-commit** (generated `.pre-commit-config.yaml`) - Standardized CI/CD
   - Hermetic environments
   - Automatic tool installation
   - Industry standard
   - Reproducible builds

**Recommended workflow**: Developers use lefthook locally, CI uses pre-commit.

### Key Files

| File | Purpose |
| ---- | ------- |
| `src/jdf_hooks/` | Python CLI package |
| `src/jdf_hooks/cli.py` | Interactive CLI entry point |
| `src/jdf_hooks/detect.py` | Language detection |
| `src/jdf_hooks/generate.py` | Config file generation |
| `src/jdf_hooks/templates/` | Bundled template library (shipped in wheel) |
| `src/jdf_hooks/templates/precommit/*.yml` | Per-language pre-commit fragments (11 files) |
| `src/jdf_hooks/templates/lefthook/*.yml` | Per-language lefthook fragments (11 files) |
| `src/jdf_hooks/templates/configs/` | Shared tool configurations (markdownlint, sqlfluff, taplo, yamlfix) |
| `lefthook.yml` | This project's own lefthook config (Python-only) |
| `tests/test_generate.py` | Automated pytest test suite |
| `tests/integration/test_precommit.py` | Pre-commit integration test |
| `tests/integration/test_lefthook.py` | Lefthook integration test |
| `README.md` | User-facing documentation |
| `pyproject.toml` | Package definition and tool configs |
| `.github/workflows/ci.yml` | CI testing both configurations |

---

## Critical Rules for AI Assistants

### Rule #1: Keep Configurations in Sync

⚠️ **MOST IMPORTANT**: `lefthook.yml` and `.pre-commit-config.yaml` **MUST** stay functionally identical.

When modifying hooks:

1. ✅ **Update BOTH files** - Never update just one
2. ✅ **Test BOTH configurations** - Run both test suites
3. ✅ **Verify parity** - Ensure both produce the same results
4. ✅ **Document changes** - Update README.md if adding/removing hooks

**Example**: Adding a new Python linter:

```diff
# In .pre-commit-config.yaml
+ - repo: https://github.com/example/new-linter
+   rev: v1.0.0
+   hooks:
+   - id: new-linter

# In lefthook.yml
+ 07-new-linter:
+   glob: "*.py"
+   run: new-linter {staged_files}
```

### Rule #2: Respect Sequential Dependencies

Some hooks **cannot** run in parallel due to dependencies:

**Python formatters (MUST run in sequence)**:

1. `pycln` - Removes unused imports
2. `isort` - Sorts imports
3. `ruff-format` - Formats code

These modify the same files and conflict if run concurrently.

**Implementation**:

- In `lefthook.yml`: Use number prefixes (`01-pycln`, `02-isort`, `03-ruff-format`)
- In `.pre-commit-config.yaml`: Order matters (repos listed sequentially)

**Safe to parallelize**:

- Different languages (Python vs Rust vs JS)
- Read-only checks (mypy, ruff-check, clippy)
- Independent formatters (shfmt vs prettier)

### Rule #3: Tool Configuration Consistency

Both hook managers use the **same** tool configurations in `src/jdf_hooks/templates/configs/`:

```text
src/jdf_hooks/templates/configs/
├── markdown/markdownlint.json
├── sql/.sqlfluff
├── toml/taplo.toml
└── yaml/yamlfix.toml
```

When modifying tool behavior:

- ✅ Edit config files in `src/jdf_hooks/templates/configs/`
- ❌ Don't add tool-specific flags to just one hook manager

### Rule #4: Test Both Configurations

Before committing changes:

```bash
# Automated tests (fast, no external tools)
uv run pytest tests/test_generate.py

# Integration tests (require tools installed)
uv run python tests/integration/test_precommit.py --verbose
uv run python tests/integration/test_lefthook.py --verbose

# Validate configurations
pre-commit validate-config
lefthook dump
```

### Rule #5: ty is Experimental

The `ty` type checker is **optional and experimental** (v0.0.8):

- ❌ **Never** make ty the default
- ✅ **Always** keep pyright as default
- ✅ Document experimental status
- ✅ Keep ty as an additional experimental checker

### Rule #6: Version Management and Semantic Versioning

⚠️ **CRITICAL**: After EVERY commit to main, create and push an appropriate semantic version tag.

**Semantic Versioning (SemVer)**:

- **Major (X.0.0)**: Breaking changes (incompatible API/config changes)
- **Minor (x.Y.0)**: New features (backwards-compatible additions)
- **Patch (x.y.Z)**: Bug fixes, docs, tests (no functional changes)

**Workflow for EVERY commit**:

```bash
# 1. Make your changes and commit
git add .
git commit -m "type: description"

# 2. Create tag (REQUIRED)
git tag -a vX.Y.Z -m "vX.Y.Z - Brief description"

# 3. Push both commit and tag
git push && git push origin vX.Y.Z
```

**Examples**:

```bash
# Patch: Fix tests
git commit -m "fix: update tests to use configs/ directory"
git tag -a v3.0.2 -m "v3.0.2 - Fix test directory references"
git push && git push origin v3.0.2

# Minor: Add new hook
git commit -m "feat: add prettier-java formatter"
git tag -a v3.1.0 -m "v3.1.0 - Add Java formatting support"
git push && git push origin v3.1.0

# Major: Breaking change
git commit -m "feat!: restructure as Python package"
git tag -a v3.0.0 -m "v3.0.0 - Interactive CLI and repository restructure"
git push && git push origin v3.0.0
```

**Documentation updates** (for major/minor releases only):

- ✅ `src/jdf_hooks/__init__.py` - `__version__ = "X.Y.Z"`
- ✅ `README.md` - Footer: `**Version**: X.Y.Z`
- ✅ `AGENTS.md` - Project Overview: `**Version**: X.Y.Z`
- ✅ `pyproject.toml` - `version = "X.Y.Z"`

---

## Common Modification Scenarios

### Adding a New Hook

**Steps**:

1. **Research the tool**: Find official repo, understand configuration
2. **Add to `.pre-commit-config.yaml`**:

   ```yaml
   - repo: https://github.com/tool/repo
     rev: v1.0.0
     hooks:
     - id: tool-name
       types: [python]  # or appropriate file type
   ```

3. **Add to `lefthook.yml`**:

   ```yaml
   XX-tool-name:  # Use appropriate number prefix
     glob: "*.py"
     run: tool-name {staged_files}
   ```

4. **Add tool config** (if needed) to `configs/tool-name/config.ext`

5. **Update README.md**: Document the new tool

6. **Test both configs**: Run both test suites

7. **Update CI** (if needed): Add tool installation to `.github/workflows/ci.yml`

### Removing a Hook

**Steps**:

1. **Remove from `.pre-commit-config.yaml`**: Delete entire repo section
2. **Remove from `lefthook.yml`**: Delete command entry
3. **Remove config files** (if any): Delete from `configs/`
4. **Update README.md**: Remove from documentation
5. **Update CI** (if needed): Remove tool installation
6. **Test both configs**

### Modifying a Hook

**Steps**:

1. **Understand the change**: What behavior is changing?
2. **Update config file** in `configs/` (if applicable)
3. **Update arguments** in BOTH `.pre-commit-config.yaml` and `lefthook.yml`
4. **Test both configs**
5. **Document in README.md** if user-visible

---

## Lefthook-Specific Considerations

### Command Naming and Ordering

Lefthook executes commands in **alphabetical order** by name (when `parallel: false` or in sequential groups).

**Pattern**: Use number prefixes for explicit ordering:

```yaml
pre-commit:
  parallel: false  # or true with grouped sequential commands
  commands:
    01-first-step:
      run: ...
    02-second-step:
      run: ...
    10-unrelated-check:
      run: ...
```

### Parallel Execution Strategy

**Current approach** (as of v2.0.0):

```yaml
pre-commit:
  parallel: true  # Enable parallel execution for speed
  commands:
    # Sequential Python formatters (01, 02, 03)
    01-pycln:
      glob: "*.py"
      run: pycln --all {staged_files}

    02-isort:
      glob: "*.py"
      run: isort {staged_files}

    03-ruff-format:
      glob: "*.py"
      run: ruff format {staged_files}

    # Parallel-safe checks (different languages/read-only)
    04-ruff-check:  # Read-only, safe to overlap
      glob: "*.py"
      run: ruff check {staged_files}

    10-prettier:  # Different language, runs in parallel
      glob: "*.{js,ts,json}"
      run: npx prettier --write {staged_files}

    20-rustfmt:  # Different language, runs in parallel
      glob: "*.rs"
      run: rustfmt {staged_files}
```

**Why this works**:

- Number prefixes ensure formatters run 01 → 02 → 03 before other commands start
- Different language tools (10, 20, 30) can run truly in parallel
- Read-only checks (ruff-check, mypy) are safe to overlap

**Future alternative** (when [Issue #846](https://github.com/evilmartians/lefthook/issues/846) is resolved):

```yaml
commands:
  pycln:
    priority: 1
    run: pycln --all {staged_files}

  isort:
    priority: 2
    run: isort {staged_files}

  prettier:
    priority: 1  # Runs in parallel with pycln
    run: npx prettier --write {staged_files}
```

### Template Variables

Lefthook provides these template variables:

- `{staged_files}` - Files staged for commit (most common)
- `{all_files}` - All tracked files
- `{push_files}` - Files in commits being pushed
- `{files}` - Custom file list

**Usage**:

```yaml
run: tool-name {staged_files}  # Pass files to tool
```

**Exception** - Some tools don't accept file lists:

```yaml
clippy:
  glob: "*.rs"
  run: cargo clippy --all-targets
  pass_filenames: false  # Don't append {staged_files}
```

---

## Pre-commit-Specific Considerations

### Repository Types

**Remote repositories**:

```yaml
- repo: https://github.com/tool/repo
  rev: v1.0.0
  hooks:
  - id: hook-name
```

**Local hooks** (for tools not in pre-commit ecosystem):

```yaml
- repo: local
  hooks:
  - id: custom-tool
    name: Custom Tool
    entry: custom-tool
    language: system
    types: [python]
```

### Language Types

Common language specifiers:

- `language: python` - Uses Python environment
- `language: node` - Uses Node environment
- `language: system` - Uses system-installed tool
- `language: rust` - Uses Rust environment

### File Filtering

**By type**:

```yaml
types: [python]  # Only .py files
types_or: [python, pyi, jupyter]  # Multiple types
```

**By glob pattern**:

```yaml
files: '^src/.*\.py$'  # Regex pattern
exclude: '^tests/'  # Exclude pattern
```

---

## Testing Strategy

### Test Suites

Both test suites (`tests/test_precommit.py` and `tests/test_lefthook.py`):

1. Check tool installation
2. Create temporary workspace
3. Use `tests/integration/example_files/` (intentionally badly-formatted files)
4. Run hooks
5. Verify files are fixed consistently

**Expected behavior**: Both test suites should produce **identical** formatting results.

### Manual Testing

```bash
# Validate configurations
lefthook dump
pre-commit validate-config

# Run on test files
uv run python tests/test_precommit.py --verbose
uv run python tests/test_lefthook.py --verbose

# Run on real repository
lefthook run pre-commit --all-files
pre-commit run --all-files

# Compare results (should be identical)
git diff
```

---

## CI/CD Pipeline

`.github/workflows/ci.yml` runs three jobs:

1. **test-precommit**: Test pre-commit configuration
2. **test-lefthook**: Test lefthook configuration
3. **validate-configs**: Validate YAML syntax

**When modifying hooks**:

- CI must pass for both test suites
- Both configs must be validated
- No test failures allowed

---

## Common Pitfalls

### ❌ Updating Only One Config

**Wrong**:

```yaml
# Only updating .pre-commit-config.yaml
- repo: https://github.com/new/tool
  rev: v1.0.0
  hooks:
  - id: new-tool

# Forgetting to update lefthook.yml
```

**Right**:

```yaml
# Update .pre-commit-config.yaml
- repo: https://github.com/new/tool
  rev: v1.0.0
  hooks:
  - id: new-tool

# AND update lefthook.yml
new-tool:
  glob: "*.py"
  run: new-tool {staged_files}
```

### ❌ Breaking Sequential Dependencies

**Wrong**:

```yaml
# Running formatters in random order
ruff-format:
  run: ruff format {staged_files}
isort:
  run: isort {staged_files}
pycln:
  run: pycln {staged_files}
```

**Right**:

```yaml
# Enforcing order with number prefixes
01-pycln:
  run: pycln {staged_files}
02-isort:
  run: isort {staged_files}
03-ruff-format:
  run: ruff format {staged_files}
```

### ❌ Inconsistent Tool Configurations

**Wrong**:

```yaml
# Different line length in each config
# .pre-commit-config.yaml
- id: black
  args: [--line-length=88]

# lefthook.yml
black:
  run: black --line-length=120 {staged_files}
```

**Right**:

```yaml
# Use shared config file
# .pre-commit/python/pyproject.toml
[tool.black]
line-length = 88

# Both configs reference the same file
```

### ❌ Making ty the Default

**Wrong**:

```yaml
# Uncommenting ty, commenting mypy
# - id: mypy
- id: ty
```

**Right**:

```yaml
# Keep mypy as default, ty commented
- id: mypy
  types: [python]

# EXPERIMENTAL: ty (uncomment to use)
# - id: ty
#   types: [python]
```

---

## File Organization

```text
.
├── src/jdf_hooks/         # Python CLI package
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py                  # Interactive CLI
│   ├── detect.py               # Language detection
│   ├── generate.py             # Config generation (fragment-based)
│   └── templates/              # Bundled template library (shipped in wheel)
│       ├── precommit/          # Per-language pre-commit fragments (11 files)
│       ├── lefthook/           # Per-language lefthook fragments (11 files)
│       └── configs/            # Shared tool configurations
│           ├── markdown/markdownlint.json
│           ├── sql/.sqlfluff
│           ├── toml/taplo.toml
│           └── yaml/yamlfix.toml
├── tests/                      # Test suite
│   ├── test_generate.py        # Automated pytest tests
│   └── integration/            # Integration tests (require actual tools)
│       ├── test_precommit.py
│       └── test_lefthook.py
├── hooks/
│   └── gjfpc-hook/             # Git submodule for Java formatting
├── .github/
│   └── workflows/
│       ├── ci.yml              # Tests both configs
│       └── release.yml         # Auto-release on tags
├── lefthook.yml                # Project-specific lefthook (Python-only)
├── pyproject.toml              # Package definition
├── README.md                   # User documentation
├── AGENTS.md                   # This file
├── LICENSE
└── .gitignore
```

---

## Version History

> **Note**: Version was reset to 1.0.0 for the first public PyPI release. Pre-release
> versions (v1.x–v4.x below) were internal development milestones under the old
> "sensible-hooks" name and are not published on PyPI.

- **v1.0.0** (PyPI): Fragment-based templates + CLI UX + automated tests (first public release)
  - Breaking: monolithic templates replaced by per-language fragment files
  - Breaking: `extract_sections()` and `LANGUAGE_SECTIONS` removed
  - New: `load_fragments()` and `LANGUAGE_FRAGMENTS` for fragment-based generation
  - New: overwrite confirmation prompt before writing files
  - New: prominent "Run this now:" install guidance after setup
  - New: automated pytest test suite (`tests/test_generate.py`)
  - Old manual tests moved to `tests/integration/`

### Pre-release history (internal, not on PyPI)

- **v4.0.0**: Bundle templates as package data for uvx support
- **v3.0.0**: Python CLI + repository restructure
- **v2.0.0**: Hybrid architecture (lefthook + pre-commit)
- **v1.x**: Pre-commit only

---

## Quick Reference for Common Tasks

### Always Use uv for Python Commands

⚠️ **IMPORTANT**: Always use `uv run python` instead of bare `python` commands to ensure consistent Python environment across different systems.

```bash
# ✅ CORRECT - Use uv
uv run python tests/test_precommit.py
uv run python tests/test_lefthook.py
uv run python -m jdf_hooks setup

# ❌ INCORRECT - Avoid bare python
python tests/test_precommit.py
python -m jdf_hooks setup
```

**Why this matters**:

- `uv run python` creates a consistent virtual environment
- Works across different systems regardless of system Python installation
- Ensures reproducible results in CI and local development

### Adding Python Linter

1. Add to `.pre-commit-config.yaml`:

   ```yaml
   - repo: https://github.com/tool/repo
     rev: v1.0.0
     hooks:
     - id: tool-name
       types: [python]
   ```

2. Add to `lefthook.yml`:

   ```yaml
   0X-tool-name:  # Choose appropriate number
     glob: "*.py"
     run: tool-name {staged_files}
   ```

3. Update README.md
4. Test both configs

### Adding JavaScript Formatter

1. Add to `.pre-commit-config.yaml`:

   ```yaml
   - repo: local
     hooks:
     - id: tool-name
       entry: npx tool-name --write
       language: system
       types: [javascript]
   ```

2. Add to `lefthook.yml`:

   ```yaml
   1X-tool-name:
     glob: "*.js"
     run: npx tool-name --write {staged_files}
   ```

3. Update README.md
4. Update CI to install tool (`npm install -g tool-name`)
5. Test both configs

### Changing Tool Arguments

1. If tool has config file: Edit `configs/tool-name/config.ext`
2. If using CLI args: Update BOTH `.pre-commit-config.yaml` AND `lefthook.yml`
3. Test both configs

---

## Getting Help

- **Lefthook docs**: <https://lefthook.dev/>
- **Pre-commit docs**: <https://pre-commit.com/>
- **Issue tracker**: <https://github.com/joaodinissf/jdf-hooks/issues>
- **This file**: Reference for AI assistants and contributors

---

## Remember

🔄 **Always keep both configurations in sync**
🧪 **Always test both configurations**
⚡ **Respect sequential dependencies**
📝 **Document all changes**

This ensures users get a consistent experience whether they choose lefthook or pre-commit.
