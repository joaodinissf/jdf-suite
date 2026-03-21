# Tab Organizer Chrome Extension

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
pnpm test              # Run unit tests (58 tests)
pnpm test:e2e          # Run E2E tests (63 tests, requires Chromium)
pnpm run lint          # Run ESLint
pnpm run validate      # Validate manifest.json
pnpm run package       # Create extension zip
```

## Usage

Click the Tab Organizer icon in your Chrome toolbar to open the popup:

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
tab-sorter-extractor/
├── src/                           # Extension source code
│   ├── manifest.json              # Chrome extension manifest (v3)
│   ├── background.js              # Service worker with all action handlers
│   ├── popup.html / popup.js      # Extension popup UI
│   ├── confirmation-dialog.*      # Confirmation dialog for large operations
│   └── icons/                     # Extension icons
├── tests/                         # Jest unit tests (58 tests)
│   ├── setup.js                   # Test setup with jest-chrome mocks
│   ├── background.test.js         # Background script logic tests
│   ├── popup.test.js              # Popup UI tests
│   ├── focused.test.js            # Core functionality tests
│   ├── confirmation-dialog.test.js
│   └── simple.test.js             # Framework verification
├── e2e/                           # Playwright E2E tests (63 tests)
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

### Unit Tests (Jest + jest-chrome)
58 tests across 5 suites covering core logic with mocked Chrome APIs:
```bash
pnpm test                # Run all unit tests
pnpm run test:coverage   # With coverage report
```

### E2E Tests (Playwright + real Chromium)
63 tests across 10 spec files that load the extension into a real browser:

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
| popup-ui | 6 | Mode switching, button visibility |
| confirmation-dialog | 4 | Confirm/cancel flow |

```bash
pnpm test:e2e            # Run E2E tests (headed Chromium)
```

## CI/CD

Automated workflows using GitHub Actions:

- **Test**: Unit tests on push/PR
- **E2E**: Playwright tests with `xvfb-run` on Ubuntu
- **Lint**: ESLint checks
- **Build**: Manifest and structure validation
- **Release**: Automated on git tags (`v*`)

See [`docs/CI-CD.md`](docs/CI-CD.md) for details.

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
