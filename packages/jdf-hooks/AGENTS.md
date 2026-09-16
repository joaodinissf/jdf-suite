# Guide for AI Coding Assistants

This document helps AI assistants (Claude, GitHub Copilot, GPT, etc.) understand this project and work with it effectively.

## Monorepo Context

This package lives at `packages/jdf-hooks/` within the **jdf-suite** monorepo (<https://github.com/joaodinissf/jdf-suite>). Paths in this guide are relative to the package directory unless noted. CI and release workflows live at the monorepo root: `.github/workflows/jdf-hooks-ci.yml` (path-filtered to this package) and `.github/workflows/jdf-hooks-release.yml` (triggered by `jdf-hooks-v*` tags).

## Project Overview

**Name**: JDF Hooks
**Purpose**: A comprehensive Git hooks framework with interactive CLI, supporting both **lefthook** and **pre-commit**
**Version**: 1.0.1 (assimilation into jdf-suite monorepo)

### What This Package Provides

A centralized collection of Git hooks for enforcing code quality across multiple languages and file types:

- **Python**: pycln, isort, ruff (format & check), ty
- **JavaScript/TypeScript**: prettier
- **Rust**: rustfmt, clippy
- **Java**: pmd, cpd, checkstyle (google-java-format temporarily removed in 1.0.1 — pending redesign without the git submodule; see [jdf-suite#4](https://github.com/joaodinissf/jdf-suite/issues/4))
- **Markdown**: markdownlint
- **YAML**: yamlfix
- **TOML**: taplo (format & lint)
- **SQL**: sqlfluff (Postgres)
- **Shell**: shfmt
- **General**: file checks, whitespace, line endings, security (private keys, large files)

### Architecture: Hybrid Approach

This package supports **two hook managers** with identical functionality:

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

CI/release workflows live at the monorepo root — see Monorepo Context above.

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
- Read-only checks (ty, ruff-check, clippy)
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

### Rule #5: ty is the Python Type Checker

[ty](https://github.com/astral-sh/ty) (Astral) is the **only** Python type checker in the templates and in this
project's own hooks (as of v1.1.0):

- ✅ `ty check` runs in both lefthook and pre-commit `python_typechecking` fragments
- ✅ Configure via `[tool.ty]` in `pyproject.toml` (this project uses `[tool.ty.src] exclude`)
- ❌ Do not reintroduce pyright or mypy jobs, hints, or commented "alternative" blocks — they drift

### Rule #6: Generated Files Are Owned by jdf-hooks

`setup` writes `.jdf-hooks.lock` (JSON: `jdf_hooks` version, `manager`, sorted `languages`, `files` → sha256)
alongside the generated files. This is the `npx skills` model — the lock is the provenance, updates overwrite:

- ✅ `generate_configs()` is the only writer; it renders through `render_all()` and then writes the lock
- ✅ `check_project()` (`jdf-hooks check`) compares lock ↔ disk ↔ a fresh render; it never writes
- ✅ `apply_update()` (`jdf-hooks update`) deletes obsolete files, then calls `generate_configs()` — it is
  all-or-nothing: any locally modified file makes it refuse (exit 1) unless `--force`
- ✅ `--add`/`--remove` change the language set through `check_project(languages=...)`; nothing else mutates the lock
- ✅ Users keep project-specific hooks in `lefthook-local.yml`; edits to generated files are reported as *modified*
- ✅ `--github-workflow` adds `.github/workflows/jdf-hooks.yml` (template `templates/github/`) to the generated
  set; the choice is recorded as `options.github_workflow` in the lock (absent = false, so older locks parse)
- ✅ **This package dogfoods itself**: `lefthook.yml` + `.jdf-hooks.lock` are generated (`--languages python
  --manager lefthook`). Change templates, then `uv run jdf-hooks update`; CI runs `jdf-hooks check`
- ✅ `tools.py` is the single table of external tools + install hints (used by `doctor`, post-setup hints, and
  the lefthook integration test)
- ❌ Never add in-file markers or merge logic — if a file needs preserving, it belongs outside the generated set
- ❌ Never put timestamps in generated files or the lock (generation must stay deterministic)
- ❌ `check`/`update` must never depend on the network; only the PyPI newer-version hint does, and it is
  best-effort (`pypi.latest_version()` returns None on any failure) and skippable (`--offline`)

### Rule #7: Version Management and Semantic Versioning

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

7. **Update CI** (if needed): Add tool installation to `.github/workflows/jdf-hooks-ci.yml` at the monorepo root

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
- Read-only checks (ruff-check, ty) are safe to overlap

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

`.github/workflows/jdf-hooks-ci.yml` at the monorepo root, path-filtered to `packages/jdf-hooks/**`, runs three jobs:

1. **unit-tests**: Run the pytest unit suite (`tests/test_generate.py`)
2. **integration**: Matrix-driven — runs `tests/integration/test_precommit.py` and `tests/integration/test_lefthook.py` in parallel (`matrix.manager ∈ [precommit, lefthook]`)
3. **validate-config**: `lefthook dump` to ensure `lefthook.yml` parses cleanly

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

### ❌ Multiple Python Type Checkers

**Wrong**:

```yaml
- id: pyright
- id: ty
```

**Right**:

```yaml
# ty is the sole type checker (see Rule #5)
- id: ty
  types: [python]
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
│   ├── generate.py             # Config generation (fragment-based); render_all() + lock write
│   ├── lock.py                 # .jdf-hooks.lock model + read/write
│   ├── check.py                # Drift detection for `jdf-hooks check`
│   ├── update.py               # plan_update()/apply_update() for `jdf-hooks update`
│   ├── tools.py                # External tool table + install hints (`doctor`)
│   ├── pypi.py                 # Best-effort newer-version lookup
│   └── templates/              # Bundled template library (shipped in wheel)
│       ├── precommit/          # Per-language pre-commit fragments (11 files)
│       ├── lefthook/           # Per-language lefthook fragments (11 files)
│       ├── github/             # Generated drift-check workflow (--github-workflow)
│       └── configs/            # Shared tool configurations
│           ├── markdown/markdownlint.json
│           ├── sql/.sqlfluff
│           ├── toml/taplo.toml
│           └── yaml/yamlfix.toml
├── tests/                      # Test suite
│   ├── test_generate.py        # Automated pytest tests
│   ├── test_lock.py            # Lock file round-trip / validation
│   ├── test_check.py           # Drift detection + `check` CLI exit codes
│   ├── test_update.py          # Update planning/apply + `update` CLI exit codes
│   ├── test_tools.py           # Tool table + `doctor`
│   ├── test_setup_cli.py       # Non-interactive setup + generated workflow
│   ├── test_pypi.py            # Newer-version hint (network mocked in conftest.py)
│   ├── test_refresh_revs.py    # scripts/refresh_revs.py parse/rewrite
│   ├── test_version.py         # __version__ matches pyproject.toml
│   └── integration/            # Integration tests (require actual tools)
│       ├── test_precommit.py
│       └── test_lefthook.py
├── hooks/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Tests both configs
│       └── release.yml         # Auto-release on tags
├── scripts/refresh_revs.py     # Maintainer: pre-commit autoupdate → fragment rev pins
├── lefthook.yml                # GENERATED by jdf-hooks (python, lefthook) — see Rule #6
├── .jdf-hooks.lock             # GENERATED — provenance for lefthook.yml
├── pyproject.toml              # Package definition
├── README.md                   # User documentation
├── AGENTS.md                   # This file
├── LICENSE
└── .gitignore
```

---

## Known Issues

- `pycln` only reads configuration via `--config`, so it cannot be told to skip
  `tests/integration/example_files` from `pyproject.toml`; the example files are only affected if staged.

## Version History

> **Note**: Version was reset to 1.0.0 for the first public PyPI release. Pre-release
> versions (v1.x–v4.x below) were internal development milestones under the old
> "sensible-hooks" name and are not published on PyPI.

- **v1.4.1** (PyPI): portable general checks
  - lefthook `general.yml` no longer reimplements pre-commit-hooks in shell (`sed -i ''` was macOS-only and a
    silent no-op on GNU sed; `check-yaml` needed PyYAML on the system python). The jobs now run the real
    `pre-commit-hooks` entry points via `uvx`, so lefthook and pre-commit behave identically on both platforms
  - `update` re-stamps the lock when a newer jdf-hooks runs it, even if no file content changed

- **v1.4.0** (PyPI): doctor, non-interactive setup, drift workflow, rev refresh, dogfooding
  - `setup --languages LANGS|auto --manager M --yes` runs without prompts; `setup/update --github-workflow`
    generates `.github/workflows/jdf-hooks.yml` (tracked in the lock under `options`)
  - New `jdf-hooks doctor`: tool presence per hook set with install hints (exit 1 if missing); `tools.py`
    is the shared table
  - `check` mentions a newer jdf-hooks on PyPI (best-effort, `--offline` / `JDF_HOOKS_OFFLINE=1`)
  - `scripts/refresh_revs.py` + monthly `jdf-hooks-refresh-revs.yml` workflow keep pre-commit `rev:` pins fresh
  - Templates: `ty check --force-exclude`, `isort --filter-files` so excludes apply to explicitly passed files
  - This package's `lefthook.yml` is now generated by jdf-hooks itself and verified by CI (`jdf-hooks check`)

- **v1.3.0** (PyPI): `jdf-hooks update`
  - New `jdf-hooks update [dir] [--add LANG] [--remove LANG] [--force] [--dry-run]`: regenerates from the lock,
    all-or-nothing (refuses when any file is modified locally unless `--force`); removing a language deletes
    its config files. Exit 0 = done/nothing to do, 1 = refused or dry-run pending, 2 = unmanaged
  - `check` gains the `obsolete` state and a `languages=` override; both commands hint at detected languages
    that are not in the hook set

- **v1.2.0** (PyPI): Lockfile + `jdf-hooks check`
  - `setup` now writes `.jdf-hooks.lock` (version, manager, languages, per-file sha256) — see Rule #6
  - New `jdf-hooks check [dir] [--diff]`: reports each generated file as up to date / update available /
    modified locally / missing; exit 0 = clean, 1 = drift, 2 = unmanaged (no lock)
  - `generate.py` split into `render_*` (pure) and write wrappers; `render_all()` is shared by setup and check
  - `__version__` is read from package metadata (was a hardcoded literal that had drifted)

- **v1.1.0** (PyPI): ty is the sole Python type checker
  - pyright removed from `lefthook.yml`, both `python_typechecking` template fragments, the CLI install hints,
    the integration test tool list, CI, and docs; the commented-out mypy "alternative" block is gone too
  - `[tool.pyright]` dropped from `pyproject.toml`; dev extra now installs `ty` instead of `pyright`
  - Lineage note: this package is the direct continuation of `joaodinissf/Sensible-Pre-Commit-Hooks`
    (history preserved through the v0.5.0 rename and the monorepo assimilation); nothing from that repo
    remains to be integrated

- **v1.0.1** (PyPI): Assimilation into jdf-suite monorepo
  - Package relocated from standalone `joaodinissf/jdf-hooks` to `joaodinissf/jdf-suite` under `packages/jdf-hooks/`
  - URL references updated (pyproject metadata, generated config headers, README badges)
  - Release pipeline: tags now `jdf-hooks-v*`, workflow `jdf-hooks-release.yml` at the monorepo root, PyPI trusted publisher rebound to the new repo
  - CI reorganized: two duplicated integration jobs collapsed into one matrix job
  - **Regression**: `google-java-format` hook removed from Java templates; the `hooks/gjfpc-hook` git submodule was excised in pursuit of a wholly self-sufficient package with no submodule dependencies. Tracking issue: [jdf-suite#4](https://github.com/joaodinissf/jdf-suite/issues/4). Other Java hooks (PMD, CPD, Checkstyle) are unaffected.
  - No other functional changes to the CLI or generated configs

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
- **Issue tracker**: <https://github.com/joaodinissf/jdf-suite/issues>
- **This file**: Reference for AI assistants and contributors

---

## Remember

🔄 **Always keep both configurations in sync**
🧪 **Always test both configurations**
⚡ **Respect sequential dependencies**
📝 **Document all changes**

This ensures users get a consistent experience whether they choose lefthook or pre-commit.
