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
- **Copy this window / Copy all windows**: Copy tab URLs to the clipboard (current window only, or every window), paragraph-separated by tab group when Groups mode is on
- **Organize with AI** (OpenRouter): the popup's Organize with AI opens the organize page, which proposes groups you can edit before applying them. When the chosen model supports structured outputs, Huddle requests a strict JSON schema; otherwise it uses JSON object mode. Responses are always reconciled so no input tab is dropped.
  - **Model for this run**: the organize page names the model at the top. Change it (recommended + full OpenRouter list, filterable, or a custom model id) and press Run again to re-run in the same tab; the choice applies to that run only, and **Make default** saves it as the default.
  - **No key yet, an expired one, or one OpenRouter rejects**: the organize page asks for the key inline (checked with OpenRouter before it is saved) and starts the run once it is saved. An expired key is deleted from the browser, not just hidden.
  - **Errors say what to do**: a model or provider refusal offers Change model, a key problem the key form, Groups mode with nothing ungrouped offers Flat, and a stuck request can be stopped (Esc). A run always ends in a proposal, an error or "This run has ended", never a spinner that never stops. Cmd/Ctrl+Enter runs or applies.
  - **After switching branches** in a clone, reload Huddle at `chrome://extensions`: Chrome keeps running the old background worker until then. The organize page notices and offers **Reload Huddle**.
  - **Settings → Organize with AI**: the key's status, replacing or deleting the key, when it expires, and the default model.

### Duplicate Management
- **Remove Duplicates (Window)**: Remove duplicates within current window
- **Remove Duplicates (All Windows Per Window)**: Remove duplicates within each window separately
- **Remove Duplicates (Globally)**: Remove duplicates across all windows (with Huddle allowed in Incognito, regular and incognito windows are deduplicated separately: a page open in both keeps both)

### Split View
- **Compact** (Chrome 155+): pairs neighbouring tabs in the current window into Split Views — (1,2), (3,4), … — without moving any tab. Chrome only splits two adjacent tabs with the same pinned state and tab group, so pairing restarts at every pinned or group boundary and at every tab already in a split; an odd tab left at the end of a run stays as it is.
- **Expand** (Chrome 155+): separates every Split View in the current window, including ones you made yourself.
- Compact and Expand appear only where Chrome can create Split Views (`chrome.tabs.createSplit` / `unsplit`); elsewhere the popup is unchanged.
- Sorting keeps a Split View pair together, positioned by its left tab; deduplication keeps the Split View copy of a duplicated URL rather than closing a page that is on screen — a page split with itself is still deduplicated. Chrome dissolves a split whenever one of its tabs is moved, so on Chrome 155+ Huddle records the pairs before sorting, deduplicating, organizing with AI, extracting, splitting domains or merging windows, and splits them again afterwards. A pair is restored only when both tabs are still open, adjacent, and share window, pinned state and group; Huddle never moves tabs to make that possible. On older Chrome, pairs are kept adjacent but not re-split, and on Chrome without Split View, behavior is unchanged.

### Smart Features
- Respects pinned tabs (never moves or removes them)
- Confirmation dialogs for large operations (>5 new windows)
- Preserves tab groups and their properties (title, color)
- Handles special URLs (chrome://, file://, data:, etc.)
- Adaptive UI hides multi-window buttons when only one window exists

### Link Clumping
- Hold the activation key (default: **Z**) and click-drag a rectangle over any set of links
- On release, every selected link opens in a new background tab, adjacent to the current one, in DOM order, with duplicates filtered out
- Up to 10 links open at once; for 11 to 25 the browser asks first, and above 25 it offers the first 25
- Only your own key presses and drags count: a page's scripts can't make it open tabs
- Works on any HTTP/HTTPS page
- Press Escape mid-drag to cancel without opening; switching tabs or windows, or clicking into a frame, also lets go of the key. Cmd+Z doesn't arm it
- After Huddle is updated or reloaded, reload a page that was already open to clump links in it again
- Configure the key, optional modifier (Shift/Ctrl/Alt), or disable the feature via the **Settings** link in the popup — preferences sync across your Chrome signins

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
pnpm test              # Run unit tests (847 tests)
pnpm test:e2e          # Run E2E tests (121 tests, requires Chromium)
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
├── tests/                         # Vitest unit tests (847 tests in 21 files)
│   ├── setup.js                   # Chrome API mock, page scripts loaded, dispatch() to the worker
│   ├── senders.js                 # The sender each caller (popup, pages, content script) arrives with
│   ├── routing.test.js            # Every worker action, routed from its real caller
│   ├── background.test.js         # Background script logic tests
│   ├── popup.test.js              # Popup UI tests
│   ├── snooze.test.js             # Snoozing and waking, through the worker's handlers
│   ├── confirmation-dialog.test.js
│   └── simple.test.js             # Framework verification
├── e2e/                           # Playwright E2E tests (121 tests)
│   ├── playwright.config.js       # Playwright configuration
│   ├── fixtures/extension.js      # Custom fixture loading extension into Chromium
│   ├── helpers/                   # Tab management, popup interaction, assertions
│   └── tests/                     # 18 spec files covering all features
├── docs/                          # Documentation
├── .github/workflows/             # CI/CD (test, e2e, lint, build, release)
├── package.json
└── eslint.config.js
```

## Testing

### Unit Tests (Vitest + jest-chrome shim)
847 tests across 21 files covering core logic with mocked Chrome APIs:
```bash
pnpm test                # Run all unit tests
pnpm run test:coverage   # With coverage report
```

`tests/routing.test.js` sends every action the service worker handles through its real `onMessage` listener, from the page that sends it (with the sender Chrome gives that page), and checks the reply and the Chrome call the handler makes. The dispatcher is an if/else chain on `message.action`, except the popup's logging message, which is keyed on `message.type`; the test reads every branch of that chain from the source, fails on a branch it does not understand, and checks its table against the actions (and the logging message) found there and against what each page's scripts send. So a new worker action needs a row there. The test's `dispatch(message, sender)` (in `tests/setup.js`) resolves with the worker's reply, and fails when an action that replies later does not keep the channel open by returning `true`.

### E2E Tests (Playwright + real Chromium)
121 tests across 18 spec files that load the extension into a real browser:

| Spec File | Tests | Coverage |
|---|---|---|
| sort-current-window | 8 | Pinned tabs, groups, special URLs |
| sort-all-windows | 4 | Multi-window, group preservation |
| extract-domain | 7 | Cross-window extraction, pinned immunity |
| extract-all-domains | 8 | Per-domain windows, confirmation dialog |
| remove-duplicates-window | 9 | Same/cross-group dedup, pinned immunity |
| remove-duplicates-all-windows | 4 | Per-window independent dedup |
| remove-duplicates-globally | 7 | Cross-window dedup |
| move-all-to-single-window | 7 | Consolidation, group recreation |
| copy-all-tabs | 8 | Clipboard copy, window vs all-windows scope, group sections, feedback |
| popup-ui | 8 | Mode switching, button visibility |
| confirmation-dialog | 4 | Confirm/cancel flow |
| flatten-window | 3 | Ungrouping, pinned immunity |
| split-view-compact | 2 | Compact then Expand; pinned/group runs, existing splits, no tab moves (skips below Chrome 155) |
| split-view-repair | 5 | Splits survive sort (both modes), merge and extract; a separated pair is not forced back together (skips below Chrome 155) |
| keyboard | 4 | Popup hotkey dispatch |
| link-clumping | 2 | A page's own events open nothing; a real drag opens 5 at once, and over 25 links asks and opens the first 25 |
| snooze | 13 | Tab/window/group snooze, wake, alarms, edge cases; the Group button follows the active tab |
| ai-flow | 18 | Organize with AI against a fake OpenRouter: runs, Apply, errors; only the organize page's window is sent, and Apply never takes a tab from another window |

```bash
pnpm test:e2e            # Run E2E tests (headless; HEADED=1 to watch)
```

## CI/CD

CI lives at the monorepo root: [`.github/workflows/jdf-tab-huddle-ci.yml`](../../.github/workflows/jdf-tab-huddle-ci.yml) — two jobs on every PR touching this package: lint + Vitest unit tests + manifest validation, and the Playwright E2E suite in headless Chromium.
- **GitHub Release**: pushing a `jdf-tab-huddle-v*` tag runs [`.github/workflows/jdf-tab-huddle-release.yml`](../../.github/workflows/jdf-tab-huddle-release.yml), which tests, packages the extension zip and publishes the Release with this README's Version History entry as its notes.
- **Release (CWS upload)**: deferred until v1.0.0 — tracked in [jdf-suite#7](https://github.com/joaodinissf/jdf-suite/issues/7)

[`docs/CI-CD.md`](docs/CI-CD.md) describes both workflows and the release steps.

## Permissions

- **`tabs`**: Read and manipulate browser tabs
- **`windows`**: Manage browser windows
- **`tabGroups`**: Preserve and manage tab groups
- **`storage`**: Save user preferences (Tab Groups vs Individual mode)

## Browser Compatibility

- **Chrome**: Manifest V3 (Chrome 102+, for `chrome.storage.session`); Split View Compact/Expand need Chrome 155+ and are hidden on older versions
- **Edge**: Chromium-based Edge
- **Firefox**: Not supported (uses Chrome-specific APIs)

## Version History

- **v0.7.0**: **Organize with AI, reworked** — the run belongs to its organize page, which always ends in a proposal, a clear error with a way forward, or Run again. Errors carry OpenRouter's own explanation. A page left over from before an extension update says so and offers Reload Huddle, instead of failing with "message port closed" (the known issue in v0.6.0). **Works with more models** — Huddle no longer sends `temperature`, builds each request from what the model supports, and retries a strict request without strict routing when no provider can take it, so GPT-6 Luna and similar models organize. The recommended models are Claude Haiku 4.5 (default), DeepSeek V4.1 Flash, Gemini 3.1 Flash Lite and GPT-6 Luna; a recommended model OpenRouter no longer lists is hidden, and your default falls back with a note. **Snoozed tabs are never lost** — a wake removes its snooze only once its tabs have reopened; one cut short by a crash, a quit or an update is simply done again, so a few tabs may reopen twice but none is lost. A failed read of the sleeping list no longer erases it, and a corrupt list is moved aside to a backup instead of blocking snoozing. The popup and nap room show read errors with Retry. **Tests:** routing and window guards that fail when the code they check breaks. 817 unit tests, 119 e2e tests.
- **v0.6.0**: **Tab-group identity** — every page (popup, nap room, settings, organize, confirmation) shares one design system: Chrome's tab-group colours as section chips, light and dark following the system, WCAG AA contrast, a new drawn mark, and a popup that fits Chrome's 600 px cap with a modal snooze picker. **AI setup moves out of the popup** — the organize page picks the model for each run (with Make default) and takes a missing or expired key inline; Settings holds the key, its expiry and the default model; the separate setup page is gone. The key is checked with OpenRouter on save, the picker lists only models Huddle can use, and errors carry OpenRouter's own explanation instead of a guessed "invalid key". **Every run ends visibly** — errors reach the organize page with Retry and Settings, a refresh or worker restart shows "This run has ended" instead of hanging, and Apply reports failures. **The popup says what each action did**, including failures, and an action can't run twice from a held key. **Discard with Undo** replaces Cancel on sleeping tabs, whose Wake now keys are the digits 1–9; Wake now, Discard and the nap room report what really happened. **Split Views survive** sort, dedup, AI organize, extract and merge. Huddle opens with ⌥⇧U by default. Link clumping accepts Shift+digit and Option combos. The release workflow publishes a GitHub Release with the zip for each tag. Known issue: on the organize page, Run again and Retry can fail with "message port closed", and "(batch)" models can still appear; a fix is in progress. 612 unit tests, 100 e2e tests.
- **v0.5.0**: **Split View Compact and Expand** — Compact pairs neighbouring tabs in the current window into Split Views without moving any tab, restarting at pinned and group boundaries and skipping tabs already split; Expand separates every Split View in the window. Both use Chrome's Split View write API (`tabs.createSplit` / `tabs.unsplit`, Chrome 155) and appear only where it exists. Hotkeys V and J. 374 unit tests.
- **v0.4.1**: **Leaner popup startup** — the popup reads windows, tabs and groups once, in one parallel batch, instead of five partly chained queries, and refreshes its hotkeys once for the result. Internal cleanups with no behavior change: the copy message action is renamed `copyTabs`, the current window is resolved without a discarded full tab query, and an unused group-map field is removed. Headless e2e suite with a CI job; dependency advisories resolved. 354 unit tests.
- **v0.4.0**: **Split View awareness** — sorting keeps a Split View pair together as one unit, positioned by its left tab; deduplication keeps the Split View copy of a duplicated URL instead of closing a page that is on screen (pinned still beats everything). Preservation is best-effort: Chrome's extension API is read-only for splits, so a dissolved split cannot be recreated. Feature-detected — Chrome versions without Split View behave exactly as before. All other operations deliberately treat split tabs as plain tabs. 349 unit tests.
- **v0.3.0**: **Copy scope** — the single "Copy all tabs" control becomes two explicit actions, Copy this window and Copy all windows, with the tab count and scope reported back ("Copied 12 tabs (this window)"). **AI model picker** — the three hard-coded models are replaced by the live OpenRouter catalog, cached for 24h, with a filterable list, a custom model id field, a Refresh action, and a Current configuration card; the popup shows the active model. Fetch failures degrade to stale cache and then to the curated defaults, always naming the reason. When the catalog reports a model supports structured outputs, organize requests a strict JSON schema, falling back to JSON object mode only when an endpoint refuses the payload — never on auth, credit or rate-limit errors, and never once the response has started streaming. Editing the model no longer restarts the API key's expiry countdown. 332 unit tests.
- **v0.2.2**: **Groups-mode dedup fix** — in Groups mode, deduplication is now per-group: the same URL in two different tab groups is kept (duplicates inside the same group are still removed); Flat mode unchanged. Snooze perf/polish: batched startup reconcile (one storage write for all past-due records), cheaper last-window guard, shared restore-target window for concurrent wakes, per-tab restore-failure logging, single sleeping-list render. Test-suite hardening from the audit: new `ai-setup` coverage, real status-bar/AI-wiring assertions, de-tautologized sort fixtures, honest e2e test names, singular/plural fix in the confirmation dialog.
- **v0.2.1**: Popup layout stability — reordered sections so the variable (conditionally-hidden) ones come last: the "All windows" section (hidden with a single window) and the "Sleeping" list (hidden when empty, and variable in height) now sit at the bottom, so the always-present controls never shift position.
- **v0.2.0**: **Tab snoozing** — snooze a tab, selected tabs, a window, or a tab group until a chosen time (5 presets + custom); tabs auto-reopen in the background with a notification, managed via a Sleeping list and a full-page nap room. **Dark popup redesign** — single action panel with a Groups/Flat toggle (replacing the dual-mode tabs), spelled-out labels, "Flatten" renamed to "Ungroup". **Keyboard-drivable popup** — single-key hotkeys with visible hints on every action, plus a global `Ctrl/⌘+Shift+H` shortcut to open the popup. Major test-coverage expansion (AI-feature unit tests, keyboard/nap-room suites; 259 unit + 85 e2e). Adds `alarms` + `notifications` permissions and a `commands` block.
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
