# Split View: Compact and Expand

## Summary

Add two "This window" actions built on Chrome's Split View write API:

- **Compact** pairs neighbouring tabs into Split Views, halving the number of tab-strip entries without moving or closing anything.
- **Expand** separates every Split View in the window.

Both appear only where the browser provides `chrome.tabs.createSplit` and `chrome.tabs.unsplit` (Chrome 155+).

Tracked in [#46](https://github.com/joaodinissf/jdf-suite/issues/46). Re-pairing splits that sort or dedup dissolve is a separate follow-up.

## Motivation

A window with many tabs becomes a strip of unreadable slivers. A Split View shows two pages under one tab-strip entry, so pairing neighbours is a lossless way to compact a window, and Expand undoes it. Until Chrome 155 extensions could only read `splitViewId`, so Huddle could preserve splits but never create them.

Platform references:
- API: `tabs.create({ splitWithTabId })`, `tabs.createSplit(tabIds)`, `tabs.unsplit(splitViewId)`, proposed in [w3c/webextensions#1019](https://github.com/w3c/webextensions/pull/1019).
- Implementation: [Chromium 456257896](https://issues.chromium.org/issues/456257896).
- Announcement: [Chrome for Developers](https://developer.chrome.com/blog/split-view-api-extensions).

## Behavior

### Popup UI

A `grid2` row, `#splitViewRow`, sits under the Sort / Deduplicate / Ungroup row. It is `hidden` in the markup; `updateSplitViewButtons()` reveals it from the popup's browser snapshot when both API methods exist.

| Button ID | Label | Hotkey | Disabled when |
|---|---|---|---|
| `compactWindow` | Compact | V | fewer than two tabs in the window are outside a split |
| `expandWindow` | Expand | J | no tab in the window is in a split |

Both actions are mode-independent: they ignore the Groups/Flat toggle.

### Compact

`planCompactPairs(tabs)` works in tab-strip order and never moves a tab. Chrome only splits two adjacent tabs with matching `pinned`, `groupId` and `windowId`, neither already in a split. So the strip is cut into runs:

- a new run starts at every change of pinned state or group;
- a tab already in a split ends the current run and is left alone;
- within a run, tabs pair as (0,1), (2,3), …, and an odd tab at the end stays unpaired.

`handleCompactWindow` sends one `createSplit` call per pair, in order. A rejected pair, for example a tab closed meanwhile, is counted and the rest continue. The response is `{ success, paired, failed }`.

### Expand

`handleExpandWindow` collects the distinct `splitViewId`s in the current window and calls `unsplit` once per split. That includes splits the user made, not only Huddle's. The response is `{ success, unsplit, failed }`.

### Older browsers

`splitWriteSupported()` checks that both methods exist; there is no version check. Without them the row stays hidden, and a stray `compactWindow` / `expandWindow` message answers `{ success: false, error: 'unsupported' }` without touching tabs.

## Testing

- **Unit** (`tests/split-view.test.js`, `tests/popup.test.js`, `tests/keyboard.test.js`):
  - pairing rules: runs, odd leftovers, pinned and group boundaries, existing splits, index order;
  - per-pair calls and error tolerance;
  - the unsupported path;
  - row visibility and disabled states;
  - V/J hotkeys bound only while the row is visible.
- **E2E** (`e2e/tests/split-view-compact.spec.js`): Compact then Expand on a real window. The spec skips when the browser lacks the API, which includes Playwright's bundled Chromium until it reaches 155. Run it with `PW_EXECUTABLE` pointing at a Chrome for Testing 155+ build.
