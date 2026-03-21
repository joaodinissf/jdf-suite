# CI/CD Setup for Chrome Extension

## 🚀 GitHub Actions Workflows

### 1. Test Workflow (`.github/workflows/test.yml`)
**Triggers:** Push to `main`/`develop` branches, Pull Requests
**Runs on:** Ubuntu Latest with Node.js 18 & 20

**Jobs:**
- **Test**: Runs unit test suite with coverage
- **E2E**: Runs 63 Playwright tests against real Chromium via `xvfb-run`
- **Lint**: Runs ESLint with Chrome extension rules
- **Build**: Validates manifest.json and extension structure

### 2. Release Workflow (`.github/workflows/release.yml`)
**Triggers:** Git tags starting with `v*` (e.g., `v1.2.0`)
**Runs on:** Ubuntu Latest

**Jobs:**
- **Test**: Ensures all tests pass before release
- **Build & Release**: Creates extension package and GitHub release

## 📋 Setup Checklist

### Required Configuration ✅
- [x] GitHub Actions workflows created
- [x] Package.json scripts configured
- [x] Unit test suite ready (58 tests, 100% passing)
- [x] E2E test suite ready (63 Playwright tests, 100% passing)
- [x] Manifest.json validation
- [x] ESLint configured with Chrome extension rules

### Optional Enhancements
- [ ] **TypeScript**: Convert to TypeScript for better type safety
- [ ] **Codecov**: Code coverage reporting (token needed)
- [ ] **Chrome Web Store Publishing**: Automated publishing
- [ ] **Dependabot**: Automated dependency updates

## 🔧 Commands Available

```bash
# Development
pnpm install          # Install dependencies
pnpm test             # Run tests
pnpm run test:watch   # Run tests in watch mode
pnpm run test:coverage # Run tests with coverage
pnpm run validate     # Validate manifest.json
pnpm run package      # Create extension package
pnpm run lint         # Run ESLint
pnpm run lint:fix     # Fix ESLint issues

# CI/CD will run automatically on:
git push origin main  # Triggers test workflow
git tag v1.2.0 && git push origin v1.2.0  # Triggers release workflow
```

## 🎯 Workflow Features

### Test Workflow Features:
- ✅ **Multi-Node Testing**: Tests on Node.js 18 & 20
- ✅ **Unit Testing**: Runs all 58 Jest tests
- ✅ **E2E Testing**: Runs 63 Playwright tests against real Chromium
- ✅ **Coverage Reporting**: Generates coverage reports
- ✅ **Manifest Validation**: Validates Chrome extension manifest
- ✅ **Structure Checking**: Verifies extension file structure
- ✅ **Conditional Scripts**: Only runs linting/typecheck if configured

### Release Workflow Features:
- ✅ **Automated Testing**: Must pass tests before release
- ✅ **Extension Packaging**: Creates zip file for Chrome Web Store
- ✅ **GitHub Releases**: Automatically creates GitHub release
- ✅ **Release Notes**: Generates release notes with installation instructions

## 🔒 Security & Best Practices

### Implemented:
- ✅ **Frozen Lockfile**: Uses `--frozen-lockfile` for reproducible builds
- ✅ **Latest Actions**: Uses latest versions of GitHub Actions
- ✅ **Minimal Permissions**: Only uses necessary permissions
- ✅ **Clean Packaging**: Excludes development files from release

### Recommendations:
- 🔹 **Branch Protection**: Enable branch protection on `main`
- 🔹 **Required Status Checks**: Require CI to pass before merging
- 🔹 **Dependency Updates**: Set up Dependabot for security updates
- 🔹 **Secrets Management**: Use GitHub Secrets for sensitive data

## 📊 Status Badges

Add these to your README.md:

```markdown
[![Tests](https://github.com/yourusername/tab-organizer/workflows/Test%20Chrome%20Extension/badge.svg)](https://github.com/yourusername/tab-organizer/actions)
[![Release](https://github.com/yourusername/tab-organizer/workflows/Release%20Chrome%20Extension/badge.svg)](https://github.com/yourusername/tab-organizer/actions)
```

## 🚀 Creating a Release

1. **Ensure tests pass**: `pnpm test`
2. **Update version**: Update `version` in `manifest.json` and `package.json`
3. **Commit changes**: `git commit -am "Release v1.2.0"`
4. **Create tag**: `git tag v1.2.0`
5. **Push tag**: `git push origin v1.2.0`
6. **GitHub will automatically**: Run tests → Create package → Create release

## 🛠️ Troubleshooting

### Common Issues:
1. **Tests failing in CI**: Check Node.js version compatibility
2. **Missing dependencies**: Ensure pnpm lockfile is committed
3. **Manifest validation**: Run `pnpm run validate` locally first
4. **Release not created**: Ensure tag starts with `v` (e.g., `v1.0.0`)

### Debug Commands:
```bash
# Test locally like CI does
pnpm install --frozen-lockfile
pnpm test
pnpm run validate

# Check workflow status
gh workflow list
gh run list
```