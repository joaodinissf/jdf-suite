# Update Guide

This document describes how to keep all dependencies and tools up to date in this repository.

## Overview

This repository has dependencies in multiple places:

1. **Pre-commit hook versions** (`.pre-commit-config.yaml`)
1. **GitHub Actions versions** (`.github/workflows/ci.yml`)
1. **Tool versions installed locally** (for lefthook)

## Pre-commit Hook Versions

### Update Command

```bash
pre-commit autoupdate
```

This updates all hook versions in `.pre-commit-config.yaml` to their latest releases.

### What Gets Updated

- pycln
- isort
- ruff (format and check)
- pyright
- google-java-format
- markdownlint
- yamlfix
- taplo
- sqlfluff
- pre-commit-hooks (trailing whitespace, end-of-file, etc.)

### After Updating

1. Test the updates: `pre-commit run --all-files`
1. Commit the changes: `git commit -am "chore: update pre-commit hook versions"`
1. Push to main

### Frequency

**Recommended**: Monthly or when new tool versions are released

### Automated Updates

Consider setting up Dependabot or Renovate to automatically create PRs for hook updates:

**Dependabot (`.github/dependabot.yml`)**:

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

**Renovate (`.github/renovate.json`)**:

```json
{
  "extends": ["config:base"],
  "pre-commit": {
    "enabled": true
  }
}
```

## GitHub Actions Versions

### Manual Updates

Edit `.github/workflows/ci.yml` and update action versions:

```yaml
- uses: actions/checkout@v5  # Check for v6, v7, etc.
- uses: actions/setup-python@v6  # Check for newer versions
- uses: actions/setup-node@v5
- uses: actions/setup-java@v5
- uses: astral-sh/setup-uv@v6
- uses: actions/upload-artifact@v4
```

### Check for Updates

Visit the GitHub Marketplace for each action:

- [actions/checkout](https://github.com/actions/checkout/releases)
- [actions/setup-python](https://github.com/actions/setup-python/releases)
- [actions/setup-node](https://github.com/actions/setup-node/releases)
- [actions/setup-java](https://github.com/actions/setup-java/releases)
- [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv/releases)
- [actions/upload-artifact](https://github.com/actions/upload-artifact/releases)

### Automated Updates

Dependabot will automatically update GitHub Actions if configured (see above).

## Local Tool Versions (for Lefthook)

### Python Tools

Update all Python tools installed via uv:

```bash
# List installed tools
uv tool list

# Update specific tool
uv tool install --force pycln
uv tool install --force isort
uv tool install --force ruff
uv tool install --force pyright
uv tool install --force ty
uv tool install --force yamlfix
uv tool install --force sqlfluff

# Or update all at once
uv tool install --force pycln isort ruff pyright ty yamlfix sqlfluff
```

### JavaScript Tools

Update npm global packages:

```bash
# Check outdated packages
npm outdated -g

# Update specific tools
npm install -g prettier@latest
npm install -g markdownlint-cli@latest
npm install -g lefthook@latest

# Or update all
npm update -g
```

### Rust Tools

Update Rust toolchain and components:

```bash
# Update rustup itself
rustup self update

# Update Rust toolchain
rustup update

# Reinstall cargo tools to latest
cargo install taplo-cli --force
```

### Shell Tools

Update via package manager:

```bash
# macOS
brew upgrade shfmt

# Ubuntu/Debian
sudo apt-get update && sudo apt-get upgrade shfmt

# Arch Linux
sudo pacman -Syu shfmt
```

## Complete Update Workflow

Run all updates at once:

```bash
#!/bin/bash
# Complete update script

echo "1. Updating pre-commit hooks..."
pre-commit autoupdate

echo "2. Updating Python tools..."
uv tool install --force pycln isort ruff pyright ty yamlfix sqlfluff

echo "3. Updating JavaScript tools..."
npm install -g prettier@latest markdownlint-cli@latest lefthook@latest

echo "4. Updating Rust tools..."
rustup update
cargo install taplo-cli --force

echo "5. Updating shell tools..."
brew upgrade shfmt  # macOS only

echo "6. Testing updates..."
pre-commit run --all-files
lefthook run pre-commit --all-files

echo "7. Commit and push..."
git add .pre-commit-config.yaml
git commit -m "chore: update hook versions"
git push

echo "✅ All updates complete!"
```

Save this as `scripts/update-all.sh` and run monthly.

## Keeping Lefthook and Pre-commit Configs in Sync

After updating tools, ensure both configurations remain synchronized:

### Check Tool Versions

```bash
# Python
pycln --version
isort --version
ruff --version
pyright --version
ty version

# JavaScript
prettier --version
markdownlint --version

# Rust
rustfmt --version
cargo clippy --version
taplo --version

# Shell
shfmt -version
```

### Verify Configs Match

1. **Pre-commit** (`.pre-commit-config.yaml`): Uses specific version tags
1. **Lefthook** (`lefthook.yml`): Uses whatever's installed locally

Both should call the same tools with the same arguments. See `AGENTS.md` for sync guidelines.

## Version Compatibility Matrix

| Tool | Min Version | Tested Version | Notes |
|------|-------------|----------------|-------|
| **Python** | 3.12 | 3.12 | Required in pyproject.toml |
| **Node.js** | 20 | 20 | For prettier, markdownlint |
| **Rust** | 1.75+ | 1.91 | For rustfmt, clippy |
| **Java** | 11+ | 21 | For google-java-format, PMD |
| **lefthook** | 1.10.0+ | 2.0.13 | Jobs/groups feature required |
| **pre-commit** | 3.0.0+ | 4.5.1 | Modern hooks support |
| **pycln** | 2.5.0+ | 2.6.0 | |
| **isort** | 6.0.0+ | 7.0.0 | |
| **ruff** | 0.13.0+ | 0.14.10 | |
| **pyright** | 1.1.400+ | 1.1.407 | |
| **ty** | 0.0.8+ | 0.0.8 | Experimental! |
| **prettier** | 3.0.0+ | 3.7.4 | |
| **markdownlint** | 0.40.0+ | 0.47.0 | |
| **yamlfix** | 1.18.0+ | 1.19.1 | |
| **taplo** | 0.9.0+ | 0.9.3 | |
| **sqlfluff** | 3.4.0+ | 4.0.0a2 | |
| **shfmt** | 3.8.0+ | 3.10.0 | |

## Testing After Updates

### Quick Test

```bash
# Pre-commit
pre-commit run --all-files

# Lefthook
lefthook run pre-commit --all-files
```

### Full Test Suite

```bash
# Pre-commit test
python test/test_precommit.py --verbose

# Lefthook test
python test/test_lefthook.py --verbose
```

### CI Validation

Push to a branch and let CI validate:

```bash
git checkout -b test/update-dependencies
git add .
git commit -m "test: validate dependency updates"
git push -u origin test/update-dependencies
```

## Rollback Procedure

If updates break something:

### Rollback Pre-commit Hooks

```bash
# Revert .pre-commit-config.yaml
git checkout HEAD~1 .pre-commit-config.yaml

# Clear cache and reinstall
pre-commit clean
pre-commit install-hooks
```

### Rollback Local Tools

```bash
# Pin to specific version
uv tool install ruff==0.13.1

# Or reinstall from previous working state
pre-commit run --all-files  # Uses versions from .pre-commit-config.yaml
```

## Troubleshooting

### Pre-commit autoupdate fails

```bash
# Clear cache
pre-commit clean

# Try again
pre-commit autoupdate
```

### Tool version mismatch between lefthook and pre-commit

Check installed version vs config version:

```bash
# Installed
ruff --version

# Config version
grep -A2 "ruff-pre-commit" .pre-commit-config.yaml
```

Update to match:

```bash
uv tool install ruff==0.14.10  # Match pre-commit version
```

### CI fails after updates

1. Check CI logs for specific failure
1. Test locally: `pre-commit run --all-files`
1. If needed, rollback specific tool version
1. Update one tool at a time to isolate issues

## Recommended Update Schedule

| Component | Frequency | Automation |
|-----------|-----------|------------|
| Pre-commit hooks | Monthly | Dependabot/Renovate |
| GitHub Actions | Quarterly | Dependabot |
| Python tools | Monthly | Manual |
| JavaScript tools | Monthly | Manual |
| Rust tools | Quarterly | Manual |
| Shell tools | As needed | Manual |

## Security Updates

For security-critical updates:

1. Update immediately when CVE is announced
1. Test in isolated branch
1. Fast-track through CI
1. Deploy to all projects using this config

Subscribe to security advisories:

- [GitHub Security Advisories](https://github.com/advisories)
- [Ruff Releases](https://github.com/astral-sh/ruff/releases)
- [Pre-commit Releases](https://github.com/pre-commit/pre-commit/releases)

## Questions?

See also:

- [README.md](README.md) - General documentation
- [MIGRATION.md](MIGRATION.md) - Migration guide
- [AGENTS.md](AGENTS.md) - AI assistant guidelines
- [Pre-commit docs](https://pre-commit.com/#updating-hooks-automatically)
- [Lefthook docs](https://lefthook.dev)

---

**Last Updated**: 2025-01-02 | **Version**: 2.0.0
