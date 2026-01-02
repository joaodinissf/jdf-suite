# Integration Guide: Add Sensible Hooks to Your Project

This guide explains how to integrate these Git hooks into your existing project.

## Quick Start (5 Minutes)

```bash
# 1. Copy hook configurations to your project
cd /path/to/your/project

# For lefthook (recommended for local development)
curl -O https://raw.githubusercontent.com/joaodinissf/Sensible-Pre-Commit-Hooks/v2.0.0/lefthook.yml

# For pre-commit (recommended for CI/CD)
curl -O https://raw.githubusercontent.com/joaodinissf/Sensible-Pre-Commit-Hooks/v2.0.0/.pre-commit-config.yaml

# 2. Copy shared configurations
mkdir -p .pre-commit
curl -L https://github.com/joaodinissf/Sensible-Pre-Commit-Hooks/archive/v2.0.0.tar.gz | \
  tar xz --strip-components=1 "*/\.pre-commit"

# 3. Install hooks
lefthook install  # If using lefthook
pre-commit install  # If using pre-commit

# 4. Test
lefthook run pre-commit --all-files  # Or: pre-commit run --all-files
```

Done! Your project now has comprehensive Git hooks.

---

## Detailed Integration Steps

### Step 1: Choose Your Hook Manager

**Option A: Lefthook (Fast Local Development)**
- ⚡ 5-10x faster than pre-commit
- ✅ Best for local development
- ⚠️ Requires manual tool installation

**Option B: Pre-commit (Standardized CI/CD)**
- 🏭 Auto-manages tool environments
- ✅ Best for CI/CD pipelines
- ⚠️ Slower locally (5-10s vs <1s)

**Option C: Both (Recommended)**
- 🎯 Lefthook for local speed
- 🎯 Pre-commit for CI reliability
- ✅ Best of both worlds

### Step 2: Copy Configuration Files

#### Method 1: Direct Copy (Recommended)

```bash
cd /path/to/your/project

# Copy lefthook config
curl -O https://raw.githubusercontent.com/joaodinissf/Sensible-Pre-Commit-Hooks/v2.0.0/lefthook.yml

# Copy pre-commit config
curl -O https://raw.githubusercontent.com/joaodinissf/Sensible-Pre-Commit-Hooks/v2.0.0/.pre-commit-config.yaml

# Copy shared configs
mkdir -p .pre-commit
cd .pre-commit
for dir in python rust java markdown yaml toml sql; do
  mkdir -p $dir
  curl -O "https://raw.githubusercontent.com/joaodinissf/Sensible-Pre-Commit-Hooks/v2.0.0/.pre-commit/$dir/*"
done
```

#### Method 2: Git Submodule (Advanced)

```bash
cd /path/to/your/project

# Add as submodule
git submodule add https://github.com/joaodinissf/Sensible-Pre-Commit-Hooks.git .git-hooks

# Symlink configs
ln -s .git-hooks/lefthook.yml lefthook.yml
ln -s .git-hooks/.pre-commit-config.yaml .pre-commit-config.yaml
ln -s .git-hooks/.pre-commit .pre-commit

# Update submodule
git submodule update --init --recursive
```

#### Method 3: Reference in Pre-commit (Simplest for Pre-commit Only)

Create `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/joaodinissf/Sensible-Pre-Commit-Hooks
    rev: v2.0.0
    hooks:
      - id: pycln
      - id: isort
      - id: ruff-format
      - id: ruff-check
      - id: pyright
      # ... add all hooks you need
```

### Step 3: Install Required Tools

See [UPDATE.md](UPDATE.md#tool-installation-quick-reference) for full installation instructions.

**Quick installation for common setups:**

```bash
# Python tools (if you have Python files)
uv tool install pycln isort ruff pyright yamlfix sqlfluff

# JavaScript tools (if you have JS/TS files)
npm install -g prettier markdownlint-cli lefthook

# Rust tools (if you have Rust files)
rustup component add rustfmt clippy
cargo install taplo-cli

# Shell tools
brew install shfmt  # macOS
```

### Step 4: Install Git Hooks

```bash
# Lefthook
lefthook install

# Pre-commit
pre-commit install

# Both (recommended)
lefthook install && pre-commit install
```

### Step 5: Test the Integration

```bash
# Test lefthook
lefthook run pre-commit --all-files

# Test pre-commit
pre-commit run --all-files

# Both should show similar results (formatting fixes, linting issues, etc.)
```

---

## Language-Specific Integration

### Python Projects

**Minimum required tools:**
```bash
uv tool install pycln isort ruff pyright
```

**Hooks enabled:**
- pycln (remove unused imports)
- isort (sort imports)
- ruff-format (format code)
- ruff-check (lint code)
- pyright (type check)
- ty (experimental fast type checker)

**Configuration files used:**
- `.pre-commit/python/` (no additional config needed - uses pyproject.toml)

### JavaScript/TypeScript Projects

**Minimum required tools:**
```bash
npm install -g prettier
```

**Hooks enabled:**
- prettier (format JS/TS/JSON/CSS/HTML)

**Configuration files used:**
- `.pre-commit/javascript/` (optional prettier config)

### Rust Projects

**Minimum required tools:**
```bash
rustup component add rustfmt clippy
```

**Hooks enabled:**
- rustfmt (format Rust code)
- clippy (lint Rust code)

**Configuration files used:**
- `.pre-commit/rust/` (optional rustfmt.toml)

### Java Projects

**Minimum required tools:**
```bash
# google-java-format, PMD, Checkstyle
# These are auto-managed or use Docker
```

**Hooks enabled:**
- google-java-format (format Java code)
- PMD (Java linter)
- CPD (copy-paste detector)
- Checkstyle (style checker)

**Configuration files used:**
- `.pre-commit/java/google_checks.xml`
- `.pre-commit/java/pmd-ruleset.xml`

### Markdown Projects

**Minimum required tools:**
```bash
npm install -g markdownlint-cli
```

**Hooks enabled:**
- markdownlint (lint and fix Markdown)

**Configuration files used:**
- `.pre-commit/markdown/markdownlint.json`

### YAML Projects

**Minimum required tools:**
```bash
uv tool install yamlfix
```

**Hooks enabled:**
- yamlfix (format YAML files)

**Configuration files used:**
- `.pre-commit/yaml/yamlfix.toml`

### TOML Projects

**Minimum required tools:**
```bash
cargo install taplo-cli
```

**Hooks enabled:**
- taplo-format (format TOML)
- taplo-lint (lint TOML)

**Configuration files used:**
- `.pre-commit/toml/taplo.toml`

### SQL Projects

**Minimum required tools:**
```bash
uv tool install sqlfluff
```

**Hooks enabled:**
- sqlfluff-fix (format SQL)
- sqlfluff-lint (lint SQL)

**Configuration files used:**
- `.pre-commit/sql/.sqlfluff`

### Shell Scripts

**Minimum required tools:**
```bash
brew install shfmt  # macOS
sudo apt-get install shfmt  # Ubuntu
```

**Hooks enabled:**
- shfmt (format shell scripts)

---

## Customization

### Enable Only Specific Hooks

**Lefthook**: Comment out unwanted hooks in `lefthook.yml`:

```yaml
# - name: ty
#   run: ty check {staged_files}
#   glob: '*.py'
```

**Pre-commit**: Remove unwanted hooks from `.pre-commit-config.yaml`:

```yaml
# - repo: https://github.com/RobertCraigie/pyright-python
#   rev: v1.1.407
#   hooks:
#   - id: pyright
```

### Adjust Hook Settings

Edit configuration files in `.pre-commit/`:

```bash
# Python tool settings
.pre-commit/python/

# Rust settings
.pre-commit/rust/rustfmt.toml

# Java settings
.pre-commit/java/google_checks.xml
.pre-commit/java/pmd-ruleset.xml

# Markdown settings
.pre-commit/markdown/markdownlint.json

# YAML settings
.pre-commit/yaml/yamlfix.toml

# TOML settings
.pre-commit/toml/taplo.toml

# SQL settings
.pre-commit/sql/.sqlfluff
```

### Skip Hooks Temporarily

```bash
# Skip all hooks (not recommended)
LEFTHOOK=0 git commit
SKIP=all git commit

# Skip specific hooks
LEFTHOOK_EXCLUDE=pyright,ty git commit
SKIP=pyright,ty git commit
```

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/hooks.yml`:

```yaml
name: Git Hooks
on: [push, pull_request]

jobs:
  pre-commit:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v5
    - uses: actions/setup-python@v6
    - uses: pre-commit/action@v4.0.0
```

### GitLab CI

Add to `.gitlab-ci.yml`:

```yaml
pre-commit:
  image: python:3.12
  script:
    - pip install pre-commit
    - pre-commit run --all-files
```

### Jenkins

```groovy
stage('Git Hooks') {
  steps {
    sh 'pip install pre-commit'
    sh 'pre-commit run --all-files'
  }
}
```

---

## Monorepo Integration

For monorepos with multiple languages:

1. **Copy configs to monorepo root**
2. **Adjust file paths** in lefthook.yml if needed
3. **Enable only relevant hooks** for your languages
4. **Configure `exclude` patterns** to skip specific directories:

```yaml
# lefthook.yml
pre-commit:
  exclude: 'vendor/|node_modules/|\.git/'
```

```yaml
# .pre-commit-config.yaml
exclude: '^(vendor/|node_modules/|\.git/)'
```

---

## Troubleshooting Integration

### Hooks Don't Run

**Check installation:**
```bash
ls -la .git/hooks/
# Should see pre-commit symlink/script
```

**Reinstall:**
```bash
lefthook install
pre-commit install
```

### Tools Not Found

**Check PATH:**
```bash
which pycln isort ruff pyright prettier
```

**Install missing tools:**
See [UPDATE.md](UPDATE.md#tool-installation-quick-reference)

### Hooks Too Slow

**Use lefthook locally:**
- Pre-commit creates isolated environments (slow)
- Lefthook runs direct commands (fast)

**Disable slow hooks locally:**
Comment out Java tools (PMD, Checkstyle) in lefthook.yml

### Conflicts with Existing Hooks

**Backup existing hooks:**
```bash
mv .git/hooks .git/hooks.backup
```

**Merge configurations:**
Add your custom hooks to lefthook.yml or .pre-commit-config.yaml

---

## Migration from Other Hook Managers

### From Husky

1. Remove husky: `npm uninstall husky`
2. Delete `.husky/` directory
3. Follow integration steps above
4. Map husky hooks to lefthook/pre-commit equivalents

### From lint-staged

1. Remove lint-staged: `npm uninstall lint-staged`
2. Remove `lint-staged` from package.json
3. Follow integration steps above
4. Hooks already run on staged files

### From Custom Git Hooks

1. Backup existing hooks: `cp -r .git/hooks .git/hooks.backup`
2. Follow integration steps above
3. Add custom hooks to lefthook.yml:

```yaml
pre-commit:
  commands:
    custom-hook:
      run: .git/hooks.backup/custom-script.sh
```

---

## Best Practices

### Team Onboarding

1. **Document in README:**
   ```markdown
   ## Development Setup

   Install Git hooks:
   ```bash
   ./install.sh  # Or: lefthook install
   ```

2. **Add to onboarding checklist:**
   - [ ] Install lefthook: `brew install lefthook`
   - [ ] Install tools: `uv tool install pycln isort ruff pyright`
   - [ ] Install hooks: `lefthook install`
   - [ ] Test: `lefthook run pre-commit --all-files`

3. **Provide support channels:**
   - Link to this guide
   - Slack channel for questions
   - Regular Q&A sessions

### Gradual Rollout

1. **Phase 1: Warning mode** (optional pre-commit flag)
2. **Phase 2: Formatting only** (disable linters initially)
3. **Phase 3: All hooks enabled**
4. **Phase 4: Fail CI on violations**

### Maintenance

1. **Update hooks monthly:** `pre-commit autoupdate`
2. **Update tools:** See [UPDATE.md](UPDATE.md)
3. **Monitor hook performance:** Track commit times
4. **Gather team feedback:** Regular surveys

---

## Getting Help

- **Documentation:** [README.md](README.md)
- **Migration:** [MIGRATION.md](MIGRATION.md)
- **Updates:** [UPDATE.md](UPDATE.md)
- **Issues:** [GitHub Issues](https://github.com/joaodinissf/Sensible-Pre-Commit-Hooks/issues)

---

**Version**: 2.0.0 | **Last Updated**: 2025-01-02
