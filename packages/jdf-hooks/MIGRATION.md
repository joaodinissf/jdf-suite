# Migration Guide: Hybrid Lefthook + Pre-commit (v2.0.0)

This guide helps you migrate to the hybrid approach using both lefthook (local development) and pre-commit (CI/CD).

## Understanding the Hybrid Approach

The hybrid approach uses:

- **Lefthook** locally for fast, parallel hook execution (<1s commits)
- **Pre-commit** in CI/CD for reproducible, standardized validation

```mermaid
graph LR
    Dev[Developer] -->|git commit| LH[Lefthook]
    LH -->|Fast validation| Commit[Local Commit]
    Commit -->|git push| CI[CI/CD Pipeline]
    CI -->|pre-commit run| Validate[Standardized Validation]
    Validate -->|✓ Pass| Merge[Merge]
```

### Why This Approach?

| Aspect | Benefit |
|--------|---------|
| **Speed** | Lefthook runs in <1s locally (5-10x faster than pre-commit) |
| **Reliability** | Pre-commit in CI ensures consistent validation |
| **Developer Experience** | Fast local commits, no CI surprises |
| **Team Standards** | Pre-commit enforces consistent tool versions |

## Migration Scenarios

### Scenario 1: Currently Using Pre-commit Only

**Status**: You have `.pre-commit-config.yaml` and run `pre-commit` locally.

**Goal**: Add lefthook for faster local development, keep pre-commit in CI.

**Steps**:

1. Install lefthook: `brew install lefthook` (or `npm install -g lefthook`)
1. Copy `lefthook.yml` from this repository to your project
1. Install required tools (see Tool Installation section)
1. Install lefthook hooks: `lefthook install`
1. Test: `lefthook run pre-commit --all-files`
1. Update CI to use pre-commit (if not already)
1. Team communication: Share installation instructions

### Scenario 2: Currently Using Lefthook Only

**Status**: You have `lefthook.yml` and run hooks locally.

**Goal**: Add pre-commit for standardized CI validation.

**Steps**:

1. Install pre-commit: `uv tool install pre-commit`
1. Copy `.pre-commit-config.yaml` from this repository
1. Install pre-commit hooks: `pre-commit install`
1. Test both: Compare outputs to ensure consistency
1. Update CI to use pre-commit
1. Keep lefthook for local development

### Scenario 3: Using Other Hook Managers (husky, lint-staged, etc.)

**Status**: You use husky, lint-staged, or other Git hook managers.

**Goal**: Migrate to hybrid lefthook + pre-commit approach.

**Steps**:

1. Document your current hook configuration
1. Map hooks to equivalent tools in this repository
1. Install both lefthook and pre-commit
1. Copy configurations from this repository
1. Install required tools
1. Test with `--all-files` to compare results
1. Remove old hook manager once validated
1. Update CI to use pre-commit

### Scenario 4: No Hooks Currently

**Status**: Fresh start, no existing Git hooks.

**Goal**: Set up hybrid approach from scratch.

**Steps**:

1. Run `./install.sh` (chooses both when prompted)
1. Install required tools (see Tool Installation)
1. Test: `lefthook run pre-commit --all-files`
1. Set up CI with pre-commit
1. Team onboarding documentation

## Step-by-Step Instructions

### 1. Install Lefthook

Choose one method:

```bash
# macOS
brew install lefthook

# npm
npm install -g lefthook

# Go
go install github.com/evilmartians/lefthook@latest

# Verify
lefthook version  # Should show 2.0.0+
```

### 2. Install Required Tools

#### Python Tools

```bash
# Using uv (recommended)
uv tool install pycln isort ruff pyright yamlfix sqlfluff

# Or using pipx
pipx install pycln isort ruff pyright yamlfix sqlfluff

# Verify
pycln --version
isort --version
ruff --version
pyright --version
```

#### JavaScript Tools

```bash
npm install -g prettier markdownlint-cli

# Verify
prettier --version
markdownlint --version
```

#### Rust Tools

```bash
# Add components
rustup component add rustfmt clippy

# Install taplo for TOML
cargo install taplo-cli

# Verify
rustfmt --version
cargo clippy --version
taplo --version
```

#### Shell Tools

```bash
# macOS
brew install shfmt

# Ubuntu/Debian
sudo apt-get install shfmt

# Arch Linux
sudo pacman -S shfmt

# Verify
shfmt -version
```

### 3. Configure Your Project

Copy configuration files:

```bash
# From this repository
cp lefthook.yml /path/to/your/project/
cp -r .pre-commit/ /path/to/your/project/
cp .pre-commit-config.yaml /path/to/your/project/
```

Or reference this repository directly in your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/yourusername/sensible-pre-commit-hooks
    rev: v2.0.0  # Use specific version
    hooks:
      - id: your-hook-id
```

### 4. Install Hooks

```bash
# Lefthook
lefthook install

# Pre-commit
pre-commit install

# Verify both are installed
ls -la .git/hooks/
```

### 5. Test the Setup

Test with example files:

```bash
# Lefthook (fast)
lefthook run pre-commit --all-files

# Pre-commit (comprehensive)
pre-commit run --all-files

# Both should produce similar results
```

### 6. Set Up CI

#### GitHub Actions

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

#### GitLab CI

```yaml
pre-commit:
  image: python:3.12
  script:
  - pip install pre-commit
  - pre-commit run --all-files
```

## ty Migration (Experimental)

### Why ty?

ty is Astral's new Python type checker, **10-60x faster** than mypy/pyright.

### Current Status (v0.0.8)

⚠️ **Not production-ready**:

- Early preview release
- Hundreds of open issues
- Missing essential features
- May fail unexpectedly

### Installation

```bash
# Install ty
uv tool install ty

# Verify
ty version  # Should show v0.0.8+
```

### Configuration

ty is **already enabled** in both configurations as an experimental hook.

**Lefthook (`lefthook.yml`)**:

```yaml
- name: ty
  run: ty check {staged_files}
  glob: '*.py'
```

**Pre-commit (`.pre-commit-config.yaml`)**:

```yaml
- repo: local
  hooks:
  - id: ty
    name: ty (experimental type checker)
    entry: ty check
    language: system
    types: [python]
```

### Testing

Run ty alongside pyright to compare:

```bash
# Run both type checkers
lefthook run pre-commit --all-files

# Check for differences in output
git diff
```

### Comparison: mypy vs pyright vs ty

| Feature | mypy | pyright | ty |
|---------|------|---------|-----|
| **Speed** | Slow | Fast | Very Fast (10-60x) |
| **Accuracy** | High | High | Medium (preview) |
| **Stability** | Stable | Stable | Experimental |
| **Configuration** | Extensive | Moderate | Limited |
| **Recommendation** | Alternative | Default | Experimental |

### Handling Specific Cases

**False Positives**:

```bash
# Skip ty for specific commit
LEFTHOOK_EXCLUDE=ty git commit
```

**Switch Back to mypy**:

1. Comment out ty in both configurations
1. Uncomment mypy in `.pre-commit-config.yaml`
1. Update `lefthook.yml` to use mypy
1. Install mypy: `uv tool install mypy`

### Recommendation

**Wait for stable release** (v1.0.0+) before using ty in production. Use pyright (default) for now.

## Troubleshooting

### Installation Issues

#### Lefthook not found

```bash
# Verify installation
which lefthook

# If not found, reinstall
brew install lefthook  # macOS
npm install -g lefthook  # npm
```

#### Pre-commit not found

```bash
# Verify installation
which pre-commit

# If not found, reinstall
uv tool install pre-commit
```

### Runtime Issues

#### Hooks fail with "command not found"

Missing tool in PATH. Install it:

```bash
# Example: pycln not found
uv tool install pycln

# Verify
which pycln
pycln --version
```

#### Hooks are extremely slow

Check for network-dependent tools:

```bash
# Docker-based hooks (PMD, Checkstyle)
# Ensure Docker is running
docker ps

# Pre-commit downloading environments
# This is normal for first run, subsequent runs are cached
```

#### Hooks modify files but commit still fails

Re-stage modified files:

```bash
git add .
git commit  # Try again
```

### Configuration Issues

#### Lefthook and pre-commit produce different results

1. Check tool versions match
1. Verify both configurations use same `.pre-commit/` settings
1. Review `AGENTS.md` for sync guidelines

#### Hooks don't run

```bash
# Verify hooks are installed
ls -la .git/hooks/

# Reinstall if missing
lefthook install
pre-commit install
```

### ty-Specific Issues

#### ty fails with "unresolved import"

This is expected for test files or missing dependencies. Options:

1. Ignore (ty is experimental)
1. Add dependency
1. Disable ty temporarily: `LEFTHOOK_EXCLUDE=ty git commit`

#### ty too strict/lenient

ty has limited configuration options. Switch to pyright/mypy for more control.

## Getting Help

- **Documentation**: See [README.md](README.md)
- **Issues**: [GitHub Issues](https://github.com/yourusername/sensible-pre-commit-hooks/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/sensible-pre-commit-hooks/discussions)
- **Lefthook Docs**: <https://lefthook.dev>
- **Pre-commit Docs**: <https://pre-commit.com>
- **ty Docs**: <https://docs.astral.sh/ty>

## Team Communication Template

Use this template to announce the migration to your team:

```markdown
Hi team,

We're migrating to a hybrid Git hooks approach for faster local development:

**What's changing:**
- Local commits: Now using lefthook (5-10x faster, <1s commits)
- CI validation: Still using pre-commit (no change)

**Action required:**
1. Install lefthook: `brew install lefthook` (or `npm install -g lefthook`)
2. Install tools: `uv tool install pycln isort ruff pyright yamlfix sqlfluff`
3. Run: `./install.sh` in the repository
4. Test: `lefthook run pre-commit --all-files`

**Benefits:**
- Much faster local commits (<1s vs 5-10s)
- Same validation in CI (no surprises)
- Better developer experience

**Documentation:**
- Migration guide: MIGRATION.md
- README: README.md
- Questions: #eng-tooling channel

Thanks!
```

## Command Equivalency Reference

| Task | Pre-commit | Lefthook |
|------|-----------|----------|
| **Install hooks** | `pre-commit install` | `lefthook install` |
| **Run on staged files** | `git commit` | `git commit` |
| **Run on all files** | `pre-commit run --all-files` | `lefthook run pre-commit --all-files` |
| **Skip all hooks** | `SKIP=all git commit` | `LEFTHOOK=0 git commit` |
| **Skip specific hook** | `SKIP=ruff-check git commit` | `LEFTHOOK_EXCLUDE=ruff-check git commit` |
| **Update hooks** | `pre-commit autoupdate` | Update `lefthook.yml` manually |
| **Clear cache** | `pre-commit clean` | `lefthook uninstall && lefthook install` |
| **Validate config** | `pre-commit validate-config` | `lefthook dump` |

## Testing Strategy

### Test Matrix

| Test | Pre-commit | Lefthook | Expected Result |
|------|-----------|----------|----------------|
| **Python formatting** | ✓ | ✓ | Identical output |
| **Python linting** | ✓ | ✓ | Same issues found |
| **Type checking** | ✓ | ✓ | Same type errors |
| **Rust formatting** | ✓ | ✓ | Identical output |
| **Java formatting** | ✓ | ✓ | Identical output |
| **Markdown linting** | ✓ | ✓ | Same issues found |

### Automated Testing

Run both test suites:

```bash
# Pre-commit test
python test/test_precommit.py --verbose

# Lefthook test
python test/test_lefthook.py --verbose

# Compare outputs
# Both should produce similar results
```

### Manual Testing Checklist

- [ ] Install lefthook and pre-commit
- [ ] Install all required tools
- [ ] Run `lefthook run pre-commit --all-files`
- [ ] Run `pre-commit run --all-files`
- [ ] Compare results (should be similar)
- [ ] Test individual hooks: `lefthook run pre-commit --commands pycln,isort,ruff-format`
- [ ] Test skipping hooks: `LEFTHOOK_EXCLUDE=ruff-check git commit`
- [ ] Test CI pipeline with pre-commit
- [ ] Verify both configurations use same tool settings

## Recommendations for Special Setup

### Java Tools (PMD, Checkstyle)

**Docker Required**:

- PMD runs in Docker for isolation
- Ensure Docker is running: `docker ps`
- First run downloads Docker image (slow), subsequent runs are cached

**Configuration**:

- PMD: `.pre-commit/java/pmd-ruleset.xml`
- Checkstyle: `.pre-commit/java/google_checks.xml`

### Rust Clippy

**Installation**:

```bash
rustup component add clippy
```

**Configuration**:

Clippy settings are in your project's `Cargo.toml`:

```toml
[lints.clippy]
all = "deny"
pedantic = "warn"
```

### Python ty (Experimental)

**Status**: Early preview (v0.0.8)

**Recommendation**: Keep disabled until stable release

**If Enabling**:

- Install: `uv tool install ty`
- Expect false positives
- Use alongside pyright for comparison
- Disable if causing issues: Comment out in both configs

### SQL sqlfluff

**Dialect**: Configured for Postgres

**Change Dialect**:

Edit `.pre-commit/sql/sqlfluff.cfg`:

```ini
[sqlfluff]
dialect = mysql  # Change to your dialect
```

## Performance Expectations

### Commit Times

| Configuration | Empty Commit | With Changes | All Files |
|--------------|-------------|-------------|----------|
| **Lefthook** | <0.5s | <1s | 10-30s |
| **Pre-commit** | 2-3s | 5-10s | 60-120s |
| **Speedup** | 4-6x | 5-10x | 2-4x |

### CI Pipeline Times

| Step | Time |
|------|------|
| **Checkout** | 5-10s |
| **Setup Python** | 10-20s |
| **Install pre-commit** | 5-10s |
| **Run hooks (first time)** | 120-180s |
| **Run hooks (cached)** | 30-60s |
| **Total (first run)** | 140-220s |
| **Total (cached)** | 50-100s |

### Optimization Tips

1. **Local**: Use lefthook (parallel execution)
1. **CI**: Use pre-commit (reproducible environments)
1. **Cache**: Both tools cache environments/tools
1. **Selective**: Use `LEFTHOOK_EXCLUDE` to skip slow hooks locally
1. **Docker**: Ensure Docker Desktop is running for Java hooks

## Next Steps

After completing migration:

1. **Team Onboarding**
   - Share this migration guide
   - Schedule Q&A session
   - Update team documentation

1. **Monitor**
   - Track commit times
   - Collect developer feedback
   - Monitor CI pipeline performance

1. **Optimize**
   - Disable unused hooks
   - Adjust hook configuration based on usage
   - Update tool versions regularly

1. **Iterate**
   - Review hook effectiveness monthly
   - Add new hooks as needed
   - Keep configurations in sync

1. **Future**
   - Watch ty development (wait for v1.0.0)
   - Consider other Astral tools (biome, etc.)
   - Stay updated with pre-commit ecosystem

---

**Need Help?** See [README.md](README.md) or open an issue.

**Version**: 2.0.0 | **Last Updated**: 2025-01-02
