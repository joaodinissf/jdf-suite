# Tab Organizer Test Suite

## Overview

- **Unit Tests**: 1052 tests across 21 Vitest files (mocked Chrome APIs)
- **E2E Tests**: 135 tests across 20 Playwright spec files (real Chromium browser)
- **Total**: 1187 tests

## Unit Tests (Vitest)

`tests/setup.js` mocks the Chrome APIs, loads the worker and the pages' scripts, and exposes their functions. Its `dispatch(message, sender)` sends a message through the worker's real `chrome.runtime.onMessage` listener and resolves with the reply; `tests/senders.js` holds the sender Chrome gives each caller (the popup, the popup open in a tab, the nap room, Settings, the split dialog, the organize page, the link clumper's content script, and the worker as a page sees it).

| Suite | Tests | Coverage |
|---|---|---|
| routing.test.js | 132 | Every worker action routed from its real caller; the table checked against the dispatcher's if/else chain and each page's scripts; which tabs each Deduplicate closes |
| background.test.js | 53 | Worker logic: sort (Groups mode's exact moves), dedupe (a loading tab by its pendingUrl), merge into the active tab's window, split domains, results |
| snooze.test.js | 96 | Snoozing and waking: records, custom times, window groups, alarms, failed reads, a wake cut short and done again by a new worker, the window a wake opens in; clicking a wake notification focuses its window and tab, and any other notification is only cleared |
| snooze-ui.test.js | 45 | Snooze controls in the popup and the nap room, including the waking state and failed reads; keyboard focus after Wake, Discard, Undo and a re-render (popup and nap room), Undo with no time limit, the picker's focus and inert header |
| nap-room.test.js | 27 | The nap room page: overdue tabs counted and dated, group rows, Wake now's name, the main landmark |
| popup.test.js | 74 | Popup UI and message passing |
| popup-feedback.test.js | 24 | Popup result and error messages; a running action's button is `aria-busy`; keyboard focus scrolls clear of a toast |
| keyboard.test.js | 29 | Popup hotkeys, including K for Open links as tabs and I for Settings |
| split-view.test.js | 46 | Split view compact, expand and repair; sort order (a loading tab by its pendingUrl) |
| confirmation-dialog.test.js | 28 | Split domains dialog |
| content-clumper.test.js | 58 | The link clumper (Open links as tabs): only trusted events, the confirm and the 25 cap, letting go on blur and hidden tabs, Cmd+Z, an orphaned copy after an update; the worker's top-frame, http(s) and 25-link checks |
| open-links.test.js | 37 | Open links as tabs: the shipped manifest (activeTab and scripting, no content script, no site access, no `windows`, the open-links command and its ChromeOS key); the shortcut starts it in its own tab, and on a page Chrome won't script (each of Chrome's refusals) or a PDF the toolbar badge gives the reason, then clears, each tab on its own timer; starting it twice shows the hint again and loads one copy; the popup's footer action (K) sends its tab and closes, is `aria-disabled` with the reason over restricted pages, and shows the bound shortcuts; the page hint (shadow root, polite status, no clicks or focus, the configured key, 3 s, Escape, no motion under reduced motion) |
| options.test.js | 35 | Settings page: the key and modifier; Open links as tabs comes last, has no on/off setting, and its help line names the bound shortcut and the key |
| options-ai.test.js | 30 | Settings: the AI section; the model catalog loads only with a key on file or once the list is used (the recommended models show until then); the "Don't use providers that train on my prompts" checkbox; Enter in the model picker saves; while the key is checked, Save keeps focus and says so; errors describe their fields |
| ai-config.test.js | 46 | Key checks, key form and model picker shared by Settings and the organize page; a key check that never answers gives up after 15 s; a confirmed unlisted default is kept |
| ai-models.test.js | 49 | Key expiry, model catalog helpers (a catalog cut off by the timeout reads as no answer), JSON schema |
| ai-service.test.js | 41 | Key encoding and expiry, query stripping (`data:` keeps its type, `blob:` its origin, `file:` its file name), the prompt (titles capped at 200, addresses at 300, a `data:`, `blob:` or `file:` tab's title sent as its cleaned address), reading the model's answer (null answers and groups) |
| openrouter-requests.test.js | 48 | What is asked of OpenRouter, model by model (the output cap as `max_tokens` or `max_completion_tokens`, and its size, and `data_collection: deny` unless Settings turned it off), and its refusals (one for the data policy names the setting and the account's OpenRouter privacy settings); a key save keeps a confirmed unlisted default |
| ai-runtime.test.js | 34 | The OpenRouter client: error statuses (mid-stream ones keep their kind), streaming and its edge cases, the idle timer (keep-alives count), JSON fallback |
| ai-handlers.test.js | 44 | Worker AI handlers: runs, Apply, window scoping, pinned tabs; a content script's port is closed |
| ai-proposal.test.js | 76 | The organize page; the line under Organize saying what it sends; tab icons from Chrome's favicon cache |

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
| remove-duplicates-window.spec.js | 9 | Dedup within window (same/cross-group, pinned, both modes) |
| remove-duplicates-all-windows.spec.js | 4 | Dedup each window independently |
| remove-duplicates-globally.spec.js | 7 | Cross-window dedup (group-aware; a window left empty closes) |
| move-all-to-single-window.spec.js | 7 | Consolidate tabs (pinned immunity, group recreation; Flat leaves no groups and sorts) |
| copy-all-tabs.spec.js | 8 | Clipboard copy, window vs all-windows scope; Flat has no blank lines |
| flatten-window.spec.js | 3 | Ungrouping, pinned immunity |
| split-view-compact.spec.js | 2 | Compact then Expand (skips below Chrome 155) |
| split-view-repair.spec.js | 5 | Splits survive sort, merge and extract (skips below Chrome 155) |
| popup-ui.spec.js | 9 | Mode switching, preference persistence, button visibility, no text below the compact 10.5px step but the key badges |
| keyboard.spec.js | 4 | Popup hotkeys |
| open-links.spec.js | 7 | On the shipped manifest, started through Huddle's toolbar button (DevTools `Extensions.triggerAction`, with `--enable-unsafe-extension-debugging`): nothing opens until it is started; the hint; a real drag opens 5 at once, and over 25 links asks (answered through `page.on('dialog')`) and opens the first 25; starting again only shows the hint; a reload ends it; a page's own events open nothing; `chrome://` is refused; no site access and no `windows` permission |
| confirmation-dialog.spec.js | 5 | Window count display, confirm/cancel flow |
| snooze.spec.js | 13 | Snooze and wake; the Group button follows the active tab |
| ai-flow.spec.js | 22 | Organize with AI against a fake OpenRouter (the line under Organize, `data_collection: deny` sent); Settings with no key contacts OpenRouter only once the model list is used; two-window cases for what is sent and what Apply moves; a tab pinned before Apply stays pinned; Escape and Cmd/Ctrl+Enter in the proposal's fields |
| trust-boundary.spec.js | 2 | The content script in a page where Open links as tabs was started: no `storage.local` (the key), `storage.sync` still read, only `clumpOpenUrls` accepted, no organize port |
| settings.spec.js | 1 | At 320 px the delete question keeps Delete and Keep side by side |

```bash
pnpm test:e2e            # Run E2E tests (requires Chromium)
```

### E2E Infrastructure

- **Fixture** (`e2e/fixtures/extension.js`): Launches Chromium with extension loaded via `--load-extension`
- **Helpers**: Tab/window management, popup interaction, polling assertions
- **Constants**: IANA-reserved domains (example.com/org/net) to avoid URL redirects
- **Open links as tabs** needs a real user gesture for `activeTab`. `e2e/helpers/open-links.js` makes one with the DevTools protocol: `Extensions.triggerAction` clicks Huddle's toolbar button over a tab (Chrome started with `--enable-unsafe-extension-debugging`), and the worker's `armClumper` then starts it there, as the shortcut and the popup do. So these specs run on the shipped manifest, with no test build. The shortcut itself and the popup opened over a web page can't be pressed from Playwright; the unit tests cover their wiring

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
