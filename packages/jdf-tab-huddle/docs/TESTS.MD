# Tab Organizer Test Suite

## Overview

- **Unit Tests**: 955 tests across 21 Vitest files (mocked Chrome APIs)
- **E2E Tests**: 128 tests across 19 Playwright spec files (real Chromium browser)
- **Total**: 1083 tests

## Unit Tests (Vitest)

`tests/setup.js` mocks the Chrome APIs, loads the worker and the pages' scripts, and exposes their functions. Its `dispatch(message, sender)` sends a message through the worker's real `chrome.runtime.onMessage` listener and resolves with the reply; `tests/senders.js` holds the sender Chrome gives each caller (the popup, the popup open in a tab, the nap room, Settings, the split dialog, the organize page, the link clumper's content script, and the worker as a page sees it).

| Suite | Tests | Coverage |
|---|---|---|
| routing.test.js | 128 | Every worker action routed from its real caller; the table checked against the dispatcher's if/else chain and each page's scripts; which tabs each Deduplicate closes |
| background.test.js | 50 | Worker logic: sort, dedupe, split domains, results |
| snooze.test.js | 94 | Snoozing and waking: records, custom times, window groups, alarms, failed reads, a wake cut short and done again by a new worker, the window a wake opens in |
| snooze-ui.test.js | 38 | Snooze controls in the popup and the nap room, including the waking state and failed reads; keyboard focus after Wake, Discard and Undo, Undo with no time limit, the picker's focus and inert header |
| nap-room.test.js | 22 | The nap room page |
| popup.test.js | 74 | Popup UI and message passing |
| popup-feedback.test.js | 24 | Popup result and error messages; a running action's button is `aria-busy`; keyboard focus scrolls clear of a toast |
| keyboard.test.js | 29 | Popup hotkeys, including I for Settings in the real popup |
| split-view.test.js | 45 | Split view compact, expand and repair |
| confirmation-dialog.test.js | 28 | Split domains dialog |
| content-clumper.test.js | 60 | Link clumping content script: only trusted events, the confirm and the 25 cap, letting go on blur and hidden tabs, Cmd+Z, an orphaned copy after an update; the worker's top-frame, http(s) and 25-link checks; it runs on http(s) pages only, and an install, update or reload puts it into the http(s) tabs already open |
| options.test.js | 31 | Settings page |
| options-ai.test.js | 18 | Settings: the AI section |
| ai-config.test.js | 43 | Key checks, key form and model picker shared by Settings and the organize page; a confirmed unlisted default is kept |
| ai-models.test.js | 49 | Key expiry, model catalog helpers (a catalog cut off by the timeout reads as no answer), JSON schema |
| ai-service.test.js | 29 | Key encoding and expiry, query stripping, the prompt, reading the model's answer (null answers and groups) |
| openrouter-requests.test.js | 38 | What is asked of OpenRouter, model by model (the output cap as `max_tokens` or `max_completion_tokens`, and its size), and its refusals; a key save keeps a confirmed unlisted default |
| ai-runtime.test.js | 34 | The OpenRouter client: error statuses (mid-stream ones keep their kind), streaming and its edge cases, the idle timer (keep-alives count), JSON fallback |
| ai-handlers.test.js | 44 | Worker AI handlers: runs, Apply, window scoping, pinned tabs; a content script's port is closed |
| ai-proposal.test.js | 71 | The organize page |
| simple.test.js | 6 | Framework and Chrome API mock verification |

```bash
pnpm test                # Run all unit tests
pnpm run test:watch      # Run tests in watch mode
pnpm run test:coverage   # Run tests with coverage report
```

## E2E Tests (Playwright)

Real browser tests that load the extension into Chromium and verify end-to-end behavior.

| Spec File | Tests | Feature |
|---|---|---|
| sort-current-window.spec.js | 8 | Sort within single window (groups, individual, pinned, special URLs) |
| sort-all-windows.spec.js | 4 | Sort across all windows (multi-window, group preservation) |
| extract-domain.spec.js | 7 | Extract single domain to new window (cross-window, pinned immunity) |
| extract-all-domains.spec.js | 8 | One window per domain + misc window (confirmation dialog) |
| remove-duplicates-window.spec.js | 9 | Dedup within window (same/cross-group, pinned, pendingUrl) |
| remove-duplicates-all-windows.spec.js | 4 | Dedup each window independently |
| remove-duplicates-globally.spec.js | 7 | Cross-window dedup (group-aware; a window left empty closes) |
| move-all-to-single-window.spec.js | 7 | Consolidate tabs (pinned immunity, group recreation) |
| copy-all-tabs.spec.js | 8 | Clipboard copy, window vs all-windows scope |
| flatten-window.spec.js | 3 | Ungrouping, pinned immunity |
| split-view-compact.spec.js | 2 | Compact then Expand (skips below Chrome 155) |
| split-view-repair.spec.js | 5 | Splits survive sort, merge and extract (skips below Chrome 155) |
| popup-ui.spec.js | 9 | Mode switching, preference persistence, button visibility, no text below the compact 10.5px step but the key badges |
| keyboard.spec.js | 4 | Popup hotkeys |
| link-clumping.spec.js | 2 | A page's own events open nothing; a real drag opens 5 at once, and over 25 links asks (answered through `page.on('dialog')`) and opens the first 25 |
| confirmation-dialog.spec.js | 5 | Window count display, confirm/cancel flow |
| snooze.spec.js | 13 | Snooze and wake; the Group button follows the active tab |
| ai-flow.spec.js | 21 | Organize with AI against a fake OpenRouter; two-window cases for what is sent and what Apply moves; a tab pinned before Apply stays pinned; Escape and Cmd/Ctrl+Enter in the proposal's fields |
| trust-boundary.spec.js | 2 | The content script in a web page: no `storage.local` (the key), `storage.sync` still read, only `clumpOpenUrls` accepted, no organize port |

```bash
pnpm test:e2e            # Run E2E tests (requires Chromium)
```

### E2E Infrastructure

- **Fixture** (`e2e/fixtures/extension.js`): Launches Chromium with extension loaded via `--load-extension`
- **Helpers**: Tab/window management, popup interaction, polling assertions
- **Constants**: IANA-reserved domains (example.com/org/net) to avoid URL redirects

## CI Integration

- Unit tests run on every push/PR
- E2E tests run on every push/PR via `xvfb-run` on Ubuntu
- Both must pass before release

## Commands

```bash
pnpm test                # Unit tests
pnpm test:e2e            # E2E tests
pnpm run test:coverage   # Unit tests with coverage
pnpm run lint            # ESLint
```
