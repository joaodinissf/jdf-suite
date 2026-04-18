# Huddle — Chrome Extension

> Part of the [jdf-suite](https://github.com/joaodinissf/jdf-suite) monorepo. Slug: `jdf-tab-huddle`. Display name: **Huddle**.

A powerful Chrome extension for organizing and managing tabs with advanced features including tab groups support, duplicate removal, and domain-based organization.

## Features

### Tab Groups Support
- **Tab Groups Mode**: Preserves Chrome tab groups during operations
- **Individual Mode**: Treats all tabs individually, ignoring groups

### Sorting & Organization
- **Sort All Tabs**: Sort tabs by URL across all windows
- **Sort Current Window**: Sort tabs by URL in the current window only
- **Extract Domain**: Move all tabs from the current domain into a new window
- **Extract All Domains**: Organize all domains into separate windows
- **Move All to Single Window**: Consolidate all tabs into one window
- **Copy All Tabs**: Copy all open tab URLs to clipboard, paragraph-separated by tab group

### Duplicate Management
- **Remove Duplicates (Window)**: Remove duplicates within current window
- **Remove Duplicates (All Windows Per Window)**: Remove duplicates within each window separately
- **Remove Duplicates (Globally)**: Remove duplicates across all windows

### Smart Features
- Respects pinned tabs (never moves or removes them)
- Confirmation dialogs for large operations (>5 new windows)
- Preserves tab groups and their properties (title, color)
- Handles special URLs (chrome://, file://, data:, etc.)
- Adaptive UI hides multi-window buttons when only one window exists

### Link Clumping
- Hold **Z** and click-drag a rectangle over any set of links
- On release, every selected link opens in a new background tab, adjacent to the current one, in DOM order, with duplicates filtered out
- Works on any HTTP/HTTPS page
- Press Escape mid-drag to cancel without opening
- Current defaults (activation key, modifier, enabled state) are hardcoded; a configurable options page lands in a follow-up

## Acknowledgements

The link-clumping feature is inspired by [linkclump](https://github.com/benblack86/linkclump) by Ben Black; reimplemented clean-room from a behavior spec, with no code from the upstream GPL project present in this MIT-licensed repository.

## Installation

### For Users
1. Download the latest release from [Releases](../../releases)
2. Extract the zip file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in the top-right corner)
5. Click "Load unpacked" and select the extracted `src/` folder
6. The extension icon will appear in your Chrome toolbar

### For Developers
```bash
pnpm install           # Install dependencies
pnpm test              # Run unit tests (66 tests)
pnpm test:e2e          # Run E2E tests (68 tests, requires Chromium)
pnpm run lint          # Run ESLint
pnpm run validate      # Validate manifest.json
pnpm run package       # Create extension zip
```

## Usage

Click the Huddle icon in your Chrome toolbar to open the popup:

### Tab Groups Mode (Default)
- Operations preserve existing Chrome tab groups
- Grouped tabs stay together during moves and sorts
- Ideal for maintaining organized workspaces

### Individual Mode
- All tabs treated as individual items
- Ignores group memberships
- Useful for complete reorganization

## Project Structure

```
packages/jdf-tab-huddle/           # Inside the jdf-suite monorepo
├── src/                           # Extension source code
│   ├── manifest.json              # Chrome extension manifest (v3)
│   ├── background.js              # Service worker with all action handlers
│   ├── popup.html / popup.js      # Extension popup UI
│   ├── confirmation-dialog.*      # Confirmation dialog for large operations
│   └── icons/                     # Extension icons
├── tests/                         # Vitest unit tests (66 tests)
│   ├── setup.js                   # Test setup with jest-chrome mocks
│   ├── background.test.js         # Background script logic tests
│   ├── popup.test.js              # Popup UI tests
│   ├── focused.test.js            # Core functionality tests
│   ├── confirmation-dialog.test.js
│   └── simple.test.js             # Framework verification
├── e2e/                           # Playwright E2E tests (68 tests)
│   ├── playwright.config.js       # Playwright configuration
│   ├── fixtures/extension.js      # Custom fixture loading extension into Chromium
│   ├── helpers/                   # Tab management, popup interaction, assertions
│   └── tests/                     # 10 spec files covering all features
├── docs/                          # Documentation
├── .github/workflows/             # CI/CD (test, e2e, lint, build, release)
├── package.json
└── eslint.config.js
```

## Testing

### Unit Tests (Vitest + jest-chrome shim)
66 tests across 5 suites covering core logic with mocked Chrome APIs:
```bash
pnpm test                # Run all unit tests
pnpm run test:coverage   # With coverage report
```

### E2E Tests (Playwright + real Chromium)
68 tests across 11 spec files that load the extension into a real browser:

| Spec File | Tests | Coverage |
|---|---|---|
| sort-current-window | 8 | Pinned tabs, groups, special URLs |
| sort-all-windows | 4 | Multi-window, group preservation |
| extract-domain | 7 | Cross-window extraction, pinned immunity |
| extract-all-domains | 8 | Per-domain windows, confirmation dialog |
| remove-duplicates-window | 9 | Same/cross-group dedup, pinned immunity |
| remove-duplicates-all-windows | 4 | Per-window independent dedup |
| remove-duplicates-globally | 6 | Cross-window dedup |
| move-all-to-single-window | 7 | Consolidation, group recreation |
| copy-all-tabs | 5 | Clipboard copy, group headers, feedback |
| popup-ui | 6 | Mode switching, button visibility |
| confirmation-dialog | 4 | Confirm/cancel flow |

```bash
pnpm test:e2e            # Run E2E tests (headed Chromium)
```

## CI/CD

CI lives at the monorepo root: [`.github/workflows/jdf-tab-huddle-ci.yml`](../../.github/workflows/jdf-tab-huddle-ci.yml) — runs pnpm install + lint + Vitest unit tests + manifest validation on every PR touching this package.

- **Lint + tests on PR**: ✅ wired up in v0.1.0
- **E2E (Playwright)**: deferred — tracked in [jdf-suite#6](https://github.com/joaodinissf/jdf-suite/issues/6)
- **Release (CWS upload)**: deferred until v1.0.0 — tracked in [jdf-suite#7](https://github.com/joaodinissf/jdf-suite/issues/7)
- **Tag pattern for future releases**: `jdf-tab-huddle-v*`

The in-package [`docs/CI-CD.md`](docs/CI-CD.md) describes the pre-migration standalone setup and is stale — treat as historical context only.

## Permissions

- **`tabs`**: Read and manipulate browser tabs
- **`windows`**: Manage browser windows
- **`tabGroups`**: Preserve and manage tab groups
- **`storage`**: Save user preferences (Tab Groups vs Individual mode)

## Browser Compatibility

- **Chrome**: Manifest V3 (Chrome 88+)
- **Edge**: Chromium-based Edge
- **Firefox**: Not supported (uses Chrome-specific APIs)

## Version History

- **v0.1.0**: First release in the jdf-suite monorepo. Renamed to **Huddle** (`jdf-tab-huddle`); version reset from the pre-monorepo v2.x dev stream since nothing had ever shipped publicly. Unit tests migrated Jest → Vitest. CWS publishing deferred to v1.0.0 (see jdf-suite#7).

### Pre-monorepo dev history (unpublished)

- **v2.3.0**: Copy All Tabs feature — copy all open tab URLs to clipboard, paragraph-separated by tab group
- **v2.2.1**: Documentation update, release workflow fix
- **v2.2.0**: Comprehensive E2E test suite with Playwright, sortWindowTabs batch-move improvement
- **v2.1.0**: Popup UI optimization for single window
- **v2.0.0**: Major rewrite with Tab Groups support, dual-mode UI
- **v1.x**: Legacy versions with basic sorting functionality

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Run tests: `pnpm test && pnpm test:e2e`
4. Commit changes: `git commit -am 'Add new feature'`
5. Push to branch: `git push origin feature/new-feature`
6. Open a Pull Request

## License

This project is open-source and available under the MIT License.
