# Tab Snoozing

## Summary

Add **tab snoozing**: hide the current tab, the highlighted tabs, a whole window, or a tab group *now*, and have Huddle automatically reopen ("wake") them at a chosen time. Waking recreates the tabs in the **background** of the current window (or recreates a whole window) and fires a Chrome notification summarizing what woke. A minimal "Sleeping" list in the popup shows everything currently snoozed, with per-item **Wake now** and **Discard** actions. Discard drops the sleeping tabs without reopening them, and offers **Undo** for 10 seconds (it was called Cancel until the 2026-09 UI review, which found that "cancel" read as "bring it back").

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
- A **Wake now** button (`class="snoozed-wake"`, `data-action="wake"`) and a **Discard** button (`class="snoozed-discard"`, `data-action="discard"`). Discard never gets a hotkey. After a discard, a `role="status"` notice offers **Undo** (hotkey Z) for 10 seconds.

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

`chrome.alarms.onAlarm` fires `handleSnoozeAlarm(alarm)`. Alarms not starting with `snooze:` are ignored. Otherwise it calls `wakeSnoozedRecord(id, { notify: true, trigger: 'alarm' })`. Wake now, the reconciler and a worker start call the same function with their own trigger.

**The record stays in storage until its wake has finished** (up to 0.6.0 it was popped first, and an interruption lost every tab not yet reopened: M1). While it wakes it carries a claim:

```
record.waking = { by, boot, since, attempts, stalled,
                  opened: [{ i, tabId, windowId }], failed: [i],
                  windowId, placeholderTabId, groupId, baseline: { <url>: n },
                  strayTabIds? }
```

- `by` is `WAKER_ID`, a `crypto.randomUUID()` made when this worker instance starts. `wakingNow` is an in-memory `Set` of the ids this instance is waking (or has marked to resume).
- `boot` is `storage.session.huddleBootId`, written when missing. `storage.session` survives a worker restart and is cleared by a browser restart and by an extension reload, update or re-enable, so tab and window ids keep their meaning within one boot.
- `opened` lists the tabs reopened so far (`i` indexes `record.tabs`, which never changes). `baseline` counts, at the first claim, the regular-window tabs already showing each of the record's URLs.
- `attempts` counts claims. After `WAKE_MAX_ATTEMPTS` (3) automatic attempts the claim is `stalled`.

A record whose wake reopened **no** tab keeps no claim but `wakeFailedAt`, with no alarm. Stalled and `wakeFailedAt` records wait for you: no alarm, reconciler run or worker start retries them, and only Wake now (which resets `attempts`) wakes them again. Wake now acts on the row you pressed only: when it resumes a batch of earlier-boot claims, every other held record in storage keeps waiting, and only the pressed record's `attempts` start again from 1.

**Claim (under `withSnoozeLock`):**
1. Arm `snooze:<id>` at now + 60 s, the recovery alarm. If the worker dies before step 2, the record is still unclaimed and that alarm wakes it, a minute late. An extension reload or a command-line relaunch between the two steps clears that alarm as well: the record then sleeps on to its own `wakeAt`, with nothing lost (a known limit; the Wake now is dropped).
2. `wakeStage('claimed')`, then write `waking` (a resume keeps `opened`, `windowId`, `groupId` and `baseline`, resets `failed`, and increments `attempts`).

**Who acts on a record:**

| State | `snooze:<id>` alarm | Wake now | Discard | Worker start |
|---|---|---|---|---|
| Unclaimed | claim and wake | claim and wake | discard | nothing (its alarm or the reconciler wakes it) |
| Active (in this instance's `wakingNow`) | re-arm at now + 60 s and skip | `{ success: false, waking: 'active' }` | `{ success: false, waking: 'active' }` | n/a |
| Interrupted, this boot (any `by`, not in `wakingNow`) | resume | resume, resetting `attempts` | discard the tabs that had not reopened | resume at once |
| Interrupted, an earlier boot | resume in that boot's mode (below) | resume | as above | resume once the boot's kind is known |
| Stalled / `wakeFailedAt` | nothing | resume or retry | discard | nothing |

**Durable stages.** Each `wakeStage(name, detail)` is a checkpoint; it does nothing unless `globalThis.__huddleWakeHook` is defined (the unit harness and the audit's wake-stage build use it to stop a wake at exactly that point).

- **`tab` / `tabs` / `group`** — into the window saved in the claim if it still exists, else the last-focused normal window (a new one if none). For each index not in `opened`: `chrome.tabs.create({ windowId, url, pinned, active: false })` (`index` is deliberately **omitted**: unlike `chrome.tabs.move`, `chrome.tabs.create` does not accept `index: -1` and throws `"index: Value must be at least 0"`; omitting it appends), then `wakeStage('after-create', i)`, then save `{ i, tabId, windowId }` into `opened`, then `wakeStage('after-progress', i)`. A `group` record creates its group with its first new tab (`chrome.tabs.group` + `chrome.tabGroups.update` with the stored title and colour) and saves `groupId` in the same write; later tabs join it with `chrome.tabs.group({ groupId, tabIds })`. A tab Chrome refuses (a `file://` page without file access) goes into `failed` and the loop goes on.
- **`window`** (D18) — `chrome.windows.create({ focused: false })`, `wakeStage('after-window-create')`, save `windowId` and the window's New Tab as `placeholderTabId`; reopen the tabs into it one by one as above (never one `windows.create({ url: [...] })` call, which a crash after it resolves would repeat whole); `wakeStage('before-group')`; then remove the New Tab (or the window, if nothing came back into it), re-pin the pinned tabs, and recreate each entry of `record.groups` over the reopened tabs with the matching `groupIndex`. The stored `windowId` is only a provenance hint.
- **Complete** — `wakeStage('before-remove')`, then under the lock re-read the record and remove it, clear its alarm, and notify once (only when `notify` is set: alarm, reconciler and resumes; Wake now does not notify) with the totals over every attempt: `createdCount = opened.length`, `failedCount = tabs.length − createdCount`. If not one tab opened, keep the record with `wakeFailedAt` instead.
- **An unfinished wake** (a throw from `getRestoreTargetWindowId` or `windows.create`, a failed completion read) — the id leaves `wakingNow`; with `attempts < 3` the recovery alarm is re-armed at now + 60 s, after the third the claim becomes `stalled` (one "didn't finish waking" notification, no alarm).

**How a resume decides what is done.**
- **Same boot** (`waking.boot` is this boot): `opened` is authoritative. An index in it is done even if you have since closed that tab; indices in `failed` are retried. A missing saved window gets a new one for the missing tabs only; a missing group gets one new group with the record's title and colour, which also takes the reopened tabs that are still open and ungrouped.
- **An earlier boot**, resumed as one batch for every such record. The boot's kind comes from the runtime's own events, never a timeout: `runtime.onStartup`, or `onInstalled` with reason `chrome_update` or `install` (a command-line-loaded extension starting with the browser fires `install` and no `onStartup`, and loses its alarms), means **restart**; `onInstalled` with reason `update` means **reload**. The kind is kept in `storage.session.huddleBootKind`, so every later worker instance of this boot knows it.
  - **Reload** (ids are still valid): an `opened` entry is done when `chrome.tabs.get(tabId)` resolves **and** the tab's `url` or `pendingUrl` still equals the record's URL (an id can name an unrelated tab when the boot was in fact a restart). Entries that fail this check fall to the restart rule below: after the same wait for session restore, they are matched by URL, net of the tabs the check confirmed. This covers a browser restart whose `onInstalled('update')` arrives before `onStartup` (Chrome applying a pending update as it starts), when every id is stale and the reload resume is the one `onStartup` then joins.
  - **Restart** (ids mean nothing): wait for session restore (poll the tabs every second until each URL that can be matched shows in as many tabs as expected (the largest `baseline[url]` among the records, plus every reopened tab with that URL, verified ones included), the count has not changed for 5 polls, or 20 s pass; once per boot). Only indices in `opened` can be matched. Across all interrupted records, oldest claim first, open tabs in regular windows are allocated by exact `url` or `pendingUrl`, each tab once, and for each URL the first `baseline[url]` tabs are left alone as tabs that were open before the wake. A group is reused only when every matched tab sits in one group holding nothing else but New Tabs, or, when nothing matched, a group with the record's title and colour holds only New Tabs; a window only when all its other tabs are New Tabs (session restore brings back a tab whose first page had not committed as a New Tab; those are saved in the claim as `strayTabIds`, kept by every later claim of the same boot, and closed at the end).
  - **Neither event yet** (they may still be on their way, or the extension was re-enabled, which fires neither): a worker start makes sure the claim has a recovery alarm; its first firing only marks the claim `deferredIn` this boot and re-arms; the second resumes it with the reload check. Wake now uses the reload check at once.
  - Before any tab is created, the whole batch is **re-stamped in one write** with this boot, this instance, `attempts + 1` (1 for the record Wake now was pressed on), and only the entries that were verified or matched (with their current ids); `baseline` is kept. Held records are not in the batch, except the one Wake now was pressed on. A later interruption is then a same-boot resume, and a worker instance that receives no startup event always sees a current-boot claim.

**Bounds (D17).** Nothing is ever lost. Within one boot and after an extension reload, each interruption leaves at most **one** duplicate tab (the tab created but not yet saved), and for a window record at most one leftover empty window; a group record's duplicate may sit outside the group. After a browser restart, a reopened tab whose address changed before the restart (a redirect, a navigation) is not matched and opens again. The three automatic attempts bound the total.

### Notification content

`chrome.notifications.create('snooze-wake:' + record.id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message })`:

- **title:** `Huddle — tab woke up` (singular) or `Huddle — tabs woke up` (plural).
- **message** by type:
  - `tab`: `"<tab title>" is back` (title truncated to 60 chars at snooze time)
  - `tabs`: `<n> tabs are back`
  - `group`: `Group "<group title>" (<n> tabs) is back` — untitled groups render as `Group "(unnamed)"`
  - `window`: `Window restored (<n> tabs)`
- If `failedCount > 0`, append ` — <failedCount> could not be reopened`.

Best-effort click handling: a top-level `chrome.notifications.onClicked` listener focuses the woken window/first woken tab, using an in-memory `Map` of notificationId → `{ windowId, tabId }`. Because the MV3 worker is ephemeral this map may be gone when the user clicks; in that case the click is a silent no-op (and the listener clears the notification). This is explicitly acceptable. The "tabs didn't finish waking" notice (`snooze-stalled:<id>`) has no target: clicking it opens the nap room, and it is cleared when that record later wakes.

### Sleeping-list flows

- **Wake now** — popup sends `{ action: 'wakeSnoozed', id }`. Background runs `wakeSnoozedRecord(id, { notify: false, trigger: 'wakeNow' })` and replies `{ success, createdCount, failedCount }`, `{ success: false, waking: 'active' }` for a wake already in progress, `{ success: false, notFound: true }` for a record already gone, or `{ success: false, waking: 'interrupted', error }` when the wake stopped early (the error says Huddle tries again in a minute only when an alarm will; a held record waits for you). The page disables the row's buttons while the request runs; the "active" and "not found" replies show nothing red (L46). The list re-renders via `storage.onChanged`.
- **Discard** — see Cancel. A wake in progress can't be discarded. Discarding an interrupted wake drops only the tabs that had not reopened: the reply's `record` holds just those, with no claim, and `interrupted: true`, so the notice reads "Discarded 3 tabs that hadn't reopened" and Undo puts back an ordinary snooze. When every tab had reopened, the reply has no `record`, and the page says "Its tabs had all reopened — nothing left to discard". `restoreSnoozed` never stores a `waking` claim.
- **Cancel** — popup sends `{ action: 'cancelSnoozed', id }`. Background removes the record (under lock) and clears the alarm. **Tabs are not reopened** — cancel means "forget it". No confirmation dialog (the list is minimal by design; the URLs are still in Chrome history if the user regrets it).

### Scheduling mechanism — one alarm per record

**Decision: one `chrome.alarms` alarm per snoozed record**, named `snooze:<record.id>`, created with `{ when: record.wakeAt }`. Rejected alternative — a single periodic polling alarm — wakes the service worker every N minutes forever (even with zero snoozes), delays wakes by up to N minutes, and saves nothing: per-record alarms survive service-worker suspension *and* browser restarts, and Chrome's per-extension alarm cap (500) is far beyond realistic snooze counts.

MV3 lifecycle handling, all registered **synchronously at the top level** of `background.js` (an MV3 requirement — listeners registered inside async callbacks are lost when the worker respawns):

- `chrome.alarms.onAlarm.addListener(handleSnoozeAlarm)` — an alarm firing re-spawns the suspended worker. The records (with any wake claim and its progress) live in `chrome.storage.local`; the only worker memory that matters is `wakingNow`, and the claim protocol above makes its loss safe.
- `chrome.runtime.onStartup.addListener(handleBrowserStartup)` — **browser-was-closed case**: records `restart` as this boot's kind, resumes wakes of the earlier session (restart mode), then runs `reconcileSnoozeAlarms()`: it gives every unclaimed, unheld record with `wakeAt <= Date.now()` an alarm if it has none, then wakes them **one at a time** (each stays in storage until its own wake finishes, and a stop part-way leaves the rest to their alarms: M2), then re-creates the alarm of any future record whose alarm is missing or later than its `wakeAt` (an earlier alarm is a recovery alarm and is kept), and a recovery alarm for any claim without one.
- `chrome.runtime.onInstalled.addListener(handleInstalled)` — alarms do **not** survive extension updates/reloads; records the boot's kind (`update` → reload; `chrome_update` or `install` → restart), resumes, and reconciles.
- `onWorkerStart()`, called at the end of the top level, runs on **every** worker start: it resumes wakes a stopped instance of this boot left unfinished (and earlier-boot ones once the boot's kind is known), marking them active in `wakingNow` first so `listSnoozed` (which waits for that marking, not for the wakes) never shows them as interrupted in between. It also calls `loadAiConfig()`, which purges an expired key, and re-creates the `huddle-ai-key-expiry` alarm for a key with a numeric `expiresAt` and no alarm (L12). The reconciler runs only on `onStartup` / `onInstalled`.

### Concurrency

All mutations of `snoozedItems` (snooze, wake, cancel, reconcile) run through `withSnoozeLock(fn)` — a module-level promise chain (`snoozeLock = snoozeLock.then(fn)`) serializing read-modify-write cycles within one worker instance. This prevents the "alarm fires while the user clicks Cancel" race from resurrecting or double-waking a record. Within an instance, `wakingNow` is checked and set before any await, so an alarm, the reconciler and Wake now arriving together wake a record once. Across instances (one worker services all events at a time, but it can stop mid-wake), the `waking` claim and the resume rules above take over.

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

- `id` — `crypto.randomUUID()` (available in MV3 service workers). Primary key; the alarm name is `snooze:<id>`; the notification id is `snooze-wake:<id>` (and `snooze-stalled:<id>` for a wake that stalled).
- `type` — `'tab' | 'tabs' | 'window' | 'group'`. Drives restore strategy and notification wording.
- `summary` — precomputed at snooze time by `buildSnoozeSummary()`; used verbatim in the sleeping list and the notification (tab titles are unavailable after the tab closes, so they must be captured now).
- `wakeAt` / `createdAt` — epoch milliseconds (matches the `expiresAt` convention in `aiConfig`).
- `preset` — one of the five preset keys or `'custom'`; informational (list tooltip, debugging).
- `windowId` — provenance hint only; **never** used as a restore target (see Edge Cases).
- `tabs[]` — per-tab `{ url, title, pinned, index }`, sorted ascending by original `index`. `title` truncated to 60 chars. `groupIndex` (optional, `window` type only) points into the record-level `groups` array.
- `group` — `{ title, color }`, present only for `type: 'group'`. `groups[]` — present only for `type: 'window'` when the window contained groups.
- `waking` — present only while the record wakes (see Wake flow). `wakeFailedAt` — epoch ms, present when a wake reopened none of its tabs; the record then waits for Wake now or Discard. `listSnoozed` never returns the claim itself: a claimed record comes back with `waking: 'active' | 'interrupted'` and `stalled`.
- `snoozedItems` is read with `loadSnoozedItems()`, which **throws** on a failed read or a stored value that is not an array, for every caller: a snooze, Undo, Discard, a wake or the reconciler then refuses and writes nothing, and `listSnoozed` replies `success: false` (L67). (Returning `[]` there let the next save erase every snooze.)

**Record → alarm mapping:** exactly one alarm per record, `chrome.alarms.create('snooze:' + id, { when: wakeAt })`. Records and alarms are reconciled on startup/install (see above); the record in storage is the source of truth, the alarm is merely the timer.

## Edge Cases

- **Pinned tabs** — snoozeable in every unit (unlike sort/dedupe/extract, which skip them: those operations *rearrange*, snoozing is an explicit user action on specific tabs). `pinned: true` is stored and restored: `tab`/`tabs`/`group` wakes create the tab with `pinned: true` (Chrome slots it after existing pinned tabs); `window` wakes re-pin after window creation.
- **Special URLs** — `isSnoozeableUrl(url)` allows `http:`, `https:`, `file:`, `about:blank`, and `chrome-extension:` (excluding this extension's own pages); it rejects `chrome:`, `edge:`, `data:`, `javascript:`, `view-source:`, `devtools:`, and anything unparseable. Rejected tabs are silently left open for multi-tab units; a single-tab snooze of a rejected URL responds with an error the popup surfaces ("This page can't be snoozed"). Rationale: `chrome://` and `data:` tabs either cannot be recreated by `chrome.tabs.create` or lose their content; failing at snooze time is honest, failing at wake time is data loss. `file://` is allowed but wake-time creation may still fail without file access — the try/catch + notification suffix covers it.
- **Snoozing the only tab in a window** — the window closes when its last tab is removed; expected and fine. If it is the only tab in the **last** normal window, the last-window guard first opens a fresh `chrome://newtab/` tab so Chrome (and our service worker) keeps running.
- **Empty/undefined group titles** — a group with `title: ''`/`undefined` is stored as `title: ''`, restored with `title: ''`, and rendered as `Group "(unnamed)"` in summary/list/notification (mirrors `recreateTabGroup`'s `groupInfo.title || ''`).
- **Custom time in the past** — rejected in the popup (validation before send) *and* in the background (`{ success: false, error: 'Wake time is in the past' }`). Preset times are clamped to `now + 60s`, never rejected.
- **Duplicate snoozes** — allowed by design. Records are independent; snoozing the same URL twice creates two records and wakes two tabs. No dedup logic — the user already has Huddle's Deduplicate button.
- **Browser closed across wake time** — Chrome fires expired alarms once at next startup; independently, `reconcileSnoozeAlarms()` on `onStartup` wakes every past-due record. Both paths claim through `wakeSnoozedRecord` (`wakingNow` plus the stored claim), so double-delivery cannot double-restore.
- **Browser closed, extension reloaded, or worker stopped in the middle of a wake** — the record is still stored with its claim and progress; the next worker resumes it as described under Wake flow (same boot, reload or restart), within D17's bounds, and the recovery alarm restarts a dead worker within about 60 s. Only `wakingNow` and the best-effort notification-click map are memory-resident.
- **Service-worker restart** — records and wake claims live in `storage.local`, timers live in `chrome.alarms`, and all listeners are registered synchronously at the top level so a respawned worker re-arms them; `onWorkerStart()` resumes an unfinished wake.
- **Extension update/reload** — clears alarms and `storage.session` but not `storage.local`; `onInstalled` resumes unfinished wakes in reload mode and `reconcileSnoozeAlarms()` re-creates the alarms.
- **A failed read of the sleeping list** — refused everywhere, never read as empty (see Storage Schema). The popup's sleeping section and the nap room say "Couldn't read your sleeping tabs" with Retry, never "Nothing sleeping"; the nap room shows "Loading…" until its first reply (L44).
- **Restoring into a window that no longer exists** — always the case for `window` records and common for the rest. `windowId` is never used as a target: `tab`/`tabs`/`group` wake into the last-focused normal window (creating one if none exists); `window` records always create a fresh window.
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

**No `web_accessible_resources` additions.** The picker and the sleeping list live inside the popup; unlike `confirmation-dialog.html` (which is opened as a standalone tab), no new extension page is required.

## API Usage

### Chrome APIs Required

New:

- `chrome.alarms.create(name, { when })` / `chrome.alarms.clear(name)` / `chrome.alarms.getAll()` / `chrome.alarms.onAlarm`
- `chrome.notifications.create(id, options)` / `chrome.notifications.onClicked` / `chrome.notifications.clear(id)`
- `chrome.windows.getLastFocused({ windowTypes: ['normal'] })`
- `chrome.tabGroups.get(groupId)`
- `chrome.runtime.onStartup` / `chrome.runtime.onInstalled`
- `chrome.storage.onChanged` (popup, live list refresh)

Already in use: `chrome.tabs.query/create/remove/update/group`, `chrome.tabGroups.update`, `chrome.windows.create`, `chrome.storage.local.get/set`.

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
- `loadSnoozedItems()` — reads `snoozedItems`; `[]` when unset; **throws** on a failed read or a value that is not an array.
- `saveSnoozedItems(items)` — writes the array.
- `scheduleSnoozeAlarm(record)` — creates the `snooze:<id>` alarm at `record.wakeAt`.

Message handlers (registered in the `chrome.runtime.onMessage` dispatch, each `return true` for async):

- `handleGetSnoozePresets(sendResponse)` — responds `{ success: true, presets: [{ key, label, wakeAt }] }` computed at call time.
- `handleSnoozeTab(message, sendResponse)` — snoozes the active tab; delegates to `snoozeTabs('tab', ...)`.
- `handleSnoozeSelected(message, sendResponse)` — snoozes highlighted tabs; `snoozeTabs('tabs', ...)`.
- `handleSnoozeWindow(message, sendResponse)` — snoozes the whole current window incl. pinned tabs and group structure; `snoozeTabs('window', ...)`.
- `handleSnoozeGroup(message, sendResponse)` — snoozes the active tab's group (errors if ungrouped); `snoozeTabs('group', ...)`.
- `snoozeTabs(type, tabs, extras, wakeAt, preset)` — shared core implementing steps 1–8 of the snooze flow; returns `{ success, record }` or `{ success: false, error }`.
- `handleListSnoozed(sendResponse)` — waits for the worker-start resume marking, then responds `{ success: true, items }` sorted ascending by `wakeAt`, each claimed record with `waking: 'active' | 'interrupted'` and `stalled`; `{ success: false, error }` when the read fails.
- `handleWakeNow(message, sendResponse)` — `wakeSnoozedRecord(message.id, { notify: false, trigger: 'wakeNow' })`; the replies are listed under Sleeping-list flows.
- `handleCancelSnooze(message, sendResponse)` — removes the record under lock, `chrome.alarms.clear('snooze:' + id)`; responds `{ success, record }` so the UI can offer Undo (`{ success: false, waking: 'active' }` during a wake; for an interrupted wake, `record` holds only the tabs that had not reopened, with `interrupted: true`).
- `handleRestoreSnoozed(message, sendResponse)` — Undo: re-adds `message.record` without any `waking` claim, under lock (never duplicating an id) and re-arms its alarm; responds `{ success }`.

Wake machinery:

- `handleSnoozeAlarm(alarm)` — `onAlarm` listener; ignores names without the `snooze:` prefix; returns `wakeSnoozedRecord(id, { notify: true, trigger: 'alarm' })`, awaited and caught.
- `wakeSnoozedRecord(id, { notify, trigger })` — claims the record (`claimInThisBoot`, or `resumeEarlierBoot` for a claim from an earlier boot), reopens what is not done yet (`reopenTabsRecord` / `reopenWindowRecord`, saving progress with `saveWakeProgress`), then `completeWake` removes it and notifies. Returns `null` for an unknown id.
- `onWorkerStart()`, `handleBrowserStartup()`, `handleInstalled(details)` — see Scheduling mechanism.
- `wakeStage(name, detail)` — the checkpoint hook (see Wake flow).
- `notifyWake(record, createdCount, failedCount)` — fires the Chrome notification and registers it in the best-effort click map.
- `reconcileSnoozeAlarms()` — startup/install reconciler: wakes past-due records one at a time, re-arms missing alarms.

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
chrome.runtime.onStartup.addListener(handleBrowserStartup);
chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.notifications.onClicked.addListener(handleWakeNotificationClicked);
onWorkerStart();
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
- `renderSnoozedList()` — sends `listSnoozed`, rebuilds `#snoozedList` rows (`data-id`, summary, `formatWakeTime`, `.snoozed-wake`, `.snoozed-discard`), toggles `#sleepingSection` visibility and `#sleepingCount`. It rebuilds only when the list's signature (ids, `wakeAt`, summaries, waking state, tab counts) changes, so a wake's progress saves cause no churn. A row whose wake is active reads "Waking…" with both buttons disabled; an interrupted one reads "Didn't finish waking" with Wake and Discard enabled. A failed read shows "Couldn't read your sleeping tabs" with Retry. The nap room follows the same rules, except that its midnight and visibility refreshes always redraw, because its day headings and overdue summary depend on the time.
- `wakeNow(id)` / `cancelSnooze(id)` — send `wakeSnoozed` / `cancelSnoozed` with `{ id }`, then `renderSnoozedList()`. Invoked via one delegated click listener on `#snoozedList` reading `data-action`/`data-id`.
- `formatWakeTime(wakeAt, now = Date.now())` — "Today HH:MM" (same calendar day), "Tomorrow HH:MM", weekday short name + time within 6 days ("Sat 09:00"), else "12 Jul, 09:00" (via `Intl.DateTimeFormat`, default locale, 2-digit hour/minute).

### Options Page Changes

**None.** The sleeping list lives in the popup (rationale above); snoozing has no user-configurable preferences in this iteration (preset times are fixed by spec). `options.html` / `options.js` are untouched.

## Testing

### Unit Tests (Vitest)

New file `tests/snooze.test.js`, following the `tests/background.test.js` style (globals exposed via `tests/setup.js`).

`tests/setup.js` changes:

- Extend the chrome mock with `chrome.alarms` (`create`, `clear`, `clearAll`, `getAll`, `onAlarm.addListener`, plus `onAlarm.callListeners` to fire an alarm at every listener the worker registered), `chrome.notifications` (`create`, `clear`, `onClicked.addListener`), `chrome.runtime.onStartup.addListener`, `chrome.runtime.onInstalled.addListener`, `chrome.windows.getLastFocused`, `chrome.tabGroups.get`, and `chrome.tabs.remove` mocks resolving by default.
- Expose in the background wrapper: `computePresetWakeTime`, `nextWeekdayAt`, `clampWakeAt`, `isSnoozeableUrl`, `buildSnoozeSummary`, `createSnoozeRecord`, `snoozeTabs`, `handleSnoozeTab`, `handleSnoozeSelected`, `handleSnoozeWindow`, `handleSnoozeGroup`, `handleListSnoozed`, `handleWakeNow`, `handleCancelSnooze`, `handleSnoozeAlarm`, `wakeSnoozedRecord`, `reconcileSnoozeAlarms`, `SNOOZE_PRESETS`. The wake protocol itself runs in `tests/helpers/fake-browser.js`, a stateful stand-in for windows, tabs, groups, storage and alarms across worker instances, which evaluates `background.js` afresh per worker and stops a wake at a named `wakeStage` (`tests/snooze-wake.test.js`).
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
- **`wakeSnoozedRecord`** — tabs created with `active: false` in stored order in the last-focused window; pinned restored; `group` type regrouped with title/color via `chrome.tabs.group` + `chrome.tabGroups.update`; `window` type opens an empty background window (`chrome.windows.create({ focused: false })`) and reopens the tabs into it one by one, then removes the New Tab, re-pins and regroups; notification created when `notify: true`, not created when `notify: false`; unknown id → silent no-op (no creates, no notification); a failing `chrome.tabs.create` doesn't abort remaining tabs and increments `failedCount`; `tab` and `tabs` records come back ungrouped (`chrome.tabs.group` is never called), and a `group` record none of whose tabs reopen makes no group.
- **`handleSnoozeAlarm`** — fired through the registered `onAlarm` listeners with two records stored: the AI key alarm (`huddle-ai-key-expiry`) and any other alarm without the `snooze:` prefix wake nothing and leave the store as it was; `snooze:<id>` wakes that record only.
- **`reconcileSnoozeAlarms`** — past-due record → woken with notification and removed, one record at a time (the others stay stored until their turn); future record with no live alarm → alarm re-created; future record with live alarm → untouched; an earlier (recovery) alarm is kept.
- **Wake protocol (`snooze-wake.test.js`)** — the claim's recovery alarm is armed before the claim; a worker stop at each checkpoint (`after-create`, `after-progress`) of tab, tabs, group and window records loses nothing, with at most one duplicate; window records (D18) leave at most one empty window; a failed completion read and an alarm during an active wake; three failed attempts stall the wake (its notice, `snooze-stalled:<id>`, opens the nap room when clicked), and a stalled or nothing-reopened record is left alone by worker starts and the reconciler until Wake now, which wakes only the pressed record and resets only its attempts; reload mode (ids and URLs verified, a stale colliding id not counted; `onInstalled('update')` before or after `onStartup`, with and without a gap, matched by URL); restart mode (session restore on and off, restore arriving late, records sharing a URL, the baseline (a URL already open before the wake doesn't end the wait for session restore early), window and group reuse, a redirected tab, a second interruption after the re-stamp, which still closes a reused group's New Tab); concurrency; Wake now and Discard during and after a wake; Undo; the AI key alarm on worker start (L12).
- **Reads (L67)** — one failed `storage.local.get` refuses a snooze, Undo and Discard and leaves the stored array as it was; `listSnoozed` replies `success: false`.
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
5. **Wake path** — `wakeSnoozedRecord` and its claim, resume and completion steps, `notifyWake`, `handleSnoozeAlarm`, `handleWakeNow`, `handleCancelSnooze`, `handleListSnoozed`, notification-click handler, top-level listener registrations; unit tests.
6. **Reconciler and worker start** — `reconcileSnoozeAlarms`, `handleBrowserStartup` / `handleInstalled`, `onWorkerStart()`; unit tests for past-due wake, alarm re-arming and every resume mode.
7. **Popup UI** — HTML sections + CSS, then `initSnoozeUi`, `updateSnoozeButtonState`, picker open/close, `submitSnooze`/`submitCustomSnooze`, `renderSnoozedList`, `wakeNow`/`cancelSnooze`, `formatWakeTime`; expose popup helpers in `tests/setup.js`; `formatWakeTime` unit tests.
8. **E2E** — helpers (`openSnoozePicker`, `getSnoozedItems`) then `e2e/tests/snooze.spec.js` scenarios 1–11.
9. **Manual pass** — real alarm firing (snooze 2 minutes out via custom picker, close and reopen Chrome to verify the missed-wake path and the notification), `chrome://extensions` reload to verify `onInstalled` reconciliation.
