// Snooze UI in the popup and the nap room: failures reach the user, the
// picker's keyboard and focus behaviour, preset labels, and the nap room's
// headers and Wake all. Globals are exposed via tests/setup.js.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupHtml = readFileSync(resolve(__dirname, '../src/popup.html'), 'utf8');

const POPUP_DOM = `
  <div class="grp multi-window-section"><button id="sortAllWindows" data-action="sortAllWindows">Sort all</button></div>
  <div class="grp" id="snoozeSection">
    <div class="snooze-targets">
      <button id="snoozeTab" class="chip" data-action="openSnoozePicker">Tab</button>
      <button id="snoozeSelected" class="chip" data-action="openSnoozePicker">Selected</button>
      <button id="snoozeWindow" class="chip" data-action="openSnoozePicker">Window</button>
      <button id="snoozeGroup" class="chip" data-action="openSnoozePicker">Group</button>
    </div>
    <div id="snoozePickerPanel" hidden>
      <button id="snoozePreset-laterToday" class="preset"></button>
      <button id="snoozePreset-tonight" class="preset"></button>
      <button id="snoozePreset-tomorrow" class="preset"></button>
      <button id="snoozePreset-weekend" class="preset"></button>
      <button id="snoozePreset-nextWeek" class="preset"></button>
      <input type="datetime-local" id="snoozeCustomTime">
      <button id="snoozeCustomConfirm">Snooze</button>
      <button id="snoozePickerCancel">Cancel</button>
      <div id="snoozeFeedback"></div>
    </div>
  </div>
  <div id="sleepingSection" hidden><ul id="snoozedList"></ul></div>
  <div class="toasts">
    <div id="actionResult" class="action-result" role="status" hidden></div>
    <div id="discardNotice" class="undo-notice" hidden>
      <span id="discardNoticeText"></span>
      <button id="discardUndo" data-action="undoDiscard">Undo</button>
    </div>
  </div>`;

const PRESETS = [
  { key: 'laterToday', label: 'Later today', wakeAt: new Date(2024, 0, 10, 15, 0).getTime() },
  { key: 'tonight', label: 'Tonight', wakeAt: new Date(2024, 0, 10, 18, 0).getTime() },
  { key: 'tomorrow', label: 'Tomorrow', wakeAt: new Date(2024, 0, 11, 9, 0).getTime() },
  { key: 'weekend', label: 'This weekend', wakeAt: new Date(2024, 0, 13, 9, 0).getTime() },
  { key: 'nextWeek', label: 'Next week', wakeAt: new Date(2024, 0, 15, 9, 0).getTime() },
];

// Route sendMessage by action. A handler returning undefined holds the reply
// (the callback is kept in `held`) so a test can answer it later.
function routeMessages(handlers) {
  const held = [];
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    const h = handlers[message.action];
    if (callback) {
      const reply = h ? h(message) : undefined;
      if (reply === undefined) held.push({ message, callback });
      else callback(reply);
    }
    return Promise.resolve();
  });
  return held;
}

function mockSnapshot(windows) {
  chrome.windows.getCurrent.mockResolvedValue({ id: windows[0].id });
  chrome.windows.getAll.mockResolvedValue(windows);
  chrome.tabGroups.query.mockResolvedValue([]);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const resultText = () => document.getElementById('actionResult').textContent;
const resultIsError = () => document.getElementById('actionResult').classList.contains('error');

beforeEach(() => {
  document.body.innerHTML = POPUP_DOM;
  document.body.className = '';
  chrome.runtime.lastError = null;
});

describe('Popup: Wake / Discard / Undo report what happened', () => {
  test('a Wake the background could not do shows its reason as an error', () => {
    routeMessages({ wakeSnoozed: () => ({ success: false, error: 'Could not restore right now — will retry automatically' }) });
    wakeNow('r1');
    expect(resultText()).toBe('Could not restore right now — will retry automatically');
    expect(resultIsError()).toBe(true);
  });

  test('a partial wake says how many tabs could not be reopened', () => {
    routeMessages({ wakeSnoozed: () => ({ success: true, createdCount: 2, failedCount: 1 }) });
    wakeNow('r1');
    expect(resultText()).toBe('Reopened 2 tabs — 1 could not be reopened');
    expect(resultIsError()).toBe(true);
  });

  test('a lost message shows an error', () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      chrome.runtime.lastError = { message: 'The message port closed' };
      if (callback) callback(undefined);
      chrome.runtime.lastError = null;
    });
    wakeNow('r1');
    expect(resultText()).toBe("Couldn't wake: The message port closed");
  });

  test('after a wake the counts and multi-window controls refresh', async () => {
    const section = document.querySelector('.multi-window-section');
    section.style.display = 'none'; // one window when the popup opened
    routeMessages({ wakeSnoozed: () => ({ success: true, createdCount: 3, failedCount: 0 }) });
    mockSnapshot([
      { id: 1, tabs: [{ id: 10, active: true, groupId: -1 }] },
      { id: 2, tabs: [{ id: 20 }, { id: 21 }, { id: 22 }] }, // the woken window
    ]);
    wakeNow('r1');
    expect(resultText()).toBe('Reopened 3 tabs');
    await flush();
    expect(chrome.windows.getAll).toHaveBeenCalled();
    expect(section.style.display).toBe('');
  });

  test('after a snooze the Group button follows the new active tab', async () => {
    routeMessages({ snoozeTab: () => ({ success: true, record: { wakeAt: Date.now() + 3600000 } }) });
    const group = document.getElementById('snoozeGroup');
    group.disabled = true;
    mockSnapshot([{ id: 1, tabs: [{ id: 11, active: true, groupId: 4 }] }]);
    openSnoozePicker('tab');
    submitSnooze(Date.now() + 3600000, 'tomorrow');
    await flush();
    expect(group.disabled).toBe(false);
  });

  test('a failed discard with a reason shows it', () => {
    routeMessages({ cancelSnoozed: () => ({ success: false, error: 'Storage is full' }) });
    discardSnooze('r1');
    expect(resultText()).toBe("Couldn't discard: Storage is full");
  });

  test('a failed Undo keeps the notice so it can be tried again', () => {
    routeMessages({ restoreSnoozed: () => ({ success: false, error: 'Storage is full' }) });
    showDiscardNotice({ id: 'r1', summary: 'A', wakeAt: 1, tabs: [] });
    undoDiscard();
    expect(document.getElementById('discardNotice').hidden).toBe(false);
    expect(resultText()).toBe("Couldn't undo: Storage is full");

    routeMessages({ restoreSnoozed: () => ({ success: true }) });
    undoDiscard();
    expect(document.getElementById('discardNotice').hidden).toBe(true);
  });
});

describe('Popup: snooze picker', () => {
  test('preset buttons stay disabled, with no key, until their times arrive', () => {
    const held = routeMessages({ listSnoozed: () => ({ success: true, items: [] }) });
    initSnoozeUi();
    const later = document.getElementById('snoozePreset-laterToday');
    expect(later.disabled).toBe(true);
    openSnoozePicker('tab');
    expect(later.querySelector('.hotkey-hint')).toBeNull();

    const presetsReply = held.find((h) => h.message.action === 'getSnoozePresets');
    presetsReply.callback({ success: true, presets: PRESETS });
    expect(later.disabled).toBe(false);
    expect(later.textContent).toMatch(/^Later/);
    // The badge is drawn again after the label is set.
    expect(later.querySelector('.hotkey-hint').textContent).toBe('L');
    closeSnoozePicker();
  });

  test('Enter in the custom time field submits it', () => {
    const held = routeMessages({
      listSnoozed: () => ({ success: true, items: [] }),
      getSnoozePresets: () => ({ success: true, presets: PRESETS }),
    });
    initSnoozeUi();
    openSnoozePicker('tab');
    const input = document.getElementById('snoozeCustomTime');
    const d = new Date(Date.now() + 2 * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const sent = held.find((h) => h.message.action === 'snoozeTab');
    expect(sent.message.preset).toBe('custom');
    sent.callback({ success: false, error: 'x' });
    closeSnoozePicker();
  });

  test('closing the picker hands focus back to the unit chip that opened it', () => {
    openSnoozePicker('window');
    document.getElementById('snoozeCustomTime').focus();
    closeSnoozePicker();
    expect(document.activeElement.id).toBe('snoozeWindow');
  });

  test('Escape after opening by hotkey also focuses the chip', () => {
    openSnoozePicker('selected');
    refreshHotkeys();
    handleHotkeyKeydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(document.activeElement.id).toBe('snoozeSelected');
  });

  test('picker errors are announced and use the danger colour', () => {
    const feedback = popupHtml.match(/<div id="snoozeFeedback"[^>]*>/)[0];
    expect(feedback).toContain('role="status"');
    expect(feedback).toContain('aria-live="polite"');
    const rule = popupHtml.match(/\n\s*#snoozeFeedback\s*\{([^}]*)\}/)[1];
    expect(rule).toContain('var(--danger)');
    expect(rule).not.toContain('var(--ac-txt)');
  });

  test('a failed presets load says so when the picker opens', () => {
    const held = routeMessages({ listSnoozed: () => ({ success: true, items: [] }) });
    initSnoozeUi();
    held.find((h) => h.message.action === 'getSnoozePresets').callback({ success: false, error: 'x' });
    openSnoozePicker('tab');
    expect(document.getElementById('snoozeFeedback').textContent).toBe('Could not load snooze times');
    expect(document.getElementById('snoozePreset-tomorrow').disabled).toBe(true);
    closeSnoozePicker();
  });
});

describe('Popup: preset labels name the right day', () => {
  test('"Later today" at 22:30 wakes tomorrow and says so', () => {
    const now = new Date(2024, 0, 10, 22, 30).getTime();
    const wakeAt = new Date(2024, 0, 11, 1, 30).getTime();
    expect(snoozePresetLabel({ key: 'laterToday', label: 'Later today', wakeAt }, now)).toBe('Later · Tomorrow 01:30');
  });

  test('"Tonight" at 23:30 wakes tomorrow and says so', () => {
    const now = new Date(2024, 0, 10, 23, 30).getTime();
    const wakeAt = new Date(2024, 0, 11, 0, 30).getTime();
    expect(snoozePresetLabel({ key: 'tonight', label: 'Tonight', wakeAt }, now)).toBe('In an hour · Tomorrow 00:30');
  });

  test('same-day presets keep their names', () => {
    const now = new Date(2024, 0, 10, 10, 0).getTime();
    const wakeAt = new Date(2024, 0, 10, 13, 0).getTime();
    expect(snoozePresetLabel({ key: 'laterToday', label: 'Later today', wakeAt }, now)).toBe('Later today · 13:00');
  });
});

const NAP_DOM = `
  <p id="napSummary"></p>
  <button id="wakeAll">Wake all</button>
  <div id="discardNotice" hidden><span id="discardNoticeText"></span></div>
  <div id="napStatus" class="nap-status" role="status" hidden></div>
  <div id="napDays"></div>
  <div id="napEmpty" hidden></div>`;

describe('Nap room', () => {
  const NOW = new Date(2024, 0, 10, 12, 0).getTime();
  const napStatus = () => document.getElementById('napStatus');

  beforeEach(() => {
    document.body.innerHTML = NAP_DOM;
  });

  test('a wake time already past goes under "Overdue", not a weekday', () => {
    const yesterday = new Date(2024, 0, 9, 9, 0).getTime();
    expect(napDayInfo(yesterday, NOW).label).toBe('Overdue');
    const items = [{ id: 'a', wakeAt: yesterday }, { id: 'b', wakeAt: new Date(2024, 0, 11, 9, 0).getTime() }];
    expect(napGroupByDay(items, NOW).map((s) => s.label)).toEqual(['Overdue', 'Tomorrow']);
    expect(napNextWakeSummary(items, NOW)).toBe('1 overdue · next wakes tomorrow at 09:00');
  });

  test('the page re-renders at midnight', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2024, 0, 10, 23, 59));
      routeMessages({ listSnoozed: () => ({ success: true, items: [] }) });
      napScheduleMidnightRefresh();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'listSnoozed' }, expect.any(Function));
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test('Wake now shows the background error', async () => {
    routeMessages({
      wakeSnoozed: () => ({ success: false, error: 'Could not reopen 1 tab — kept in the nap room', createdCount: 0, failedCount: 1 }),
      listSnoozed: () => ({ success: true, items: [] }),
    });
    await napWakeNow('r1');
    expect(napStatus().hidden).toBe(false);
    expect(napStatus().textContent).toBe('Could not reopen 1 tab — kept in the nap room');
    expect(napStatus().classList.contains('error')).toBe(true);
  });

  test('Discard shows the background error instead of an Undo notice', async () => {
    routeMessages({
      cancelSnoozed: () => ({ success: false, error: 'Storage is full' }),
      listSnoozed: () => ({ success: true, items: [] }),
    });
    await napDiscard('r1');
    expect(napStatus().hidden).toBe(false);
    expect(napStatus().textContent).toBe("Couldn't discard: Storage is full");
    expect(napStatus().classList.contains('error')).toBe(true);
    expect(document.getElementById('discardNotice').hidden).toBe(true);
  });

  test('a failed Undo keeps the notice', async () => {
    routeMessages({
      restoreSnoozed: () => ({ success: false, error: 'Storage is full' }),
      listSnoozed: () => ({ success: true, items: [] }),
    });
    napShowDiscardNotice({ id: 'r1', summary: 'A', wakeAt: 1, tabs: [] });
    await napUndoDiscard();
    expect(document.getElementById('discardNotice').hidden).toBe(false);
    expect(napStatus().textContent).toBe("Couldn't undo: Storage is full");
  });

  test('Wake all stays disabled while it runs, then reports what failed', async () => {
    const items = [
      { id: 'a', type: 'tab', summary: 'A', wakeAt: NOW + 3600000, tabs: [{ url: 'https://a/' }] },
      { id: 'b', type: 'tab', summary: 'B', wakeAt: NOW + 7200000, tabs: [{ url: 'file:///b' }] },
    ];
    const held = routeMessages({ listSnoozed: () => ({ success: true, items }) });
    const btn = document.getElementById('wakeAll');
    const run = napWakeAll();
    await flush();
    const first = held.find((h) => h.message.id === 'a');
    expect(napStatus().textContent).toBe('Waking 1 of 2…');
    // The storage change after the first wake re-renders the page mid-run.
    napRenderAll(items.slice(1));
    expect(btn.disabled).toBe(true);
    first.callback({ success: true, createdCount: 1, failedCount: 0 });
    await flush();
    held.find((h) => h.message.id === 'b')
      .callback({ success: false, error: 'Could not reopen 1 tab — kept in the nap room', createdCount: 0, failedCount: 1 });
    await run;
    expect(napStatus().textContent).toBe('Reopened 1 tab — 1 could not be reopened');
    expect(napStatus().classList.contains('error')).toBe(true);
    expect(btn.disabled).toBe(false);
  });
});

// A wake that started shows where it stands, a failed read is never "nothing
// sleeping", and Wake now can't be sent twice (M1's UI, L44, L46).
describe('Popup: the sleeping list while tabs wake', () => {
  const item = (id, extra = {}) => ({
    id, type: 'tabs', summary: `${id} tabs`, wakeAt: Date.now() + 3600000,
    tabs: [{ url: 'https://a/' }, { url: 'https://b/' }], ...extra,
  });
  const row = (id) => document.querySelector(`.snoozed-item[data-id="${id}"]`);
  const buttons = (id) => [...row(id).querySelectorAll('button')];

  test('a wake in progress reads "Waking…" with both buttons disabled; one that didn\'t finish offers Wake and Discard', () => {
    routeMessages({
      listSnoozed: () => ({
        success: true,
        items: [item('active', { waking: 'active', stalled: false }), item('stopped', { waking: 'interrupted', stalled: true }), item('plain')],
      }),
    });
    renderSnoozedList();
    expect(row('active').querySelector('.snoozed-time').textContent).toBe('Waking…');
    expect(buttons('active').map((b) => b.disabled)).toEqual([true, true]);
    expect(row('stopped').querySelector('.snoozed-time').textContent).toBe('Didn\'t finish waking');
    expect(buttons('stopped').map((b) => b.disabled)).toEqual([false, false]);
    expect(row('plain').querySelector('.snoozed-time').textContent).toBe(formatWakeTime(item('plain').wakeAt));
    expect(document.getElementById('sleepingSection').hidden).toBe(false);
  });

  test('a failed read says so with Retry, never an empty or hidden list; Retry reads again', () => {
    let fail = true;
    routeMessages({
      listSnoozed: () => (fail ? { success: false, error: 'IO error' } : { success: true, items: [item('back')] }),
    });
    renderSnoozedList();
    const section = document.getElementById('sleepingSection');
    expect(section.hidden).toBe(false);
    expect(document.getElementById('snoozedList').textContent).toContain('Couldn\'t read your sleeping tabs');
    const retry = document.getElementById('snoozedRetry');
    expect(retry.textContent).toBe('Retry');
    fail = false;
    retry.click();
    expect(row('back')).toBeTruthy();
    expect(document.getElementById('snoozedRetry')).toBeNull();
  });

  test('a lost listSnoozed reply is a failed read too', () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      chrome.runtime.lastError = { message: 'Could not establish connection' };
      callback(undefined);
      chrome.runtime.lastError = null;
    });
    renderSnoozedList();
    expect(document.getElementById('snoozedRetry')).toBeTruthy();
  });

  test('an unchanged list is not rebuilt, so progress saves cause no churn; a change is', () => {
    let items = [item('a'), item('b')];
    routeMessages({ listSnoozed: () => ({ success: true, items }) });
    renderSnoozedList();
    const first = row('a');
    renderSnoozedList();
    expect(row('a')).toBe(first);
    items = [item('a', { waking: 'active' }), item('b')];
    renderSnoozedList();
    expect(row('a')).not.toBe(first);
    expect(row('a').querySelector('.snoozed-time').textContent).toBe('Waking…');
  });

  test('Wake now disables its row while the request runs', () => {
    const items = [item('a'), item('b')];
    const held = routeMessages({ listSnoozed: () => ({ success: true, items }) });
    renderSnoozedList();
    wakeNow('a');
    expect(buttons('a').map((b) => b.disabled)).toEqual([true, true]);
    expect(buttons('b').map((b) => b.disabled)).toEqual([false, false]);
    held.find((h) => h.message.action === 'wakeSnoozed').callback({ success: true, createdCount: 2, failedCount: 0 });
    expect(buttons('a').map((b) => b.disabled)).toEqual([false, false]);
  });

  test('while a Wake now runs its row keeps its digit, unbound: pressing 1 again never wakes the next row', () => {
    const items = [item('a'), item('b'), item('c')];
    const held = routeMessages({ listSnoozed: () => ({ success: true, items }) });
    renderSnoozedList();
    const wakeOf = (id) => row(id).querySelector('[data-action="wake"]');
    expect(buildHotkeyMap().get('1')).toBe(wakeOf('a'));
    wakeNow('a');
    const map = buildHotkeyMap();
    expect(map.has('1')).toBe(false);
    expect(map.get('2')).toBe(wakeOf('b'));
    expect(map.get('3')).toBe(wakeOf('c'));
    expect(wakeOf('b').querySelector('.hotkey-hint').textContent).toBe('2');
    // A reply that leaves the list as it was gives the row its digit back.
    held.find((h) => h.message.action === 'wakeSnoozed').callback({ success: false, error: 'IO error' });
    expect(wakeOf('a').querySelector('.hotkey-hint').textContent).toBe('1');
    expect(wakeOf('a').getAttribute('aria-keyshortcuts')).toBe('1');
  });

  test('a row that is waking keeps its place in the numbering', () => {
    routeMessages({ listSnoozed: () => ({ success: true, items: [item('a', { waking: 'active' }), item('b')] }) });
    renderSnoozedList();
    const map = buildHotkeyMap();
    expect(map.has('1')).toBe(false);
    expect(map.get('2')).toBe(row('b').querySelector('[data-action="wake"]'));
  });

  test('a reply that it is already waking, or already gone, shows nothing red', () => {
    for (const reply of [
      { success: false, waking: 'active' },
      { success: false, notFound: true, error: 'Snooze not found' },
    ]) {
      document.getElementById('actionResult').hidden = true;
      routeMessages({ wakeSnoozed: () => reply, listSnoozed: () => ({ success: true, items: [] }) });
      wakeNow('a');
      expect(document.getElementById('actionResult').hidden).toBe(true);
      expect(resultIsError()).toBe(false);
    }
  });

  test('discarding a wake that didn\'t finish says only the tabs that hadn\'t reopened went', () => {
    routeMessages({
      cancelSnoozed: () => ({
        success: true, interrupted: true, discardedCount: 2,
        record: { id: 'r', summary: '2 selected tabs', wakeAt: 1, tabs: [{ url: 'https://b/' }, { url: 'https://c/' }] },
      }),
    });
    discardSnooze('r');
    expect(document.getElementById('discardNoticeText').textContent).toBe('Discarded 2 tabs that hadn\'t reopened.');
    expect(discardNoticeText({ summary: 'Group "X" (3 tabs)', tabs: [] })).toBe('Discarded Group "X" (3 tabs).');
  });

  test('discarding a wake that didn\'t finish, whose tabs had all reopened, says so instead of nothing', () => {
    routeMessages({ cancelSnoozed: () => ({ success: true, interrupted: true, discardedCount: 0 }) });
    discardSnooze('r');
    expect(document.getElementById('discardNotice').hidden).toBe(true);
    expect(document.getElementById('actionResult').hidden).toBe(false);
    expect(resultText()).toBe('Its tabs had all reopened — nothing left to discard');
    expect(resultIsError()).toBe(false);
  });
});

describe('Nap room: loading, failures and refreshes', () => {
  const napDom = () => {
    document.body.innerHTML = NAP_DOM;
    document.getElementById('napSummary').textContent = 'Loading…';
  };
  const row = (id) => document.querySelector(`.nap-row[data-id="${id}"]`);
  const item = (id, extra = {}) => ({
    id, type: 'tab', summary: id, wakeAt: Date.now() + 3600000,
    tabs: [{ url: `https://${id}/`, title: id }], ...extra,
  });

  beforeEach(napDom);

  test('the page starts with "Loading…", not "Nothing sleeping"', () => {
    const html = readFileSync(resolve(__dirname, '../src/nap-room.html'), 'utf8');
    expect(html).toContain('<p id="napSummary">Loading…</p>');
  });

  test('a failed read says so with Retry, never "Nothing sleeping"; Retry reads again', () => {
    let fail = true;
    routeMessages({ listSnoozed: () => (fail ? { success: false, error: 'IO error' } : { success: true, items: [item('a')] }) });
    napLoadAndRender();
    expect(document.getElementById('napSummary').textContent).toBe('Couldn\'t read your sleeping tabs');
    expect(document.getElementById('napEmpty').hidden).toBe(true);
    expect(document.getElementById('wakeAll').disabled).toBe(true);
    expect(document.querySelector('.nap-load-error').getAttribute('role')).toBe('alert');
    fail = false;
    document.getElementById('napRetry').click();
    expect(row('a')).toBeTruthy();
    expect(document.getElementById('napSummary').textContent).toContain('1 tab sleeping');
  });

  test('a wake in progress reads "Waking…" with its buttons disabled; one that didn\'t finish keeps them', () => {
    napRenderAll([item('a', { waking: 'active' }), item('b', { waking: 'interrupted' })]);
    expect(row('a').querySelector('.nap-when').textContent).toBe('Waking…');
    expect([...row('a').querySelectorAll('button')].map((b) => b.disabled)).toEqual([true, true]);
    expect(row('b').querySelector('.nap-when').textContent).toBe('Didn\'t finish waking');
    expect([...row('b').querySelectorAll('button')].map((b) => b.disabled)).toEqual([false, false]);
  });

  test('a storage change that leaves the list the same does not rebuild it', () => {
    const items = [item('a')];
    routeMessages({ listSnoozed: () => ({ success: true, items: structuredClone(items) }) });
    napLoadAndRender();
    const first = row('a');
    napHandleStorageChange({ snoozedItems: {} }, 'local');
    expect(row('a')).toBe(first);
  });

  test('the midnight refresh redraws an unchanged list, so "Tomorrow" becomes "Today"', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2024, 0, 10, 23, 59));
      const items = [{ ...item('a'), wakeAt: new Date(2024, 0, 11, 9, 0).getTime() }];
      routeMessages({ listSnoozed: () => ({ success: true, items }) });
      napLoadAndRender();
      expect(document.querySelector('.day-h .group-chip').textContent).toBe('Tomorrow');
      napScheduleMidnightRefresh();
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(document.querySelector('.day-h .group-chip').textContent).toBe('Today');
      expect(document.getElementById('napSummary').textContent).toContain('next wakes today at 09:00');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test('coming back to the page redraws an unchanged list too', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2024, 0, 10, 23, 59));
      const items = [{ ...item('a'), wakeAt: new Date(2024, 0, 11, 9, 0).getTime() }];
      routeMessages({ listSnoozed: () => ({ success: true, items }) });
      napLoadAndRender();
      vi.setSystemTime(new Date(2024, 0, 11, 8, 0));
      napHandleVisibilityChange();
      expect(document.visibilityState).toBe('visible');
      expect(document.querySelector('.day-h .group-chip').textContent).toBe('Today');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test('Wake now disables its row while pending; "already waking" and "not found" show nothing red', async () => {
    napRenderAll([item('a'), item('b')]);
    const held = routeMessages({ listSnoozed: () => ({ success: true, items: [item('a'), item('b')] }) });
    const pending = napWakeNow('a');
    expect([...row('a').querySelectorAll('button')].map((b) => b.disabled)).toEqual([true, true]);
    expect([...row('b').querySelectorAll('button')].map((b) => b.disabled)).toEqual([false, false]);
    held.find((h) => h.message.action === 'wakeSnoozed').callback({ success: false, waking: 'active' });
    await pending;
    expect(document.getElementById('napStatus').hidden).toBe(true);
    routeMessages({
      wakeSnoozed: () => ({ success: false, notFound: true, error: 'Snooze not found' }),
      listSnoozed: () => ({ success: true, items: [] }),
    });
    await napWakeNow('b');
    expect(document.getElementById('napStatus').hidden).toBe(true);
  });

  test('discarding a wake that didn\'t finish says only the tabs that hadn\'t reopened went', async () => {
    routeMessages({
      cancelSnoozed: () => ({
        success: true, interrupted: true,
        record: { id: 'r', summary: '3 selected tabs', wakeAt: 1, tabs: [{ url: 'https://c/' }] },
      }),
      listSnoozed: () => ({ success: true, items: [] }),
    });
    await napDiscard('r');
    expect(document.getElementById('discardNoticeText').textContent).toBe('Discarded 1 tab that hadn\'t reopened.');
  });

  test('discarding a wake that didn\'t finish, whose tabs had all reopened, says so instead of nothing', async () => {
    routeMessages({
      cancelSnoozed: () => ({ success: true, interrupted: true, discardedCount: 0 }),
      listSnoozed: () => ({ success: true, items: [] }),
    });
    await napDiscard('r');
    expect(document.getElementById('discardNotice').hidden).toBe(true);
    const status = document.getElementById('napStatus');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Its tabs had all reopened — nothing left to discard');
    expect(status.classList.contains('error')).toBe(false);
  });
});
