# Tab Snoozing

## Summary

Add **tab snoozing**: hide the current tab, the highlighted tabs, a whole window, or a tab group *now*, and have Huddle automatically reopen ("wake") them at a chosen time. Waking recreates the tabs in the **background** of the current window (or recreates a whole window) and fires a Chrome notification summarizing what woke. A minimal "Sleeping" list in the popup shows everything currently snoozed, with per-item **Wake now** and **Discard** actions. Discard drops the sleeping tabs without reopening them, and offers **Undo** with no time limit: in the popup until another button is pressed or the popup closes, and in the nap room until its close mark or another button is pressed, or the page closes. (It was called Cancel until the 2026-09 UI review, which found that "cancel" read as "bring it back".)

Inspired by [snoozz](https://github.com/rohanb10/snoozz-tab-snoozing), but deliberately simpler: no recurring snoozes, no history, no time-editing of existing snoozes, no dedicated dashboard page.

## Motivation

Huddle already reduces tab clutter *spatially* (sort, group, dedupe, extract). Snoozing reduces it *temporally*: a tab you need "tomorrow morning" or "next week" doesn't have to stay open (consuming memory and attention) or be lost to the bookmark graveyard. Closing plus scheduled reopening is the missing third axis of tab organization, and the `chrome.alarms` + `chrome.storage.local` combination makes it cheap and robust in an MV3 service worker.

## Behavior

### Trigger — popup UI

Snoozing is **mode-independent**: it has no `respectGroups` semantics (a snoozed group always restores as a group; a snoozed tab is just a tab). Duplicating the buttons into both mode sections with `-groups` / `-individual` suffixes would falsely imply a behavioral difference between modes. Therefore the snooze UI lives in a **standalone section**, placed *after* the two `tab-content` divs and *before* `#statusBar` in `popup.html`, so it is visible in both modes. Button IDs are unsuffixed.

Two new sections:

**"Snooze" section** (`#snoozeSection`) — one button row with four unit buttons:

| Button ID | Label | Unit snoozed |
|---|---|---|
| `snoozeTab` | Tab | The active tab in the current window |
| `snoozeSelected` | Selected | All highlighted tabs (`chrome.tabs.query({ highlighted: true, currentWindow: true })`) |
| `snoozeWindow` | Window | Every tab in the current window (including pinned) |
| `snoozeGroup` | Group | The tab group containing the active tab |

- `snoozeGroup` is **disabled** (`disabled` attribute + reduced opacity) when the active tab is not in a group; its `title` tooltip reads "Snooze the active tab's group (active tab is not in a group)". State is computed on popup load by `updateSnoozeButtonState()`.
- `snoozeSelected` with a single highlighted tab behaves identically to `snoozeTab`; it stays enabled.

**Time picker panel** (`#snoozePickerPanel`, initially `hidden`) — clicking any unit button stores the pending unit (`openSnoozePicker(unit)`), marks that button visually selected, and reveals the panel below the row. Clicking the same unit button again (or `snoozePickerCancel`) hides the panel. The panel contains:

1. Five preset buttons, each labeled with its name **and the concrete computed time** (e.g. "Tonight · 18:00"), so the user always sees exactly when the wake will happen:
   - `snoozePreset-laterToday`
   - `snoozePreset-tonight`
   - `snoozePreset-tomorrow`
   - `snoozePreset-weekend`
   - `snoozePreset-nextWeek`
2. A custom row: `<input type="datetime-local" id="snoozeCustomTime">` (its `min` attribute set to now + 1 minute, minute granularity) and a confirm button `snoozeCustomConfirm` labeled "Snooze".
3. A cancel button `snoozePickerCancel` labeled "Cancel".
4. A feedback line `#snoozeFeedback` (same pattern as `.copy-feedback`) for success ("Snoozed until Tomorrow 09:00") and error messages ("Pick a time in the future", "This page can't be snoozed").

Preset labels/times are fetched from the background on popup load via the `getSnoozePresets` action (single source of truth for date math — the popup never computes preset times itself). Clicking a preset sends the snooze message with the `wakeAt` the popup displayed; the background re-validates it (see clamping below).

**"Sleeping" section** (`#sleepingSection`, `hidden` when the list is empty) — the management UI.

**Decision: the sleeping list lives in the popup, not the options page.** Rationale: wake/cancel are *operational* actions, exactly like every other button in the popup; the options page is reserved for preferences (clumping settings) and opening it requires a full tab. A minimal list (summary + time + two buttons per row) fits the 380px popup with a `max-height: 180px; overflow-y: auto` container. Tradeoff: very long lists scroll — acceptable for a "minimal list" with no history.

Each list row (`<li class="snoozed-item" data-id="...">`) shows:
- The record `summary` (truncated with `text-overflow: ellipsis`),
- The wake time formatted by `formatWakeTime()` ("Today 18:00", "Tomorrow 09:00", "Sat 09:00", "12 Jul, 09:00"),
- A **Wake now** button (`class="snoozed-wake"`, `data-action="wake"`) and a **Discard** button (`class="snoozed-discard"`, `data-action="discard"`). Discard never gets a hotkey. After a discard, a `role="status"` notice offers **Undo** (hotkey Z) and takes focus. It has no time limit: a press of any other popup button (or its hotkey) dismisses it, and the record it holds goes with it. Keyboard focus survives the list being rebuilt: after Wake now it lands on the same button of the row now in that place, and after Undo on the row that came back.

Wake now's digit (1–9) is the row's place in the list. A row whose Wake now is disabled (its request is running, or it is waking) keeps its digit unbound, so pressing the same digit twice never wakes the next row; the digit comes back when the row is enabled again.

Rows are sorted ascending by `wakeAt`. Clicks are handled by event delegation on `#snoozedList`. The section header shows a count: `Sleeping (<span id="sleepingCount">3</span>)`. The popup also subscribes to `chrome.storage.onChanged` for the `snoozedItems` key and re-renders the list, so an alarm firing while the popup is open updates the UI live.

### Preset time semantics

All presets are computed by `computePresetWakeTime(preset, now = Date.now())` in `background.js` using hand-rolled `Date` math (**decision: no date library** — the five rules below need only `setHours`/`getDay` arithmetic; a dependency would be the first bundled library in an extension that has no build step). All results are **local time** and **strictly in the future by construction**:

| Preset key | Label | Rule |
|---|---|---|
| `laterToday` | Later today | `now + 3h`, exactly. |
| `tonight` | Tonight | Today at **18:00**. If `now >= 18:00` already, `now + 1h` instead. |
| `tomorrow` | Tomorrow | Calendar tomorrow at **09:00** (always future, even at 23:59). |
| `weekend` | This weekend | The next Saturday at **09:00** that is strictly after `now`. Wednesday → this Saturday; Saturday 08:00 → today 09:00; Saturday 10:00 or Sunday → next week's Saturday. |
| `nextWeek` | Next week | The next Monday at **09:00** strictly after *today* (never today — Monday 08:00 still yields next week's Monday, 7 days out; Sunday yields tomorrow, which is next ISO week). |

**Past-time guard:** the presets cannot produce past times, but as a safety net for clock skew, popup-open drift, and custom input races, every handler passes the incoming `wakeAt` through `clampWakeAt(wakeAt, now)` = `Math.max(wakeAt, now + 60_000)`. A **custom** time that is already in the past (or unparseable) is instead **rejected**: the popup validates first (`snoozeCustomTime` value must be ≥ now + 1 min, else show "Pick a time in the future" in `#snoozeFeedback` and send nothing), and the background double-checks custom submissions (`preset === 'custom' && wakeAt < now + 60_000` → `{ success: false, error: 'Wake time is in the past' }`). Presets are clamped, never rejected.

### Snooze flow (all units)

The popup sends `{ action, wakeAt, preset }` (no tab IDs — the background queries `currentWindow` itself, consistent with `handleSortCurrentWindow`). All four handlers funnel into one shared core, `snoozeTabs(type, tabs, extras, wakeAt, preset)`:

1. **Collect tabs** for the unit (see per-unit rules below), ordered by ascending `tab.index`.
2. **Filter snoozeable URLs** with `isSnoozeableUrl(url)` (see Edge Cases). Non-snoozeable tabs are silently left open and excluded from the record. If *zero* tabs remain, respond `{ success: false, error: 'Nothing here can be snoozed' }` and stop.
3. **Build the record** with `createSnoozeRecord(...)` (pure function — see Storage Schema), including `summary` via `buildSnoozeSummary()`.
4. **Persist first**: append the record to `snoozedItems` in `chrome.storage.local` (under the storage lock — see Concurrency). Persisting *before* closing tabs means a crash mid-operation can at worst produce a duplicate (record + still-open tab), never data loss.
5. **Schedule the alarm**: `scheduleSnoozeAlarm(record)` → `chrome.alarms.create('snooze:' + record.id, { when: record.wakeAt })`.
6. **Last-window guard**: if closing these tabs would leave zero tabs in the last remaining normal window (which would exit Chrome), first `chrome.tabs.create({ url: 'chrome://newtab/', active: true })` in that window.
7. **Close the tabs**: `chrome.tabs.remove(tabIds)` (closing all of a window's tabs closes the window; no separate `chrome.windows.remove` needed).
8. Respond `{ success: true, record }`. The popup shows "Snoozed until <formatWakeTime>" in `#snoozeFeedback`, hides the picker, and re-renders the sleeping list.

Per-unit collection rules:

- **`snoozeTab`** — `chrome.tabs.query({ active: true, currentWindow: true })`; the single active tab (pinned allowed). `type: 'tab'`.
- **`snoozeSelected`** — `chrome.tabs.query({ highlighted: true, currentWindow: true })`. `type: 'tabs'`.
- **`snoozeWindow`** — `chrome.tabs.query({ currentWindow: true })`, **including pinned tabs**. Group structure is captured too (record-level `groups` array + per-tab `groupIndex`) so the window restores with its groups intact. `type: 'window'`.
- **`snoozeGroup`** — active tab's `groupId`; if `chrome.tabGroups.TAB_GROUP_ID_NONE`, respond `{ success: false, error: 'Active tab is not in a group' }` (defense in depth — the button is disabled in this state anyway). Otherwise `chrome.tabs.query({ groupId, currentWindow: true })` plus `chrome.tabGroups.get(groupId)` for `{ title, color }`. `type: 'group'`.

### Wake flow

`chrome.alarms.onAlarm` fires `handleSnoozeAlarm(alarm)`. Alarms not starting with `snooze:` are ignored. Otherwise it calls `wakeSnoozedRecord(id, { notify: true })`:

**The record stays in storage until its tabs have reopened** (up to 0.6.0 it was popped first, and an interruption lost every tab not yet reopened: M1). A wake is:

1. If this worker is already waking the record (the in-memory `Set` `wakingNow`), re-arm `snooze:<id>` at now + 60 s (the running wake's alarm may just have fired, used up, in a wake longer than a minute), return `{ waking: true }` and do nothing else. Otherwise add the id to `wakingNow`.
2. Arm `snooze:<id>` at now + 60 s, before anything else, so that a worker that stops at any point of the wake is started again and wakes the record once more.
3. Read the record under the storage lock. If there is none (already woken or discarded, a duplicate fire), clear the alarm and return `null` — waking is idempotent.
4. **Restore** via `restoreSnoozedRecord(record)`, with plain browser calls:
   - **`tab` / `tabs` / `group`** — find the target window: `chrome.windows.getLastFocused({ windowTypes: ['normal'] })` if it is not incognito, else the first non-incognito window from `chrome.windows.getAll({ windowTypes: ['normal'] })`; if there is none, `chrome.windows.create({ focused: false })`. An incognito window is never the target: with "Allow in Incognito" on, incognito windows are `normal` windows too, but snoozing refuses incognito tabs, so every snoozed tab came from a regular window (and in incognito it would come back without the user's logins, and be lost with that window). Create each tab in stored-index order with `chrome.tabs.create({ windowId, url, pinned, active: false })` — `index` is deliberately **omitted**, which appends the tab at the end of the window (`pinned: true` tabs are placed by Chrome after existing pinned tabs). Note: unlike `chrome.tabs.move`, `chrome.tabs.create` does **not** accept `index: -1` as "append at the end" — it throws `"index: Value must be at least 0"`. Omitting `index` entirely is the correct way to append. Relative order is preserved; absolute indices are not forced onto the target window. For `group`, after creating the tabs, `chrome.tabs.group({ tabIds, createProperties: { windowId } })` then `chrome.tabGroups.update(newGroupId, { title, color })` (same shape as the existing `recreateTabGroup()` helper). When the window was created for this wake, its New Tab is removed once at least one of the record's tabs has opened in it (so the window never closes); wakes that share the window may each try, and a remove that fails is ignored.
   - **`window`** — `chrome.windows.create({ url: urls, focused: false })` (all tabs in one call preserves order), then `chrome.tabs.update(tabId, { pinned: true })` for each tab whose record entry has `pinned: true`, then recreate each entry of `record.groups` over the new tabs via `chrome.tabs.group` + `chrome.tabGroups.update`. The stored `windowId` is only a provenance hint; the original window is gone by definition. Chrome refuses the whole list when it refuses one URL (a `file://` page without file access), so then Huddle opens an empty background window, reopens the tabs into it one by one, and removes its New Tab (or the window, if nothing came back).
   - Each `chrome.tabs.create` is wrapped in try/catch; failures (e.g. `file://` without file-access) are counted and logged, and restoration continues with the remaining tabs. Returns `{ createdCount, failedCount, windowId, firstTabId }`.
5. **Only then**, under the lock, remove the record from `snoozedItems`, and clear its alarm. If not one tab opened although there were tabs to reopen, keep the record instead (with its alarm cleared: a URL Chrome refuses now is refused again a minute later); it waits in the nap room, overdue, for Wake now or Discard.
6. **Notify** via `notifyWake(record, createdCount, failedCount)` — only when `notify: true` (alarm and reconciler). Manual "Wake now" from the popup does **not** notify (the user is watching it happen).
7. Remove the id from `wakingNow`.

If anything throws (the target window can't be found or made, storage can't be read or written), the record is kept as it is, with the alarm from step 2 still armed, and the error goes to the caller.

**A wake cut short** — the worker stopped, the extension reloaded, the browser quit (with or without session restore) — leaves the record in storage, still due. The alarm from step 2, or the reconciler on the next startup or install, wakes it again **from scratch**. Tabs the first run had already opened open a second time: duplicates are accepted, so that a snooze is never lost. What this leaves: once its tabs are open the record is gone, and those tabs are ordinary open tabs; what happens to them afterwards (a quit, with or without session restore, a download, another extension) is the browser's and the user's business, not Huddle's. An extension reload clears alarms, so after a reload a record whose Wake now was cut short wakes at its own `wakeAt`, or from the reconciler if that is already past; and a worker that stops in the instant between an alarm firing and step 2 leaves the record overdue until the next startup, install or Wake now.

### Notification content

`chrome.notifications.create('snooze-wake:' + record.id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message })`:

- **title:** `Huddle — tab woke up` (singular) or `Huddle — tabs woke up` (plural).
- **message** by type:
  - `tab`: `"<tab title>" is back` (title truncated to 60 chars at snooze time)
  - `tabs`: `<n> tabs are back`
  - `group`: `Group "<group title>" (<n> tabs) is back` — untitled groups render as `Group "(unnamed)"`
  - `window`: `Window restored (<n> tabs)`
- If `failedCount > 0`, append ` — <failedCount> could not be reopened`.

Best-effort click handling: a top-level `chrome.notifications.onClicked` listener focuses the woken window/first woken tab, using an in-memory `Map` of notificationId → `{ windowId, tabId }`. Because the MV3 worker is ephemeral this map may be gone when the user clicks; in that case the click is a silent no-op (and the listener clears the notification). This is explicitly acceptable.

### Sleeping-list flows

- **Wake now** — popup sends `{ action: 'wakeSnoozed', id }`. Background runs `wakeSnoozedRecord(id, { notify: false })` and replies `{ success, createdCount, failedCount }`, `{ success: false, waking: true }` when that record is already waking, `{ success: false, notFound: true }` for a record already gone, or `{ success: false, error }` when the wake failed (it is tried again in a minute). The page disables the row's buttons while the request runs; the "waking" and "not found" replies show nothing red (L46). The list re-renders via `storage.onChanged`.
- **Discard** — see Cancel. A record that is waking can't be discarded: the reply is `{ success: false, waking: true }`.
- **Cancel** — popup sends `{ action: 'cancelSnoozed', id }`. Background removes the record (under lock) and clears the alarm. **Tabs are not reopened** — cancel means "forget it". No confirmation dialog (the list is minimal by design; the URLs are still in Chrome history if the user regrets it).

### Scheduling mechanism — one alarm per record

**Decision: one `chrome.alarms` alarm per snoozed record**, named `snooze:<record.id>`, created with `{ when: record.wakeAt }`. Rejected alternative — a single periodic polling alarm — wakes the service worker every N minutes forever (even with zero snoozes), delays wakes by up to N minutes, and saves nothing: per-record alarms survive service-worker suspension *and* browser restarts, and Chrome's per-extension alarm cap (500) is far beyond realistic snooze counts.

MV3 lifecycle handling, all registered **synchronously at the top level** of `background.js` (an MV3 requirement — listeners registered inside async callbacks are lost when the worker respawns):

- `chrome.alarms.onAlarm.addListener(handleSnoozeAlarm)` — an alarm firing re-spawns the suspended worker; all state is in `chrome.storage.local`. The only worker memory is `wakingNow`, and losing it is harmless: the record is still stored and still due.
- `chrome.runtime.onStartup.addListener(reconcileSnoozeAlarms)` — **browser-was-closed case**: Chrome fires alarms whose time passed while the browser was closed once at next startup, but `reconcileSnoozeAlarms()` is the belt-and-braces guarantee: it loads `snoozedItems`, arms `snooze:<id>` at now + 60 s for every record with `wakeAt <= Date.now()` (so a worker that stops part-way through leaves none without an alarm), then wakes (with notification) each of them **one at a time**, with the same wake as above (so each stays in storage until its own tabs are open: M2), and re-creates alarms for future records missing from `chrome.alarms.getAll()`.
- `chrome.runtime.onInstalled.addListener(reconcileSnoozeAlarms)` — alarms do **not** survive extension updates/reloads; reconciling on install/update re-arms everything from storage.
- Every worker start (the top level) also calls `loadAiConfig()`, which purges an expired key, and re-creates the `huddle-ai-key-expiry` alarm for a key with a numeric `expiresAt` and no alarm (L12).

### Concurrency

All reads and mutations of `snoozedItems` (snooze, wake, cancel, list, reconcile) run through `withSnoozeLock(fn)` — a module-level promise chain (`snoozeLock = snoozeLock.then(fn)`) serializing read-modify-write cycles within one worker instance. This prevents the "alarm fires while the user clicks Cancel" race from resurrecting or double-waking a record. `wakingNow` is checked and set before any await, so an alarm, the reconciler and Wake now arriving together open a record once; Discard checks it under the lock. (Cross-instance races are impossible: one worker services all events. A new worker after a stop starts with an empty `wakingNow` and simply wakes the record again.)

## Storage Schema

A new `chrome.storage.local` key **`snoozedItems`** holding an **array of records** (consistent with the existing flat `chrome.storage.local` usage for `aiConfig` and `selectedMode`; snoozes are device-local by nature — tabs live on this machine — so `storage.sync` is wrong here). Example with one record of each type:

```json
{
  "snoozedItems": [
    {
      "id": "b3e1c9a2-5f7d-4e2a-9c1b-8a0d6e4f2c11",
      "type": "tab",
      "summary": "Example Domain",
      "createdAt": 1751600000000,
      "wakeAt": 1751652000000,
      "preset": "tomorrow",
      "windowId": 123,
      "tabs": [
        { "url": "https://example.com/aaa", "title": "Example Domain", "pinned": false, "index": 4 }
      ]
    },
    {
      "id": "a7f2d1e0-1234-4abc-8def-0123456789ab",
      "type": "tabs",
      "summary": "3 selected tabs",
      "createdAt": 1751600100000,
      "wakeAt": 1751610900000,
      "preset": "laterToday",
      "windowId": 123,
      "tabs": [
        { "url": "https://example.org/aaa", "title": "A", "pinned": false, "index": 1 },
        { "url": "https://example.org/bbb", "title": "B", "pinned": false, "index": 2 },
        { "url": "https://example.net/aaa", "title": "C", "pinned": false, "index": 5 }
      ]
    },
    {
      "id": "c9d8e7f6-5678-4cba-9abc-fedcba987654",
      "type": "group",
      "summary": "Group \"Research\" (2 tabs)",
      "createdAt": 1751600200000,
      "wakeAt": 1752130800000,
      "preset": "nextWeek",
      "windowId": 123,
      "group": { "title": "Research", "color": "blue" },
      "tabs": [
        { "url": "https://a.example.com/aaa", "title": "Paper 1", "pinned": false, "index": 6 },
        { "url": "https://a.example.com/bbb", "title": "Paper 2", "pinned": false, "index": 7 }
      ]
    },
    {
      "id": "d0c1b2a3-9abc-4def-8123-456789abcdef",
      "type": "window",
      "summary": "Window (4 tabs)",
      "createdAt": 1751600300000,
      "wakeAt": 1751713200000,
      "preset": "custom",
      "windowId": 456,
      "groups": [ { "title": "Work", "color": "green" } ],
      "tabs": [
        { "url": "https://example.com/pinned", "title": "Pinned", "pinned": true,  "index": 0 },
        { "url": "https://example.com/one",    "title": "One",    "pinned": false, "index": 1 },
        { "url": "https://example.com/two",    "title": "Two",    "pinned": false, "index": 2, "groupIndex": 0 },
        { "url": "https://example.com/three",  "title": "Three",  "pinned": false, "index": 3, "groupIndex": 0 }
      ]
    }
  ]
}
```

Field notes:

- `id` — `crypto.randomUUID()` (available in MV3 service workers). Primary key; the alarm name is `snooze:<id>`; the notification id is `snooze-wake:<id>`.
- `type` — `'tab' | 'tabs' | 'window' | 'group'`. Drives restore strategy and notification wording.
- `summary` — precomputed at snooze time by `buildSnoozeSummary()`; used verbatim in the sleeping list and the notification (tab titles are unavailable after the tab closes, so they must be captured now).
- `wakeAt` / `createdAt` — epoch milliseconds (matches the `expiresAt` convention in `aiConfig`).
- `preset` — one of the five preset keys or `'custom'`; informational (list tooltip, debugging).
- `windowId` — provenance hint only; **never** used as a restore target (see Edge Cases).
- `tabs[]` — per-tab `{ url, title, pinned, index }`, sorted ascending by original `index`. `title` truncated to 60 chars. `groupIndex` (optional, `window` type only) points into the record-level `groups` array.
- `group` — `{ title, color }`, present only for `type: 'group'`. `groups[]` — present only for `type: 'window'` when the window contained groups.
- `listSnoozed` adds `waking: true | false` to each record it returns: whether this worker is waking it right now. Nothing about a wake is stored.
- `snoozedItems` is read with `loadSnoozedItems()`, which **throws** on a failed read: a snooze, Undo, Discard, a wake or the reconciler then refuses and writes nothing, and `listSnoozed` replies `success: false` (L67; returning `[]` there let the next save erase every snooze). A stored value that is not an array is moved aside to `snoozedItemsCorrupt:<epoch ms>` (so nothing is lost), reported once with `console.error`, and snoozing carries on from an empty list.

**Record → alarm mapping:** exactly one alarm per record, `chrome.alarms.create('snooze:' + id, { when: wakeAt })`. Records and alarms are reconciled on startup/install (see above); the record in storage is the source of truth, the alarm is merely the timer.

## Edge Cases

- **Pinned tabs** — snoozeable in every unit (unlike sort/dedupe/extract, which skip them: those operations *rearrange*, snoozing is an explicit user action on specific tabs). `pinned: true` is stored and restored: `tab`/`tabs`/`group` wakes create the tab with `pinned: true` (Chrome slots it after existing pinned tabs); `window` wakes re-pin after window creation.
- **Special URLs** — `isSnoozeableUrl(url)` allows `http:`, `https:`, `file:`, `about:blank`, and `chrome-extension:` (excluding this extension's own pages); it rejects `chrome:`, `edge:`, `data:`, `javascript:`, `view-source:`, `devtools:`, and anything unparseable. Rejected tabs are silently left open for multi-tab units; a single-tab snooze of a rejected URL responds with an error the popup surfaces ("This page can't be snoozed"). Rationale: `chrome://` and `data:` tabs either cannot be recreated by `chrome.tabs.create` or lose their content; failing at snooze time is honest, failing at wake time is data loss. `file://` is allowed but wake-time creation may still fail without file access — the try/catch + notification suffix covers it.
- **Snoozing the only tab in a window** — the window closes when its last tab is removed; expected and fine. If it is the only tab in the **last** normal window, the last-window guard first opens a fresh `chrome://newtab/` tab so Chrome (and our service worker) keeps running.
- **Empty/undefined group titles** — a group with `title: ''`/`undefined` is stored as `title: ''`, restored with `title: ''`, and rendered as `Group "(unnamed)"` in summary/list/notification (mirrors `recreateTabGroup`'s `groupInfo.title || ''`).
- **Custom time in the past** — rejected in the popup (validation before send) *and* in the background (`{ success: false, error: 'Wake time is in the past' }`). Preset times are clamped to `now + 60s`, never rejected.
- **Duplicate snoozes** — allowed by design. Records are independent; snoozing the same URL twice creates two records and wakes two tabs. No dedup logic — the user already has Huddle's Deduplicate button.
- **Browser closed across wake time** — Chrome fires expired alarms once at next startup; independently, `reconcileSnoozeAlarms()` on `onStartup` wakes every past-due record. Both paths go through `wakeSnoozedRecord`, whose `wakingNow` check and remove-after-reopen make double-delivery open a record once.
- **Browser closed, extension reloaded, or worker stopped in the middle of a wake** — the record is still in storage and still due (a wake removes it only once its tabs have reopened); the next alarm or the startup/install reconciler wakes it again from scratch. Some of its tabs may open twice; the snooze is not lost, with or without session restore.
- **Service-worker restart** — records live in `storage.local`, timers live in `chrome.alarms`, and all listeners are registered synchronously at the top level so a respawned worker re-arms them. (Only `wakingNow` and the best-effort notification-click map are memory-resident, and losing either is harmless.)
- **Extension update/reload** — clears alarms but not storage; `onInstalled` → `reconcileSnoozeAlarms()` re-creates them.
- **A failed read of the sleeping list** — refused everywhere, never read as empty (see Storage Schema). The popup's sleeping section and the nap room say "Couldn't read your sleeping tabs" with Retry, never "Nothing sleeping"; the nap room shows "Loading…" until its first reply (L44).
- **Restoring into a window that no longer exists** — always the case for `window` records and common for the rest. `windowId` is never used as a target: `tab`/`tabs`/`group` wake into the last-focused regular (non-incognito) window, else any regular window (creating one if none exists); `window` records always create a fresh window.
- **Alarm fires while the popup is open** — the popup's `chrome.storage.onChanged` listener re-renders the sleeping list; the wake itself proceeds normally in the background.
- **Zero-tab units** — snoozing "Selected" when only non-snoozeable tabs are highlighted, or a group whose tabs are all non-snoozeable, responds `{ success: false, error: 'Nothing here can be snoozed' }`.

## Manifest Changes

`src/manifest.json` — add two permissions (exact resulting array):

```json
"permissions": [
  "tabs",
  "windows",
  "tabGroups",
  "storage",
  "alarms",
  "notifications"
]
```

- `alarms` — per-record wake timers.
- `notifications` — the wake notification (manifest permission suffices; no runtime permission prompt).

**No `web_accessible_resources`.** The picker and the sleeping list live inside the popup, and the nap room opens as a tab of its own; no web page can load any of Huddle's pages.

## API Usage

### Chrome APIs Required

New:

- `chrome.alarms.create(name, { when })` / `chrome.alarms.clear(name)` / `chrome.alarms.getAll()` / `chrome.alarms.onAlarm`
- `chrome.notifications.create(id, options)` / `chrome.notifications.onClicked` / `chrome.notifications.clear(id)`
- `chrome.windows.getLastFocused({ windowTypes: ['normal'] })`
- `chrome.tabGroups.get(groupId)`
- `chrome.runtime.onStartup` / `chrome.runtime.onInstalled`
- `chrome.storage.onChanged` (popup, live list refresh)

Already in use: `chrome.tabs.query/create/remove/update/group`, `chrome.tabGroups.update`, `chrome.windows.create/getAll` (`getAll({ windowTypes: ['normal'] })` finds a regular window to wake into), `chrome.storage.local.get/set`.

### New Functions (background.js)

Constants: `SNOOZE_STORAGE_KEY = 'snoozedItems'`, `SNOOZE_ALARM_PREFIX = 'snooze:'`, `SNOOZE_PRESETS` (ordered `[{ key, label }]` for the five presets).

Pure helpers (unit-testable without Chrome mocks):

- `computePresetWakeTime(preset, now = Date.now())` — returns epoch ms per the preset table; throws on unknown preset.
- `nextWeekdayAt(now, targetDow, hour, strictlyAfterToday)` — next occurrence of weekday `targetDow` at `hour`:00 local; used by `weekend` (strictly after `now`) and `nextWeek` (strictly after today).
- `clampWakeAt(wakeAt, now = Date.now())` — `Math.max(wakeAt, now + 60_000)`.
- `isSnoozeableUrl(url)` — boolean per the Edge Cases allowlist.
- `buildSnoozeSummary(type, tabs, groupInfo)` — the `summary` string per the notification-content table.
- `createSnoozeRecord({ type, tabs, group, groups, windowId, wakeAt, preset })` — assembles and returns a full record (generates `id`, `createdAt`, `summary`, truncates titles).

Storage / scheduling:

- `withSnoozeLock(fn)` — serializes `snoozedItems` mutations on a module-level promise chain; returns `fn`'s result.
- `loadSnoozedItems()` — reads `snoozedItems` (call it under the lock); `[]` when unset; **throws** on a failed read; moves a value that is not an array aside and returns `[]`.
- `saveSnoozedItems(items)` — writes the array.
- `scheduleSnoozeAlarm(record)` — creates the `snooze:<id>` alarm at `record.wakeAt`.

Message handlers (registered in the `chrome.runtime.onMessage` dispatch, each `return true` for async):

- `handleGetSnoozePresets(sendResponse)` — responds `{ success: true, presets: [{ key, label, wakeAt }] }` computed at call time.
- `handleSnoozeTab(message, sendResponse)` — snoozes the active tab; delegates to `snoozeTabs('tab', ...)`.
- `handleSnoozeSelected(message, sendResponse)` — snoozes highlighted tabs; `snoozeTabs('tabs', ...)`.
- `handleSnoozeWindow(message, sendResponse)` — snoozes the whole current window incl. pinned tabs and group structure; `snoozeTabs('window', ...)`.
- `handleSnoozeGroup(message, sendResponse)` — snoozes the active tab's group (errors if ungrouped); `snoozeTabs('group', ...)`.
- `snoozeTabs(type, tabs, extras, wakeAt, preset)` — shared core implementing steps 1–8 of the snooze flow; returns `{ success, record }` or `{ success: false, error }`.
- `handleListSnoozed(sendResponse)` — responds `{ success: true, items }` sorted ascending by `wakeAt`, each with `waking: true | false`; `{ success: false, error }` when the read fails.
- `handleWakeNow(message, sendResponse)` — `wakeSnoozedRecord(message.id, { notify: false })`; the replies are listed under Sleeping-list flows.
- `handleCancelSnooze(message, sendResponse)` — removes the record under lock, `chrome.alarms.clear('snooze:' + id)`; responds `{ success, record }` so the UI can offer Undo, or `{ success: false, waking: true }` while the record wakes.
- `handleRestoreSnoozed(message, sendResponse)` — Undo: re-adds `message.record` under lock (never duplicating an id) and re-arms its alarm; responds `{ success }`. A record with a tab whose URL `isSnoozeableUrl` rejects is refused (`Invalid snooze record`), since a wake opens those URLs. Only Huddle's own pages can send it: the worker refuses every action but `clumpOpenUrls` from a content script.

Wake machinery:

- `handleSnoozeAlarm(alarm)` — `onAlarm` listener; ignores names without the `snooze:` prefix; returns `wakeSnoozedRecord(id, { notify: true })`, with its error caught and logged.
- `wakeSnoozedRecord(id, { notify })` — the wake above: arms its alarm a minute out, skips a record this worker is already waking, restores, and only then removes the record and clears its alarm (or, if not one tab reopened, keeps it and re-arms its alarm if it is not yet due), optionally notifies; on a throw keeps the record, with its alarm still armed. Returns `null` for an unknown id.
- `armWakeRetry(id)` — arms `snooze:<id>` at now + 60 s. `clearSnoozeAlarm(id)` clears it.
- `restoreSnoozedRecord(record)` — recreates tabs/window/group in the background per the wake flow; returns `{ createdCount, failedCount, windowId, firstTabId }`.
- `notifyWake(record, createdCount, failedCount)` — fires the Chrome notification and registers it in the best-effort click map.
- `reconcileSnoozeAlarms()` — startup/install reconciler: arms every past-due record's alarm, wakes them one at a time, re-arms missing alarms.
- `rearmKeyExpiryAlarm()` — runs on every worker start (L12).

Message-dispatch additions (exact shape, appended to the existing `chrome.runtime.onMessage` listener chain):

```javascript
} else if (message.action === 'getSnoozePresets') {
  handleGetSnoozePresets(sendResponse);
  return true;
} else if (message.action === 'snoozeTab') {
  handleSnoozeTab(message, sendResponse);
  return true;
} else if (message.action === 'snoozeSelected') {
  handleSnoozeSelected(message, sendResponse);
  return true;
} else if (message.action === 'snoozeWindow') {
  handleSnoozeWindow(message, sendResponse);
  return true;
} else if (message.action === 'snoozeGroup') {
  handleSnoozeGroup(message, sendResponse);
  return true;
} else if (message.action === 'listSnoozed') {
  handleListSnoozed(sendResponse);
  return true;
} else if (message.action === 'wakeSnoozed') {
  handleWakeNow(message, sendResponse);
  return true;
} else if (message.action === 'cancelSnoozed') {
  handleCancelSnooze(message, sendResponse);
  return true;
}
```

Message payloads: the four snooze actions carry `{ wakeAt: <epoch ms>, preset: <key | 'custom'> }`; `wakeSnoozed`/`cancelSnoozed` carry `{ id }`; the rest carry nothing extra.

Top-level listener registrations (after the `onMessage` block):

```javascript
chrome.alarms.onAlarm.addListener(handleSnoozeAlarm);
chrome.runtime.onStartup.addListener(reconcileSnoozeAlarms);
chrome.runtime.onInstalled.addListener(reconcileSnoozeAlarms);
chrome.notifications.onClicked.addListener(handleWakeNotificationClicked);
rearmKeyExpiryAlarm();
```

### Popup Changes (popup.html / popup.js)

popup.html — insert between the closing `</div>` of `#individual-content` and `#statusBar`:

```html
<div class="section" id="snoozeSection">
  <h3 class="section-header">Snooze</h3>
  <div class="button-row">
    <button id="snoozeTab" title="Snooze the active tab">Tab</button>
    <button id="snoozeSelected" title="Snooze all highlighted tabs">Selected</button>
    <button id="snoozeWindow" title="Snooze every tab in this window">Window</button>
    <button id="snoozeGroup" title="Snooze the active tab's group">Group</button>
  </div>
  <div id="snoozePickerPanel" hidden>
    <div class="button-row">
      <button id="snoozePreset-laterToday"></button>
      <button id="snoozePreset-tonight"></button>
    </div>
    <div class="button-row">
      <button id="snoozePreset-tomorrow"></button>
      <button id="snoozePreset-weekend"></button>
      <button id="snoozePreset-nextWeek"></button>
    </div>
    <div class="button-row">
      <input type="datetime-local" id="snoozeCustomTime">
      <button id="snoozeCustomConfirm" style="flex: 0 0 72px;">Snooze</button>
      <button id="snoozePickerCancel" style="flex: 0 0 60px;">Cancel</button>
    </div>
    <div id="snoozeFeedback" class="copy-feedback"></div>
  </div>
</div>

<div class="section" id="sleepingSection" hidden>
  <h3 class="section-header">Sleeping (<span id="sleepingCount">0</span>)</h3>
  <ul id="snoozedList"></ul>
</div>
```

Plus small CSS additions: `#snoozedList` (list-style none, `max-height: 180px; overflow-y: auto`), `.snoozed-item` (flex row, ellipsized summary span, small time span, compact wake/cancel buttons), a `.selected` state for the active unit button, and dark-on-translucent styling for the `datetime-local` input matching the options-page `select` styling.

popup.js — new functions, wired from the existing `DOMContentLoaded` handler:

- `initSnoozeUi()` — attaches all snooze listeners, fetches presets (`sendAction`-style callback on `getSnoozePresets`), labels the preset buttons ("Tonight · 18:00"), sets `#snoozeCustomTime`'s `min`, subscribes to `chrome.storage.onChanged` for `snoozedItems`, calls `updateSnoozeButtonState()` and `renderSnoozedList()`.
- `updateSnoozeButtonState()` — queries the active tab; disables `snoozeGroup` when `groupId === -1` (mirrors `updateAiButtonState`'s pattern).
- `openSnoozePicker(unit)` / `closeSnoozePicker()` — toggle `#snoozePickerPanel`, track `pendingSnoozeUnit` (`'tab' | 'selected' | 'window' | 'group'`), toggle `.selected` on the unit button.
- `submitSnooze(wakeAt, preset)` — maps `pendingSnoozeUnit` to the action name (`snoozeTab`/`snoozeSelected`/`snoozeWindow`/`snoozeGroup`), sends `{ action, wakeAt, preset }` with a response callback that shows success/error in `#snoozeFeedback`, closes the picker, and re-renders the list.
- `submitCustomSnooze()` — validates `#snoozeCustomTime` (parseable, ≥ now + 1 min) then calls `submitSnooze(parsedMs, 'custom')`; on invalid input shows "Pick a time in the future".
- `renderSnoozedList()` — sends `listSnoozed`, rebuilds `#snoozedList` rows (`data-id`, summary, `formatWakeTime`, `.snoozed-wake`, `.snoozed-discard`), toggles `#sleepingSection` visibility and `#sleepingCount`. A row the worker is waking reads "Waking…" with both buttons disabled. A failed read shows "Couldn't read your sleeping tabs" with Retry. The nap room follows the same rules, and also:
  - its Undo takes focus, and keyboard focus survives a rebuild the same way (to the same button of the same row, else that button in the row now in its place, else Wake all, else the summary line);
  - overdue rows show their date before the clock ("Sep 14, 09:00"), the header's "N overdue" counts tabs, like "N tabs sleeping" beside it, and a named group's row shows its tab count, leaving the name to its chip;
  - Wake now's accessible name starts with its visible label ("Wake now: <summary>"), and the page is a `<main>` landmark.
- `wakeNow(id)` / `cancelSnooze(id)` — send `wakeSnoozed` / `cancelSnoozed` with `{ id }`, then `renderSnoozedList()`. Invoked via one delegated click listener on `#snoozedList` reading `data-action`/`data-id`.
- `formatWakeTime(wakeAt, now = Date.now())` — "Today HH:MM" (same calendar day), "Tomorrow HH:MM", weekday short name + time within 6 days ("Sat 09:00"), else "12 Jul, 09:00" (via `Intl.DateTimeFormat`, default locale, 2-digit hour/minute).

### Options Page Changes

**None.** The sleeping list lives in the popup (rationale above); snoozing has no user-configurable preferences in this iteration (preset times are fixed by spec). `options.html` / `options.js` are untouched.

## Testing

### Unit Tests (Vitest)

New file `tests/snooze.test.js`, following the `tests/background.test.js` style (globals exposed via `tests/setup.js`).

`tests/setup.js` changes:

- Extend the chrome mock with `chrome.alarms` (`create`, `clear`, `clearAll`, `getAll`, `onAlarm.addListener`, plus `onAlarm.callListeners` to fire an alarm at every listener the worker registered), `chrome.notifications` (`create`, `clear`, `onClicked.addListener`), `chrome.runtime.onStartup.addListener`, `chrome.runtime.onInstalled.addListener`, `chrome.windows.getLastFocused`, `chrome.tabGroups.get`, and `chrome.tabs.remove` mocks resolving by default.
- Expose in the background wrapper: `computePresetWakeTime`, `nextWeekdayAt`, `clampWakeAt`, `isSnoozeableUrl`, `buildSnoozeSummary`, `createSnoozeRecord`, `snoozeTabs`, `handleSnoozeTab`, `handleSnoozeSelected`, `handleSnoozeWindow`, `handleSnoozeGroup`, `handleListSnoozed`, `handleWakeNow`, `handleCancelSnooze`, `handleSnoozeAlarm`, `wakeSnoozedRecord`, `reconcileSnoozeAlarms`, `SNOOZE_PRESETS`. A test that needs a **new worker** (one started after the last one stopped) evaluates `background.js` afresh over the same mocks and storage (`startWorker()` in `snooze.test.js`).
- Expose in the popup wrapper: `formatWakeTime`, `renderSnoozedList`, `updateSnoozeButtonState`.

Tests (fixed `now` values passed explicitly; storage mocked with an in-memory object that, like `chrome.storage`, copies values on get and set, so only a save changes what is stored):

- **`computePresetWakeTime`**
  - `laterToday` returns exactly `now + 3h`.
  - `tonight` at Wed 10:00 → Wed 18:00; at Wed 18:00 and Wed 21:30 → `now + 1h`.
  - `tomorrow` at Wed 10:00 and at Wed 23:59 → Thu 09:00.
  - `weekend`: Wed → this Sat 09:00; Sat 08:00 → today 09:00; Sat 10:00 → next Sat; Sun → next Sat.
  - `nextWeek`: Fri → Mon 09:00 (3 days); Mon 08:00 → Mon +7d 09:00; Sun → tomorrow 09:00.
  - Every preset result is strictly `> now`; unknown preset throws.
- **`clampWakeAt`** — past and near-now values clamp to `now + 60_000`; future values pass through.
- **`isSnoozeableUrl`** — allows `https:`/`http:`/`file:`/`about:blank`/foreign `chrome-extension:`; rejects `chrome://settings/`, `data:text/html,...`, `javascript:`, own-extension URLs, `''`, `null`.
- **`buildSnoozeSummary`** — each of the four types, including the `(unnamed)` group and title truncation at 60 chars.
- **`createSnoozeRecord`** — shape (id/createdAt/summary present), tabs sorted by index, pinned + groupIndex captured for `window` type, `group` `{title,color}` captured for `group` type.
- **`snoozeTabs` (via `handleSnoozeTab`)** — persists the record **before** `chrome.tabs.remove` (assert `mock.invocationCallOrder`); creates alarm named `snooze:<id>` with `{ when: wakeAt }`; non-snoozeable active tab → `{ success: false }` and no tab removed; last-window guard creates a `chrome://newtab/` tab first.
- **Custom wake times** — a custom `wakeAt` an hour ahead is stored as is and its alarm set for it; now + 30 s, now − 30 s, a non-number, `NaN` and a missing value are refused with "Wake time is in the past".
- **`handleSnoozeWindow`** — a grouped window stores each group once (`groups[]`, with the fallback title `''` and colour `grey` when Chrome can't describe a group) and each tab's `groupIndex`; waking it recreates each group over exactly its reopened members, with its title and colour, and a group none of whose tabs reopen is not recreated. Only a window snooze stores groups: a selected-tabs snooze of grouped tabs stores none.
- **`handleSnoozeGroup`** — ungrouped active tab → error response, nothing removed.
- **`handleCancelSnooze`** — record removed, `chrome.alarms.clear('snooze:<id>')` called, `chrome.tabs.create` never called.
- **`wakeSnoozedRecord`** — tabs created with `active: false` in stored order in the last-focused window; with an incognito window focused they go to a regular one, with only incognito windows open a regular window is created, and a window created for the wake keeps no New Tab; pinned restored; `group` type regrouped with title/color via `chrome.tabs.group` + `chrome.tabGroups.update`; `window` type uses `chrome.windows.create({ url: [...], focused: false })`; notification created when `notify: true`, not created when `notify: false`; unknown id → silent no-op (no creates, no notification); a failing `chrome.tabs.create` doesn't abort remaining tabs and increments `failedCount`; `tab` and `tabs` records come back ungrouped (`chrome.tabs.group` is never called), and a `group` record none of whose tabs reopen makes no group.
- **`handleSnoozeAlarm`** — fired through the registered `onAlarm` listeners with two records stored: the AI key alarm (`huddle-ai-key-expiry`) and any other alarm without the `snooze:` prefix wake nothing and leave the store as it was; `snooze:<id>` wakes that record only.
- **`reconcileSnoozeAlarms`** — past-due record → woken with notification and removed, one record at a time (the others stay stored until their turn); future record with no live alarm → alarm re-created; future record with live alarm → untouched.
- **A wake cut short (M1, M2)** — a worker that stops mid-wake leaves the whole record and an alarm; a new worker wakes it again and reopens every tab (duplicates allowed); a wake that throws keeps the record, with its alarm about a minute out; two wakes of one record at once open it once, and Discard and `listSnoozed` see it waking; the alarm is armed before the record is read, re-armed by a second wake while one runs, and cleared for a record that is gone; the reconciler arms every due record before it wakes the first.
- **Reads (L67)** — one failed `storage.local.get` refuses a snooze, Undo, Discard and a wake, and leaves the stored array as it was; `listSnoozed` replies `success: false`; a stored value that is not an array is moved aside and snoozing carries on.
- **The AI key alarm on worker start (L12)** — a key with a deadline and no alarm gets its alarm back; an expired key is purged.
- **`formatWakeTime` (popup)** — Today/Tomorrow/weekday/date buckets at fixed `now`.

### E2E Tests (Playwright)

New file `e2e/tests/snooze.spec.js`, following the existing fixture/helper conventions (`test` from `../fixtures/extension.js`, `resetBrowserState`, `createTabs`, `createTabGroup`, `pinTab`, `getWindowTabs`, `openPopup`, `clickPopupButton`, `URLS`, `sleep`). Alarm firing is simulated deterministically via the service-worker fixture — `sw.evaluate((id) => wakeSnoozedRecord(id, { notify: true }), id)` or by invoking `handleSnoozeAlarm({ name: 'snooze:' + id })` — rather than waiting real minutes. Add helpers `openSnoozePicker(popupPage, unit)` and `getSnoozedItems(sw)` (reads `snoozedItems` via `sw.evaluate`) to `e2e/helpers/popup.js` / `e2e/helpers/tabs.js`.

1. **Snooze current tab (preset)** — create tabs, activate one, click `snoozeTab` → `snoozePreset-tomorrow`; assert the tab closed, one record in storage with `preset: 'tomorrow'`, an alarm named `snooze:<id>` exists, and the popup's `#sleepingSection` shows one row.
2. **Wake now** — snooze a tab, click its `.snoozed-wake`; assert the tab reopens with the original URL and `active: false`, storage is empty, and `#sleepingSection` is hidden.
3. **Cancel** — snooze a tab, click `.snoozed-cancel`; assert storage empty, alarm cleared (`sw.evaluate(() => chrome.alarms.getAll())`), and **no** tab was created.
4. **Snooze selected tabs** — highlight 3 tabs, snooze via `snoozeSelected`; assert all 3 closed and a single `type: 'tabs'` record holds 3 entries in index order.
5. **Snooze group + wake** — `createTabGroup` with title/color, activate a member tab, snooze via `snoozeGroup`, simulate the alarm; assert a recreated group with matching title, color, and member URLs.
6. **Group button follows the active tab** — opening the popup as a page makes it the active tab, so the test re-activates the tab under test and has the popup read the window again before each check: with an ungrouped active tab `#snoozeGroup` is disabled (6); with a grouped one it is enabled, and back to disabled for an ungrouped tab in the same window (6b).
7. **Snooze window + wake** — two windows, one with a pinned tab; snooze the window; assert it closed; simulate the alarm; assert a new unfocused window with all URLs in order and the pinned tab pinned.
8. **Custom time in the past** — fill `#snoozeCustomTime` with a past value, click `snoozeCustomConfirm`; assert error feedback visible, storage empty, no tab closed.
9. **Alarm-driven wake into background** — snooze a tab, fire `handleSnoozeAlarm` via `sw.evaluate`; assert the tab reopened without stealing focus from the active tab.
10. **Only tab in last window** — single window, single tab; snooze it; assert a window with a newtab page remains open and the record exists.
11. **Special URL** — active tab on `chrome://version/` (navigate via helper), click `snoozeTab` + preset; assert error feedback, tab still open.

(Notifications are not asserted in Playwright — `chrome.notifications` UI is not observable there; the unit tests cover `notifyWake` invocation.)

## Implementation Order / Checklist

1. **Manifest** — add `alarms` + `notifications` permissions.
2. **Pure helpers** in `background.js` (`SNOOZE_PRESETS`, `computePresetWakeTime`, `nextWeekdayAt`, `clampWakeAt`, `isSnoozeableUrl`, `buildSnoozeSummary`, `createSnoozeRecord`) + expose in `tests/setup.js` + write their Vitest tests. Everything here is date/string logic — get it green before touching Chrome APIs.
3. **Storage & scheduling** — `withSnoozeLock`, `loadSnoozedItems`, `saveSnoozedItems`, `scheduleSnoozeAlarm`; extend the chrome mock in `tests/setup.js` (`alarms`, `notifications`, `getLastFocused`, `tabGroups.get`, `onStartup`/`onInstalled`).
4. **Snooze path** — `snoozeTabs` core + the four `handleSnooze*` handlers + `handleGetSnoozePresets` + dispatch entries; unit tests for persist-before-close, alarm creation, URL filtering, last-window guard, ungrouped-group error.
5. **Wake path** — `restoreSnoozedRecord`, `wakeSnoozedRecord` (remove only after reopening), `notifyWake`, `handleSnoozeAlarm`, `handleWakeNow`, `handleCancelSnooze`, `handleListSnoozed`, notification-click handler, top-level listener registrations; unit tests.
6. **Reconciler** — `reconcileSnoozeAlarms` + `onStartup`/`onInstalled` wiring; unit tests for past-due wake and alarm re-arming.
7. **Popup UI** — HTML sections + CSS, then `initSnoozeUi`, `updateSnoozeButtonState`, picker open/close, `submitSnooze`/`submitCustomSnooze`, `renderSnoozedList`, `wakeNow`/`cancelSnooze`, `formatWakeTime`; expose popup helpers in `tests/setup.js`; `formatWakeTime` unit tests.
8. **E2E** — helpers (`openSnoozePicker`, `getSnoozedItems`) then `e2e/tests/snooze.spec.js` scenarios 1–11.
9. **Manual pass** — real alarm firing (snooze 2 minutes out via custom picker, close and reopen Chrome to verify the missed-wake path and the notification), `chrome://extensions` reload to verify `onInstalled` reconciliation.
