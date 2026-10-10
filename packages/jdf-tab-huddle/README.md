# Huddle

> Part of the [jdf-suite](https://github.com/joaodinissf/jdf-suite) monorepo. Slug: `jdf-tab-huddle`. Display name: **Huddle**.

**Huddle organizes your browser tabs.** From one popup, opened with **⌥⇧U** (Alt+Shift+U elsewhere) and driven by single-letter keys, it sorts, groups, de-duplicates and gathers the tabs on your real tab strip, across every window. It puts tabs to sleep until you need them, opens a set of links on a page as tabs in one drag, and, if you bring your own OpenRouter key, suggests groups for a messy window. Tab groups, pinned tabs and Split Views are kept as they are, or restored afterwards. There is no account and no Huddle server. Nothing is sent anywhere except what you send to OpenRouter for an AI suggestion; the Open links as tabs key and modifier also sync through your own Chrome sign-in.

## What it does

Everything Huddle does is a part of organizing tabs.

### Sort, group, de-duplicate, extract and merge

Every action works in one of two modes, chosen at the top of the popup:
- **Groups** (the default) keeps your Chrome tab groups: grouped tabs move and sort together, and groups keep their title and colour.
- **Flat** treats every tab on its own and ignores groups, for a complete reorganization.

**This window**
- **Sort**: sort the window's tabs by URL.
- **Deduplicate**: close duplicate tabs in the window. In Groups mode the same page in two different groups is kept; duplicates inside one group are closed.
- **Ungroup**: remove every tab group in the window.
- **Compact** and **Expand** (Chrome 155+): pair neighbouring tabs into Split Views, (1,2), (3,4), …, without moving any tab, and separate them again. Chrome only splits two adjacent tabs with the same pinned state and group, so pairing restarts at every pinned or group boundary and at every tab already in a split; an odd tab left at the end of a run stays as it is. Expand separates every Split View in the window, including ones you made yourself. Both appear only where Chrome can create Split Views.

**Extract & copy**
- **Extract domain**: move every tab of the current tab's domain, from any window, into a new window.
- **Split domains**: move each domain with 2 or more tabs into its own window, and the single-tab domains into one more. Above 5 new windows it asks first, and the dialog stays open to show what the split did or why it couldn't. When there is no dialog, a split that left tabs behind or failed says so in a notification.
- **Copy this window** / **Copy all windows**: copy the tab URLs to the clipboard, with a blank line between tab groups in Groups mode.

**All windows**
- **Sort all windows**: sort the tabs in every window by URL.
- **Merge windows**: move every tab into the current window.
- **Deduplicate per window**: remove duplicates within each window separately.
- **Deduplicate globally**: remove duplicates across every window. With Huddle allowed in Incognito, regular and incognito windows are deduplicated separately: a page open in both keeps both.

**What Huddle never tramples**
- Pinned tabs are never moved or closed.
- Split Views: sorting keeps a pair together, positioned by its left tab, and deduplicating keeps the Split View copy of a duplicated page. Chrome dissolves a split whenever one of its tabs moves, so on Chrome 155+ Huddle records the pairs before sorting, deduplicating, organizing with AI, extracting, splitting domains or merging windows, and splits them again afterwards, when both tabs are still open, adjacent, and share window, pinned state and group. Huddle never moves tabs to make that possible. On older Chrome pairs are kept adjacent but not re-split.
- Special pages (`chrome://`, `file:`, `data:` and others) are handled like any other tab.
- The All windows section hides when only one window is open.

### Snooze tabs for later

- Snooze the active **Tab**, the **Selected** (highlighted) tabs, the whole **Window**, or the active tab's **Group** until later today, tonight, tomorrow, the weekend, next week or a time you pick.
- Sleeping tabs close, and reopen on time in the background, in a regular window, with a notification; clicking it takes you to them. A group wakes as the same group.
- The popup's **Sleeping** list shows what's asleep, with **Wake now** (digits 1–9) and **Discard**, which you can Undo. The **nap room** is the full-page list.
- A wake removes its snooze only once its tabs have reopened, so a wake cut short by a crash, a quit or an update is simply done again: a few tabs may reopen twice, but none is lost.

### Open several links as tabs at once

- **Start it on a page** with **⌥⇧L** (Alt+Shift+L elsewhere, Alt+Shift+K on ChromeOS; rebind at `chrome://extensions/shortcuts`) or the popup's **Open links as tabs** (hotkey **K**), which closes the popup. A hint at the bottom of the page says which key to hold. It stays on in that page until the page reloads or you leave it; starting it again only shows the hint again.
- Then hold the activation key (default: **Z**) and drag a rectangle over any set of links.
- On release, every selected web (http or https) link opens in a new background tab next to the current one, in page order, with duplicates left out.
- Up to 10 links open at once; for 11 to 25 the browser asks first, and above 25 it offers the first 25.
- Only your own key presses and drags count: a page's scripts can't make it open tabs.
- Huddle has no access to any website until you start it on one, and then only to that tab (Chrome's `activeTab`). On a page Chrome keeps from extensions (`chrome://` pages, other extensions, the Chrome Web Store, `file:` pages unless Huddle may read file URLs) the popup's button is dimmed and says so, and the shortcut shows a **!** on Huddle's toolbar button with the reason as its tooltip. On a PDF or a page with no links it says there are no links to open.
- Press Escape mid-drag to cancel without opening; switching tabs or windows, or clicking into a frame, also lets go of the key. Cmd+Z doesn't start a drag.
- Choose the key and an optional modifier (Shift, Ctrl or Alt) in **Settings → Open links as tabs**. They sync across your Chrome sign-ins.

### AI suggestions for grouping (optional)

**Organize with AI** suggests tab groups for the current window, through [OpenRouter](https://openrouter.ai) with your own key. Nothing changes until you review the suggestion and apply it. Every other feature works without it.

- **Review before anything moves**: the organize page proposes groups you can rename and recolour, and you can move any tab to another group, before **Apply groups**. Apply keeps the proposal's mode, takes no tab from another window and never unpins a tab. Cmd/Ctrl+Enter runs or applies, and Escape undoes an edit before it closes the page.
- **Model for this run**: the organize page names the model at the top. Change it (the recommended models, the full OpenRouter list, filterable, or a custom model id) and press Run again to re-run in the same tab; the choice applies to that run only, and **Make default** saves it. The recommended models are Claude Haiku 5.5 (the default), Gemini 3.1 Flash Lite and GPT-6 Luna. A default you saved as Claude Haiku 4.5, the default before, stays yours while OpenRouter lists it.
- **What is sent**: a line under Organize says that the window's tab titles and addresses go to OpenRouter, which passes them to a provider it picks for the model. Addresses go without their query and fragment; a `data:` address keeps only its type, a `blob:` one only its origin, and a `file:` one only the file name. Titles are cut at 200 characters and addresses at 300; a `data:`, `blob:` or `file:` tab's title is replaced by its cleaned address, since Chrome titles such a page with its whole address or local path. Tab icons on the page come from Chrome's favicon cache, never from the site.
- **Don't use providers that train on my prompts** (Settings, on by default): every request asks OpenRouter to skip providers that train on prompts (`provider.data_collection: deny`). Providers that keep prompts without training on them still qualify. A model with no such provider then fails with an error that names the setting; pick another model or turn the setting off.
- **No key yet, an expired one, or one OpenRouter rejects**: the organize page asks for the key inline (checked with OpenRouter before it is saved) and starts the run once it is saved. An expired key is deleted from the browser, not just hidden.
- **Errors say what to do**: a model or provider refusal offers Change model, a key problem the key form, Groups mode with nothing ungrouped offers Flat, and a stuck request can be stopped (Esc). A run always ends in a proposal, an error or "This run has ended", never a spinner that never stops.
- **Settings → Organize with AI**: the key's status, replacing or deleting the key, when it expires, and the default model with Don't use providers that train on my prompts. With no key on file, Settings contacts OpenRouter only once you use the model list (its filter, the list or the model id field).
- When the chosen model supports structured outputs, Huddle asks for a strict JSON schema; otherwise it uses JSON object mode. The answer is always reconciled so no tab is dropped.

## Privacy

Huddle runs in your browser. It has no account, no server and no analytics, and it reads your tabs only to organize them.

- **Your settings, your OpenRouter key and your snoozed tabs** stay in Chrome's storage on this computer. Only the Open links as tabs key and modifier sync with your Chrome sign-in.
- **Nothing leaves your computer** unless you use Organize with AI. Then the titles and cleaned addresses of that window's tabs go to OpenRouter, with your key, and OpenRouter passes them to the model's provider. Huddle also checks your key with OpenRouter when you save it, and Settings loads OpenRouter's public list of models.
- **No website access**: Huddle can't read or change the pages you visit, except the one tab you start Open links as tabs on, and only until it navigates.

The full privacy policy is at [joaof.eu/privacy/huddle](https://joaof.eu/privacy/huddle/).

## Permissions

Huddle asks for no access to websites, OpenRouter included: OpenRouter's API allows requests from any origin (CORS), so the key check, the model list and Organize with AI reach it as ordinary requests. Chrome shows four warnings when you install it:

- **`tabs`**, "Read your browsing history": read and arrange your tabs (their titles and addresses); managing windows needs no permission of its own
- **`tabGroups`**, "View and manage your tab groups": keep and rebuild tab groups
- **`notifications`**, "Display notifications": say when snoozed tabs wake, and what Split domains did
- **`favicon`**, "Read the icons of the websites you visit": show each tab's icon on the organize page from Chrome's own favicon cache, so reviewing a proposal never fetches a site's icon (with its cookies)

And these, with no warning:

- **`storage`**: your settings, the OpenRouter key and the snoozed tabs
- **`alarms`**: wake snoozed tabs on time
- **`activeTab`** and **`scripting`**: start Open links as tabs in the page you are on, when you press its shortcut or the popup's button. Huddle gets that one tab until it navigates

## Install

- **From the Chrome Web Store**, from v1.0.0.
- **From a release**: download the zip from [Releases](https://github.com/joaodinissf/jdf-suite/releases?q=jdf-tab-huddle), extract it, open `chrome://extensions`, turn on **Developer mode** (top right), choose **Load unpacked** and select the extracted folder. Huddle's icon appears in the toolbar.

### Moving from an unpacked copy to the Chrome Web Store

The store's Huddle has a different extension ID from a copy you loaded unpacked, so Chrome treats them as two extensions and the store copy starts empty. To move over:

1. **Wake or discard your snoozed tabs** in the unpacked copy (the popup's Sleeping list or the nap room). Snoozed tabs belong to the copy that snoozed them, and removing it deletes them.
2. **Remove the unpacked copy** at `chrome://extensions` before installing, so the store copy can take the shortcuts: Chrome gives no shortcut to a newly installed extension whose keys another one already holds.
3. **Install Huddle from the Chrome Web Store.**
4. **Re-enter your OpenRouter key** in Settings → Organize with AI, and **set your preferences again**: the default model and Don't use providers that train on my prompts, Groups or Flat, the Open links as tabs key and modifier, and any shortcuts you rebound at `chrome://extensions/shortcuts`.

## Browser compatibility

- **Chrome** 147 or later (Manifest V3). Split View Compact and Expand need Chrome 155 and are hidden on older versions.
- **Edge**: Chromium-based Edge.
- **Firefox**: not supported (Huddle uses Chrome-specific APIs).

## Acknowledgements

Open links as tabs is inspired by [linkclump](https://github.com/benblack86/linkclump) by Ben Black; it was reimplemented clean-room from a behavior spec, with no code from the upstream GPL project present in this MIT-licensed repository.

## Version History

- **v0.8.0**: **The audit release** — fixes from a full audit of Huddle (103 findings), each in the simplest form that is correct for real use. **Safer around web pages** — a page can no longer make the link clumper open tabs (only real drags count, more than 10 links asks first, at most 25), frame Huddle's pages, read the AI key or send messages to Huddle's worker; link clumping runs only on http and https pages and keeps working in pages already open after an update. **Privacy** — the organize page says that tab titles and addresses go to OpenRouter; addresses lose their query, `data:`, `blob:` and `file:` tabs send only their type, origin or file name (their titles too), and long titles and addresses are cut; tab icons come from Chrome's cache, not the site; a new setting, on by default, skips providers that train on your prompts, and DeepSeek V4.1 Flash leaves the recommended models because its only provider does (some models may not run while the setting is on, and a refusal names this setting and your OpenRouter privacy settings); Settings with no key shows the recommended models and contacts OpenRouter only once you browse them. **Snoozes** wake in a regular window, never in a stray New Tab, and global dedupe keeps incognito tabs apart. **Split domains** shows what it did, in its dialog or a notification. **Organize with AI** — every model gets an output cap, errors name the right fix, Cmd/Ctrl+Enter in the Run again instructions runs again, Apply keeps the proposal's mode and never unpins a tab, and Escape undoes an edit before it closes the page. **Keyboard and screen readers** — the popup and nap room keep focus after Wake, Discard and Undo; Undo after Discard has no time limit; Settings ends a stalled key check after 15 s, says it is checking and saves the model on Enter; the organize page reflows at 400 % zoom; popup labels reach 10.5 px; Settings gets the hotkey I. **Releases** build without a write token, and CI runs pinned tools. Requires Chrome 147. 1009 unit tests, 130 e2e tests.
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

## Development

### Commands

```bash
pnpm install           # Install dependencies
pnpm test              # Run unit tests (1058 tests)
pnpm test:e2e          # Run E2E tests (139 tests, requires Chromium)
pnpm run lint          # Run ESLint
pnpm run validate      # Validate manifest.json
pnpm run package       # Create extension zip
```

Load `src/` with **Load unpacked** at `chrome://extensions` to run Huddle from a clone. **After switching branches**, reload Huddle there: Chrome keeps running the old background worker until then. The organize page notices and offers **Reload Huddle**.

Chrome 147 is the minimum because `chrome.storage.local.setAccessLevel` keeps the stored OpenRouter key away from the content script in web pages, and 147 is the oldest Chrome the e2e suite proves it on; the organize page's `_favicon` icons need 104+, which 147 covers.

### Project structure

```
packages/jdf-tab-huddle/           # Inside the jdf-suite monorepo
├── src/                           # Extension source code
│   ├── manifest.json              # Chrome extension manifest (v3)
│   ├── background.js              # Service worker with all action handlers
│   ├── popup.html / popup.js      # Extension popup UI
│   ├── confirmation-dialog.*      # Split domains confirmation and result
│   └── icons/                     # Extension icons
├── tests/                         # Vitest unit tests (1058 tests in 22 files)
│   ├── setup.js                   # Chrome API mock, page scripts loaded, dispatch() to the worker
│   ├── senders.js                 # The sender each caller (popup, pages, content script) arrives with
│   ├── routing.test.js            # Every worker action, routed from its real caller; refused from a content script
│   ├── background.test.js         # Background script logic tests
│   ├── popup.test.js              # Popup UI tests
│   ├── snooze.test.js             # Snoozing and waking, through the worker's handlers
│   ├── store-listing.test.js      # The manifest's description and icons, as the store shows them
│   └── confirmation-dialog.test.js
├── e2e/                           # Playwright E2E tests (139 tests)
│   ├── playwright.config.js       # Playwright configuration
│   ├── fixtures/extension.js      # Custom fixture loading extension into Chromium
│   ├── helpers/                   # Tab management, popup interaction, assertions
│   └── tests/                     # 20 spec files covering all features
├── docs/                          # Documentation
├── .github/workflows/             # CI/CD (test, e2e, lint, build, release)
├── package.json
└── eslint.config.js
```

### Testing

#### Unit tests (Vitest + jest-chrome shim)
1058 tests across 22 files covering core logic with mocked Chrome APIs:
```bash
pnpm test                # Run all unit tests
pnpm run test:coverage   # With coverage report
```

`tests/routing.test.js` sends every action the service worker handles through its real `onMessage` listener, from the page that sends it (with the sender Chrome gives that page), and checks the reply and the Chrome call the handler makes. The dispatcher is an if/else chain on `message.action`, except the popup's logging message, which is keyed on `message.type`, and its first branch, the sender check: only Huddle's own pages (a sender `url` under `chrome-extension://<id>/`) may send anything but `clumpOpenUrls`, the one action the Open links as tabs content script (`content-clumper.js`) sends (the worker injects it into a page when Open links as tabs is started there). The test reads every branch of that chain from the source, fails on a branch it does not understand, and checks its table against the actions (and the logging message) found there and against what each page's scripts send; it also sends every row's message from the content script and expects `forbidden`. So a new worker action needs a row there. The test's `dispatch(message, sender)` (in `tests/setup.js`) resolves with the worker's reply, and fails when an action that replies later does not keep the channel open by returning `true`.

#### E2E tests (Playwright + real Chromium)
139 tests across 20 spec files that load the extension into a real browser:

| Spec File | Tests | Coverage |
|---|---|---|
| sort-current-window | 8 | Pinned tabs, groups, special URLs |
| sort-all-windows | 4 | Multi-window, group preservation |
| extract-domain | 7 | Cross-window extraction, pinned immunity |
| extract-all-domains | 8 | Per-domain windows, confirmation dialog |
| remove-duplicates-window | 9 | Same/cross-group dedup, pinned immunity |
| remove-duplicates-all-windows | 4 | Per-window independent dedup |
| remove-duplicates-globally | 7 | Cross-window dedup |
| move-all-to-single-window | 7 | Consolidation, group recreation; Flat leaves no groups and sorts |
| copy-all-tabs | 8 | Clipboard copy, window vs all-windows scope, group sections, feedback |
| popup-ui | 9 | Mode switching, button visibility, no text below 10.5px but the key badges |
| confirmation-dialog | 5 | Confirm/cancel flow, the result shown in the dialog, keyboard |
| flatten-window | 3 | Ungrouping, pinned immunity |
| split-view-compact | 2 | Compact then Expand; pinned/group runs, existing splits, no tab moves (skips below Chrome 155) |
| split-view-repair | 5 | Splits survive sort (both modes), merge and extract; a separated pair is not forced back together (skips below Chrome 155) |
| keyboard | 4 | Popup hotkey dispatch |
| open-links | 7 | On the shipped manifest, started through the toolbar button (DevTools `Extensions.triggerAction`): nothing opens until it is started; its hint; a real drag opens 5 at once, and over 25 links asks and opens the first 25; starting again only shows the hint; a reload ends it; a page's own events open nothing; `chrome://` is refused; no site access and no `windows` permission |
| snooze | 13 | Tab/window/group snooze, wake, alarms, edge cases; the Group button follows the active tab |
| ai-flow | 26 | Organize with AI against a fake OpenRouter that answers CORS like the real one: Save key, the catalog and a run with no host permission, and an answer that fails the CORS check reads as a connection problem; runs, Apply, errors, the line under Organize and `data_collection: deny`; Claude Haiku 5.5 as the default, and a default saved as Haiku 4.5 kept; Settings with no key contacts OpenRouter only once the model list is used; only the organize page's window is sent, Apply never takes a tab from another window or unpins a tab, and Escape and Cmd/Ctrl+Enter in the proposal's fields |
| trust-boundary | 2 | From the content script in a page where Open links as tabs was started: `storage.local` (the key) is refused and `storage.sync` still read; every action but `clumpOpenUrls` is forbidden and an organize port is closed |
| settings | 1 | At 320 px the delete question keeps Delete and Keep side by side |

```bash
pnpm test:e2e            # Run E2E tests (headless; HEADED=1 to watch)
```

### CI/CD

CI lives at the monorepo root: [`.github/workflows/jdf-tab-huddle-ci.yml`](../../.github/workflows/jdf-tab-huddle-ci.yml) — two jobs on every PR touching this package: lint + Vitest unit tests + manifest validation, and the Playwright E2E suite in headless Chromium.
- **GitHub Release**: pushing a `jdf-tab-huddle-v*` tag runs [`.github/workflows/jdf-tab-huddle-release.yml`](../../.github/workflows/jdf-tab-huddle-release.yml), which tests, packages the extension zip and publishes the Release with this README's Version History entry as its notes.
- **Release (CWS upload)**: deferred until v1.0.0 — tracked in [jdf-suite#7](https://github.com/joaodinissf/jdf-suite/issues/7)

[`docs/CI-CD.md`](docs/CI-CD.md) describes both workflows and the release steps.

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Run tests: `pnpm test && pnpm test:e2e`
4. Commit changes: `git commit -am 'Add new feature'`
5. Push to branch: `git push origin feature/new-feature`
6. Open a Pull Request

## License

This project is open-source and available under the MIT License.
