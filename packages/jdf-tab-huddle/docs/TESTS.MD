# Tab Organizer Test Suite

## Overview

- **Unit Tests**: 817 tests across 21 Vitest files (mocked Chrome APIs)
- **E2E Tests**: 119 tests across 17 Playwright spec files (real Chromium browser)
- **Total**: 936 tests

## Unit Tests (Vitest)

`tests/setup.js` mocks the Chrome APIs, loads the worker and the pages' scripts, and exposes their functions. Its `dispatch(message, sender)` sends a message through the worker's real `chrome.runtime.onMessage` listener and resolves with the reply; `tests/senders.js` holds the sender Chrome gives each caller (the popup, the popup open in a tab, the nap room, Settings, the split dialog, the organize page, the link clumper's content script).

| Suite | Tests | Coverage |
|---|---|---|
| routing.test.js | 71 | Every worker action routed from its real caller; the table checked against the dispatcher's if/else chain and each page's scripts |
| background.test.js | 46 | Worker logic: sort, dedupe, split domains, results |
| snooze.test.js | 89 | Snoozing and waking: records, custom times, window groups, alarms, failed reads, a wake cut short and done again by a new worker |
| snooze-ui.test.js | 33 | Snooze controls in the popup and the nap room, including the waking state and failed reads |
| nap-room.test.js | 22 | The nap room page |
| popup.test.js | 73 | Popup UI and message passing |
| popup-feedback.test.js | 23 | Popup result and error messages |
| keyboard.test.js | 28 | Popup hotkeys |
| split-view.test.js | 45 | Split view compact, expand and repair |
| confirmation-dialog.test.js | 15 | Split domains dialog |
| content-clumper.test.js | 40 | Link clumping content script |
| options.test.js | 31 | Settings page |
| options-ai.test.js | 18 | Settings: the AI section |
| ai-config.test.js | 42 | Key checks, key form and model picker shared by Settings and the organize page |
| ai-models.test.js | 48 | Key expiry, model catalog helpers, JSON schema |
| ai-service.test.js | 27 | Key encoding and expiry, query stripping, the prompt |
| openrouter-requests.test.js | 35 | What is asked of OpenRouter, model by model, and its refusals |
| ai-runtime.test.js | 26 | The OpenRouter client: error statuses, streaming, JSON fallback |
| ai-handlers.test.js | 41 | Worker AI handlers: runs, Apply, window scoping |
| ai-proposal.test.js | 58 | The organize page |
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
| remove-duplicates-globally.spec.js | 7 | Cross-window dedup (group-aware, empty window handling) |
| move-all-to-single-window.spec.js | 7 | Consolidate tabs (pinned immunity, group recreation) |
| copy-all-tabs.spec.js | 8 | Clipboard copy, window vs all-windows scope |
| flatten-window.spec.js | 3 | Ungrouping, pinned immunity |
| split-view-compact.spec.js | 2 | Compact then Expand (skips below Chrome 155) |
| split-view-repair.spec.js | 5 | Splits survive sort, merge and extract (skips below Chrome 155) |
| popup-ui.spec.js | 8 | Mode switching, preference persistence, button visibility |
| keyboard.spec.js | 4 | Popup hotkeys |
| confirmation-dialog.spec.js | 4 | Window count display, confirm/cancel flow |
| snooze.spec.js | 13 | Snooze and wake; the Group button follows the active tab |
| ai-flow.spec.js | 18 | Organize with AI against a fake OpenRouter; two-window cases for what is sent and what Apply moves |

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
