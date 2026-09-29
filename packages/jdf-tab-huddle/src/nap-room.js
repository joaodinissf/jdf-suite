// ============================================================
// Nap room — full-page view of every snoozed record.
//
// Opened from the popup's Sleeping section ("Expand"). Reuses the same
// message API as the popup (listSnoozed / wakeSnoozed / cancelSnoozed /
// restoreSnoozed) and
// live-refreshes via chrome.storage.onChanged on the `snoozedItems` key.
// ============================================================

// Format an epoch ms as a zero-padded local 24h clock ("18:00").
function napFormatClock(wakeAt) {
  const d = new Date(wakeAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Start-of-day timestamp (local time) for a given Date.
function napStartOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// "1 tab" / "3 tabs".
function napPlural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// Compute the day-section header info for a wakeAt timestamp: a bucket key
// to group rows by calendar day, a short label ("Today" / "Tomorrow" /
// weekday name), and a subtitle with the full date. A wake time already in
// the past (a wake that failed and is waiting for a retry, or was kept after
// nothing could be reopened) goes under "Overdue", never a weekday that would
// read as next week.
function napDayInfo(wakeAt, now = Date.now()) {
  const wake = new Date(wakeAt);
  const nowDate = new Date(now);
  if (wakeAt <= now) {
    return { dayKey: 'overdue', label: 'Overdue', subtitle: 'should have woken already' };
  }
  const dayKey = napStartOfDay(wake);
  const dayDiff = Math.round((dayKey - napStartOfDay(nowDate)) / 86400000);

  const fullWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(wake);
  const monthDay = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(wake);

  if (dayDiff === 0) {
    return { dayKey, label: 'Today', subtitle: `${fullWeekday}, ${monthDay}` };
  }
  if (dayDiff === 1) {
    return { dayKey, label: 'Tomorrow', subtitle: `${fullWeekday}, ${monthDay}` };
  }
  // Further out: the weekday name doubles as the label, date as subtitle.
  return { dayKey, label: fullWeekday, subtitle: monthDay };
}

// Human summary of the next wake, e.g. "today at 15:00", used in the header.
// Overdue records are counted separately ("1 overdue · next wakes …").
function napNextWakeSummary(items, now = Date.now()) {
  if (!items || items.length === 0) return null;
  // `items` is expected sorted ascending by wakeAt
  const overdue = items.filter((r) => r.wakeAt <= now).length;
  const next = items.find((r) => r.wakeAt > now);
  const parts = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (next) {
    const { label } = napDayInfo(next.wakeAt, now);
    const when = label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label;
    parts.push(`next wakes ${when} at ${napFormatClock(next.wakeAt)}`);
  }
  return parts.join(' · ');
}

// Row title: the tab's own title for single-tab snoozes, otherwise the
// summary captured at snooze time (already describes the group/window/set).
function napRowTitle(record) {
  if (record.type === 'tab' && record.tabs && record.tabs[0]) {
    const t = record.tabs[0];
    return t.title || t.url || record.summary || '';
  }
  return record.summary || '';
}

// Row URL line: the first tab's real URL, plus an honest "+N more" suffix
// when the record bundles more than one tab. Never fabricates a URL.
function napRowUrl(record) {
  const tabs = record.tabs || [];
  if (tabs.length === 0) return '';
  const first = tabs[0].url || '';
  if (tabs.length === 1) return first;
  return `${first} (+${tabs.length - 1} more)`;
}

// Origin-group badge text, or null. Only shown when the record actually
// carries a group title — never invented for ungrouped snoozes.
function napGroupBadge(record) {
  if (record.type === 'group' && record.group && record.group.title) {
    return record.group.title;
  }
  if (record.type === 'window' && Array.isArray(record.groups)) {
    const titles = [...new Set(record.groups.map((g) => g.title).filter(Boolean))];
    if (titles.length > 0) return titles.join(', ');
  }
  return null;
}

// Bucket sorted-ascending items into per-day sections, preserving order.
function napGroupByDay(items, now = Date.now()) {
  const sections = [];
  const byKey = new Map();
  for (const item of items) {
    const info = napDayInfo(item.wakeAt, now);
    let section = byKey.get(info.dayKey);
    if (!section) {
      section = { ...info, items: [] };
      byKey.set(info.dayKey, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

// ============================================================
// DOM wiring
// ============================================================

function napBuildRow(record) {
  const row = document.createElement('div');
  row.className = 'nap-row';
  row.setAttribute('data-id', record.id);

  const meta = document.createElement('div');
  meta.className = 'nap-meta';
  const title = document.createElement('div');
  title.className = 'nap-t';
  title.textContent = napRowTitle(record);
  title.title = title.textContent;
  const url = document.createElement('div');
  url.className = 'nap-u';
  url.textContent = napRowUrl(record);
  url.title = url.textContent;
  meta.appendChild(title);
  meta.appendChild(url);
  row.appendChild(meta);

  const badge = napGroupBadge(record);
  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'group-badge group-chip';
    // A snoozed group keeps its Chrome colour; a window's groups show grey.
    if (record.type === 'group' && record.group && record.group.color) {
      badgeEl.setAttribute('data-group', record.group.color);
    }
    badgeEl.textContent = badge;
    badgeEl.title = badge;
    row.appendChild(badgeEl);
  }

  const when = document.createElement('div');
  when.className = 'nap-when';
  const zzz = document.createElement('span');
  zzz.className = 'zzz';
  when.appendChild(zzz);
  when.appendChild(document.createTextNode(napRowWhen(record)));
  row.appendChild(when);
  if (record.waking) row.setAttribute('data-waking', record.waking);

  const actions = document.createElement('div');
  actions.className = 'nap-row-actions';
  const wakeBtn = document.createElement('button');
  wakeBtn.className = 'textbtn wake';
  wakeBtn.setAttribute('data-action', 'wake');
  wakeBtn.textContent = 'Wake now';
  wakeBtn.setAttribute('aria-label', `Wake ${record.summary} now`);
  const discardBtn = document.createElement('button');
  discardBtn.className = 'textbtn discard';
  discardBtn.setAttribute('data-action', 'discard');
  discardBtn.textContent = 'Discard';
  discardBtn.title = 'Discard these tabs without reopening them';
  discardBtn.setAttribute('aria-label', `Discard ${record.summary} without reopening`);
  // A wake in progress can be neither woken again nor discarded.
  if (record.waking === 'active') {
    wakeBtn.disabled = true;
    discardBtn.disabled = true;
  }
  actions.appendChild(wakeBtn);
  actions.appendChild(discardBtn);
  row.appendChild(actions);

  return row;
}

// The wake time, or where a wake that has started stands.
function napRowWhen(record) {
  if (record.waking === 'active') return 'Waking…';
  if (record.waking === 'interrupted') return 'Didn\'t finish waking';
  return napFormatClock(record.wakeAt);
}

function napBuildDaySection(section) {
  const day = document.createElement('div');
  day.className = 'day';

  const header = document.createElement('h2');
  header.className = 'day-h';
  header.setAttribute('data-group', 'yellow');
  const label = document.createElement('span');
  label.className = 'group-chip';
  label.textContent = section.label;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = section.subtitle;
  const rule = document.createElement('span');
  rule.className = 'group-line';
  header.appendChild(label);
  header.appendChild(sub);
  header.appendChild(rule);
  day.appendChild(header);

  const list = document.createElement('div');
  list.className = 'nap-list';
  for (const record of section.items) {
    list.appendChild(napBuildRow(record));
  }
  day.appendChild(list);

  return day;
}

// True while Wake all runs: its own re-renders must not re-enable the button.
let napWakingAll = false;

// What the list shows, as a string, kept on the list element. A storage
// change that leaves it the same (a wake saving its progress, say) does not
// rebuild the page.
function napSignature(items) {
  return JSON.stringify((items || []).map((r) => [
    r.id, r.wakeAt, r.summary, r.waking || '', r.stalled ? 1 : 0, (r.tabs || []).length,
  ]));
}

function napRenderAll(items, now = Date.now()) {
  const daysEl = document.getElementById('napDays');
  const emptyEl = document.getElementById('napEmpty');
  const summaryEl = document.getElementById('napSummary');
  const wakeAllBtn = document.getElementById('wakeAll');
  if (!daysEl) return;

  daysEl.dataset.signature = napSignature(items);
  daysEl.innerHTML = '';

  if (!items || items.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    if (summaryEl) summaryEl.textContent = 'Nothing sleeping right now';
    if (wakeAllBtn) wakeAllBtn.disabled = true;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (wakeAllBtn) wakeAllBtn.disabled = napWakingAll;

  const totalTabs = items.reduce((sum, r) => sum + (r.tabs ? r.tabs.length : 1), 0);
  if (summaryEl) {
    summaryEl.textContent = `${napPlural(totalTabs, 'tab')} sleeping · ${napNextWakeSummary(items, now)}`;
  }

  const sections = napGroupByDay(items, now);
  for (const section of sections) {
    daysEl.appendChild(napBuildDaySection(section));
  }
}

// A read that failed never reads as "nothing sleeping": say so, with Retry.
function napRenderLoadError() {
  const daysEl = document.getElementById('napDays');
  const emptyEl = document.getElementById('napEmpty');
  const summaryEl = document.getElementById('napSummary');
  const wakeAllBtn = document.getElementById('wakeAll');
  if (!daysEl) return;
  delete daysEl.dataset.signature;
  daysEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;
  if (summaryEl) summaryEl.textContent = 'Couldn\'t read your sleeping tabs';
  if (wakeAllBtn) wakeAllBtn.disabled = true;
  const box = document.createElement('div');
  box.className = 'nap-load-error';
  box.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = 'Couldn\'t read your sleeping tabs.';
  const retry = document.createElement('button');
  retry.id = 'napRetry';
  retry.className = 'textbtn';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => napLoadAndRender({ force: true }));
  box.appendChild(text);
  box.appendChild(retry);
  daysEl.appendChild(box);
}

// `force` re-renders an unchanged list too: the day headings and the overdue
// summary depend on the time, so the midnight and visibility refreshes must
// always redraw.
function napLoadAndRender({ force = false } = {}) {
  chrome.runtime.sendMessage({ action: 'listSnoozed' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      napRenderLoadError();
      return;
    }
    const items = response.items || [];
    const daysEl = document.getElementById('napDays');
    if (!force && daysEl && napSignature(items) === daysEl.dataset.signature) return;
    napRenderAll(items);
  });
}

// "Today" and "Tomorrow" are only true until midnight: re-render then, so a
// page left open overnight does not keep yesterday's headers.
let napMidnightTimer = null;

function napScheduleMidnightRefresh(now = Date.now()) {
  if (napMidnightTimer) clearTimeout(napMidnightTimer);
  const d = new Date(now);
  const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  napMidnightTimer = setTimeout(() => {
    napLoadAndRender({ force: true });
    napScheduleMidnightRefresh();
  }, nextMidnight - now + 1000);
}

// One status line for what Wake now / Wake all / Discard / Undo did.
const NAP_STATUS_MS = 6000;
const NAP_ERROR_MS = 15000;
let napStatusTimer = null;

function napShowStatus(text, kind = 'ok') {
  const el = document.getElementById('napStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', kind === 'error');
  el.hidden = false;
  if (napStatusTimer) clearTimeout(napStatusTimer);
  napStatusTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? NAP_ERROR_MS : NAP_STATUS_MS);
}

// Promise wrapper for a message that reports a failed delivery as an error
// reply instead of throwing.
function napSend(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: false, error: 'no reply' });
    });
  });
}

// Disables (or re-enables) a row's buttons while its request runs, so a
// second Enter can't send it again.
function napSetRowPending(id, pending) {
  const daysEl = document.getElementById('napDays');
  if (!daysEl) return;
  const row = [...daysEl.querySelectorAll('.nap-row')].find((el) => el.getAttribute('data-id') === id);
  if (!row || row.getAttribute('data-waking') === 'active') return;
  for (const btn of row.querySelectorAll('button')) btn.disabled = pending;
}

function napWakeNow(id) {
  napSetRowPending(id, true);
  return napSend({ action: 'wakeSnoozed', id }).then((response) => {
    napSetRowPending(id, false);
    if (!response.success && (response.waking === 'active' || response.notFound)) {
      // Already waking, or woken or discarded meanwhile: the list shows it.
    } else if (!response.success) {
      napShowStatus(response.error || 'Couldn\'t wake these tabs', 'error');
    } else if (response.failedCount > 0) {
      napShowStatus(`Reopened ${napPlural(response.createdCount || 0, 'tab')} — ${response.failedCount} could not be reopened`, 'error');
    } else {
      napShowStatus(`Reopened ${napPlural(response.createdCount || 0, 'tab')}`);
    }
    napLoadAndRender();
  });
}

// Discarding drops the snoozed tabs for good, so it is undoable for a few
// seconds instead of asking for confirmation (same as the popup).
const NAP_UNDO_MS = 10000;
let napPendingDiscard = null; // { record, timer }

function napDiscard(id) {
  return napSend({ action: 'cancelSnoozed', id }).then((response) => {
    napLoadAndRender();
    // A plain { success: false } means it was already gone; say nothing.
    if (response.error) {
      napShowStatus(`Couldn't discard: ${response.error}`, 'error');
      return;
    }
    if (response.success && response.interrupted && !response.record) {
      // A wake that didn't finish, but every tab had reopened: nothing to undo.
      napShowStatus('Its tabs had all reopened — nothing left to discard');
      return;
    }
    if (!response.success || !response.record) return;
    napShowDiscardNotice(response.record, { interrupted: !!response.interrupted });
  });
}

function napShowDiscardNotice(record, { interrupted = false } = {}) {
  const notice = document.getElementById('discardNotice');
  const text = document.getElementById('discardNoticeText');
  if (!notice || !text) return;
  if (napPendingDiscard) clearTimeout(napPendingDiscard.timer);
  napPendingDiscard = { record, timer: setTimeout(napHideDiscardNotice, NAP_UNDO_MS) };
  // A wake that didn't finish drops only the tabs that hadn't reopened.
  text.textContent = interrupted
    ? `Discarded ${napPlural((record.tabs || []).length, 'tab')} that hadn't reopened.`
    : `Discarded ${record.summary}.`;
  notice.hidden = false;
}

function napHideDiscardNotice() {
  if (napPendingDiscard) clearTimeout(napPendingDiscard.timer);
  napPendingDiscard = null;
  const notice = document.getElementById('discardNotice');
  if (notice) notice.hidden = true;
}

// The notice (and its record) stays until the background confirms the record
// is back, so a failed Undo can be tried again instead of losing the tabs.
function napUndoDiscard() {
  if (!napPendingDiscard || napPendingDiscard.undoing) return;
  const current = napPendingDiscard;
  current.undoing = true;
  return napSend({ action: 'restoreSnoozed', record: current.record }).then((response) => {
    current.undoing = false;
    napLoadAndRender();
    // { success: false } without an error: the record is already there.
    if (response.error) {
      napShowStatus(`Couldn't undo: ${response.error}`, 'error');
      return;
    }
    if (napPendingDiscard === current) napHideDiscardNotice();
  });
}

// Wake every currently-listed record, one at a time, saying how far it got
// and what could not be reopened.
async function napWakeAll() {
  if (napWakingAll) return;
  napWakingAll = true;
  const wakeAllBtn = document.getElementById('wakeAll');
  if (wakeAllBtn) wakeAllBtn.disabled = true;
  try {
    const response = await napSend({ action: 'listSnoozed' });
    if (!response.success) {
      napShowStatus(`Couldn't wake: ${response.error || 'could not read the sleeping tabs'}`, 'error');
      return;
    }
    const items = response.items || [];
    let reopened = 0;
    let failedTabs = 0;
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      napShowStatus(`Waking ${i + 1} of ${items.length}…`);
      const reply = await napSend({ action: 'wakeSnoozed', id: items[i].id });
      reopened += reply.createdCount || 0;
      failedTabs += reply.failedCount || 0;
      // Not found: it woke on its own (or elsewhere) meanwhile. Active: it is
      // waking already.
      if (!reply.success && !reply.failedCount && !reply.notFound && reply.waking !== 'active'
        && reply.error !== 'Snooze not found') {
        errors.push(reply.error || 'couldn\'t wake');
      }
    }
    const done = `Reopened ${napPlural(reopened, 'tab')}`;
    if (failedTabs > 0 || errors.length > 0) {
      const parts = [done];
      if (failedTabs > 0) parts.push(`${failedTabs} could not be reopened`);
      if (errors.length > 0) parts.push(errors[0]);
      napShowStatus(parts.join(' — '), 'error');
    } else {
      napShowStatus(done);
    }
  } finally {
    napWakingAll = false;
    // Re-enable now; the re-render below disables it again if nothing is left.
    if (wakeAllBtn) wakeAllBtn.disabled = false;
    napLoadAndRender();
  }
}

// A tab left in the background (or a laptop asleep) may miss the midnight
// timer; catch up when the page is looked at again.
function napHandleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    napLoadAndRender({ force: true });
    napScheduleMidnightRefresh();
  }
}

// Live refresh when the sleeping list changes in storage (an alarm fired, a
// wake saved its progress, the popup discarded one).
function napHandleStorageChange(changes, area) {
  if (area === 'local' && changes && changes.snoozedItems) {
    napLoadAndRender();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  napLoadAndRender();
  napScheduleMidnightRefresh();

  document.addEventListener('visibilitychange', napHandleVisibilityChange);

  const daysEl = document.getElementById('napDays');
  if (daysEl) {
    daysEl.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const row = btn.closest('.nap-row');
      if (!row) return;
      const id = row.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (action === 'wake') napWakeNow(id);
      else if (action === 'discard') napDiscard(id);
    });
  }

  const wakeAllBtn = document.getElementById('wakeAll');
  if (wakeAllBtn) wakeAllBtn.addEventListener('click', () => napWakeAll());

  const undoBtn = document.getElementById('discardUndo');
  if (undoBtn) undoBtn.addEventListener('click', () => napUndoDiscard());

  const settingsBtn = document.getElementById('openSettings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(napHandleStorageChange);
  }
});
