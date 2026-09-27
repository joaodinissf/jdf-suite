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

// Compute the day-section header info for a wakeAt timestamp: a bucket key
// to group rows by calendar day, a short label ("Today" / "Tomorrow" /
// weekday name), and a subtitle with the full date.
function napDayInfo(wakeAt, now = Date.now()) {
  const wake = new Date(wakeAt);
  const nowDate = new Date(now);
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
function napNextWakeSummary(items, now = Date.now()) {
  if (!items || items.length === 0) return null;
  const next = items[0]; // `items` is expected sorted ascending by wakeAt
  const { label } = napDayInfo(next.wakeAt, now);
  const when = label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label;
  return `next wakes ${when} at ${napFormatClock(next.wakeAt)}`;
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
  when.appendChild(document.createTextNode(napFormatClock(record.wakeAt)));
  row.appendChild(when);

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
  actions.appendChild(wakeBtn);
  actions.appendChild(discardBtn);
  row.appendChild(actions);

  return row;
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

function napRenderAll(items) {
  const daysEl = document.getElementById('napDays');
  const emptyEl = document.getElementById('napEmpty');
  const summaryEl = document.getElementById('napSummary');
  const wakeAllBtn = document.getElementById('wakeAll');
  if (!daysEl) return;

  daysEl.innerHTML = '';

  if (!items || items.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    if (summaryEl) summaryEl.textContent = 'Nothing sleeping right now';
    if (wakeAllBtn) wakeAllBtn.disabled = true;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (wakeAllBtn) wakeAllBtn.disabled = false;

  const totalTabs = items.reduce((sum, r) => sum + (r.tabs ? r.tabs.length : 1), 0);
  if (summaryEl) {
    const tabWord = totalTabs === 1 ? 'tab' : 'tabs';
    summaryEl.textContent = `${totalTabs} ${tabWord} sleeping · ${napNextWakeSummary(items)}`;
  }

  const sections = napGroupByDay(items);
  for (const section of sections) {
    daysEl.appendChild(napBuildDaySection(section));
  }
}

function napLoadAndRender() {
  chrome.runtime.sendMessage({ action: 'listSnoozed' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) return;
    napRenderAll(response.items || []);
  });
}

function napWakeNow(id) {
  chrome.runtime.sendMessage({ action: 'wakeSnoozed', id }, () => {
    napLoadAndRender();
  });
}

// Discarding drops the snoozed tabs for good, so it is undoable for a few
// seconds instead of asking for confirmation (same as the popup).
const NAP_UNDO_MS = 10000;
let napPendingDiscard = null; // { record, timer }

function napDiscard(id) {
  chrome.runtime.sendMessage({ action: 'cancelSnoozed', id }, (response) => {
    napLoadAndRender();
    if (chrome.runtime.lastError || !response || !response.success || !response.record) return;
    napShowDiscardNotice(response.record);
  });
}

function napShowDiscardNotice(record) {
  const notice = document.getElementById('discardNotice');
  const text = document.getElementById('discardNoticeText');
  if (!notice || !text) return;
  if (napPendingDiscard) clearTimeout(napPendingDiscard.timer);
  napPendingDiscard = { record, timer: setTimeout(napHideDiscardNotice, NAP_UNDO_MS) };
  text.textContent = `Discarded ${record.summary}.`;
  notice.hidden = false;
}

function napHideDiscardNotice() {
  if (napPendingDiscard) clearTimeout(napPendingDiscard.timer);
  napPendingDiscard = null;
  const notice = document.getElementById('discardNotice');
  if (notice) notice.hidden = true;
}

function napUndoDiscard() {
  if (!napPendingDiscard) return;
  const { record } = napPendingDiscard;
  napHideDiscardNotice();
  chrome.runtime.sendMessage({ action: 'restoreSnoozed', record }, () => {
    napLoadAndRender();
  });
}

// Wake every currently-listed record, one at a time.
async function napWakeAll() {
  const wakeAllBtn = document.getElementById('wakeAll');
  if (wakeAllBtn) wakeAllBtn.disabled = true;
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'listSnoozed' }, resolve);
  });
  const items = (response && response.success && response.items) || [];
  for (const item of items) {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'wakeSnoozed', id: item.id }, resolve);
    });
  }
  napLoadAndRender();
}

document.addEventListener('DOMContentLoaded', () => {
  napLoadAndRender();

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
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes && changes.snoozedItems) {
        napLoadAndRender();
      }
    });
  }
});
