# Tab Organizer Chrome Extension

A powerful Chrome extension for organizing and managing tabs with advanced features including tab groups support, duplicate removal, and domain-based organization.

## ✨ Features

### 🔗 **Tab Groups Support**
- **Tab Groups Mode**: Preserves Chrome tab groups during operations
- **Individual Mode**: Treats all tabs individually, ignoring groups

### 📊 **Sorting & Organization**
- **Sort All Tabs**: Sort tabs by URL across all windows
- **Sort Current Window**: Sort tabs by URL in the current window only
- **Extract Domain**: Move all tabs from the current domain into a new window
- **Extract All Domains**: Organize all domains into separate windows
- **Move All to Single Window**: Consolidate all tabs into one window

### 🧹 **Duplicate Management**
- **Remove Duplicates (Window)**: Remove duplicates within current window
- **Remove Duplicates (All Windows Per Window)**: Remove duplicates within each window separately
- **Remove Duplicates (Globally)**: Remove duplicates across all windows

### 🎯 **Smart Features**
- Respects pinned tabs (never moves or removes them)
- Confirmation dialogs for large operations
- Preserves tab groups and their properties
- Handles special URLs (chrome://, file://, data:, etc.)

## 🚀 Installation

### For Users
1. Clone this repository: `git clone <repository-url>`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the project root folder
5. The extension icon will appear in your Chrome toolbar

### For Developers
```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Validate extension
pnpm run validate

# Create package for Chrome Web Store
pnpm run package
```

## 🎮 Usage

Click the Tab Organizer icon in your Chrome toolbar to open the popup:

### **Tab Groups Mode** (Default)
- Operations preserve existing Chrome tab groups
- Grouped tabs stay together during moves and sorts
- Ideal for maintaining organized workspaces

### **Individual Mode**
- All tabs treated as individual items
- Ignores group memberships
- Useful for complete reorganization

### **Available Operations**
- **Sort**: Alphabetically order tabs by URL
- **Extract Domain**: Move all tabs matching the active tab's domain to a new window
- **Extract All Domains**: Create separate windows for each domain
- **Move All to Single Window**: Consolidate all windows into one
- **Remove Duplicates**: Clean up duplicate tabs with various scopes

## 🔧 Development

### **Prerequisites**
- Node.js 18 or 20
- pnpm package manager

### **Commands**
```bash
# Development
pnpm install              # Install dependencies
pnpm test                 # Run test suite (58 tests)
pnpm run test:watch       # Run tests in watch mode
pnpm run test:coverage    # Run tests with coverage
pnpm run lint             # Run ESLint
pnpm run lint:fix         # Fix ESLint issues
pnpm run validate         # Validate manifest.json
pnpm run package          # Create extension package

# Release
git tag v2.1.0           # Create version tag
git push origin v2.1.0   # Trigger automated release
```

### **Project Structure**
```
tab-organizer/
├── manifest.json          # Extension manifest
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── background.js         # Service worker
├── confirmation-dialog.* # Confirmation dialog components
├── utils/               # Utility modules
│   └── loggingUtils.js  # Centralized logging
├── tests/               # Test suite (58 tests)
├── docs/                # Documentation
└── icons/               # Extension icons
```

## 🧪 Testing

Comprehensive test suite with 100% pass rate:

- **58 total tests** across 5 test suites
- **Unit tests** for core functionality
- **Integration tests** for Chrome API interactions
- **UI tests** for popup behavior
- **Edge case handling** for various URL types

```bash
pnpm test                # Run all tests
pnpm run test:coverage   # With coverage report
```

## 🔄 CI/CD

Automated workflows using GitHub Actions:

- **Test Workflow**: Runs on push/PR with multi-Node testing
- **Release Workflow**: Automated releases on git tags
- **Quality Checks**: ESLint, test coverage, manifest validation

See [`docs/CI-CD.md`](docs/CI-CD.md) for complete setup details.

## 🛡️ Permissions

This extension requires the following permissions:

- **`tabs`**: Read and manipulate browser tabs
- **`windows`**: Manage browser windows
- **`tabGroups`**: Preserve and manage tab groups
- **`storage`**: Save user preferences (Tab Groups vs Individual mode)

## 🎯 Browser Compatibility

- **Chrome**: Manifest V3 (Chrome 88+)
- **Edge**: Chromium-based Edge
- **Firefox**: Not supported (uses Chrome-specific APIs)

## 📝 Version History

- **v2.0.0**: Major rewrite with Tab Groups support, dual-mode UI, comprehensive refactoring
- **v1.x**: Legacy versions with basic sorting functionality

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Run tests: `pnpm test`
4. Commit changes: `git commit -am 'Add new feature'`
5. Push to branch: `git push origin feature/new-feature`
6. Open a Pull Request

## 📄 License

This project is open-source and available under the MIT License.

## 🆘 Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Tests**: All functionality is covered by automated tests
- **Documentation**: See `docs/` folder for detailed information

---

**🎉 Production-ready extension with comprehensive tab management features and excellent code quality!**