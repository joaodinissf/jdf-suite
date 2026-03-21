# Tab Organizer Test Suite

## Overview

- **Unit Tests**: 58 tests across 5 Jest suites (mocked Chrome APIs)
- **E2E Tests**: 63 tests across 10 Playwright spec files (real Chromium browser)
- **Total**: 121 tests, 100% passing

## Unit Tests (Jest + jest-chrome)

| Suite | Tests | Coverage |
|---|---|---|
| focused.test.js | 16 | Core extension logic (lexHost, findDuplicateTabs, etc.) |
| popup.test.js | 14 | UI interactions and message passing |
| background.test.js | 16 | Background script business logic |
| simple.test.js | 6 | Framework and Chrome API mock verification |
| confirmation-dialog.test.js | 6 | Dialog behavior and error handling |

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
| remove-duplicates-globally.spec.js | 6 | Cross-window dedup (group-aware, empty window handling) |
| move-all-to-single-window.spec.js | 7 | Consolidate tabs (pinned immunity, group recreation) |
| popup-ui.spec.js | 6 | Mode switching, preference persistence, button visibility |
| confirmation-dialog.spec.js | 4 | Window count display, confirm/cancel flow |

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
