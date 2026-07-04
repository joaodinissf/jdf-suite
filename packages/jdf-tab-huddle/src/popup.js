document.addEventListener('DOMContentLoaded', function () {
  // Initialize tab switching
  initTabSwitching();
  
  // Load saved preferences
  loadUserPreferences();
  
  // Setup event listeners for both modes
  setupEventListeners();

  // Update UI based on number of windows
  updateUIForWindowCount();

  // Update AI button visibility (show cog if key is set)
  updateAiButtonState();

  // Initialize the Tab Snoozing UI (picker, presets, sleeping list)
  initSnoozeUi();

  // Wire up single-key keyboard shortcuts and render their hints
  initKeyboardShortcuts();

  // Update status bar
  updateStatusBar();

  // Wire up the Settings link to open the options page
  const settingsLink = document.getElementById('openOptions');
  if (settingsLink) {
    settingsLink.addEventListener('click', (event) => {
      event.preventDefault();
      if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
  }
});

// Tab switching functionality
function initTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;
      
      // Update button states
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update content visibility
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === targetTab + '-content') {
          content.classList.add('active');
        }
      });
      
      // Save preference
      saveUserPreference('selectedMode', targetTab);

      // The visible button set changed — recompute hotkeys.
      refreshHotkeys();
    });
  });
}

// Load user preferences
function loadUserPreferences() {
  chrome.storage.local.get(['selectedMode'], (result) => {
    const savedMode = result.selectedMode || 'groups'; // Default to groups mode
    
    // Update UI to show saved mode
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === savedMode) {
        btn.classList.add('active');
      }
    });
    
    tabContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === savedMode + '-content') {
        content.classList.add('active');
      }
    });

    // The visible panel may have changed — recompute hotkeys.
    refreshHotkeys();
  });
}

// Save user preference
function saveUserPreference(key, value) {
  chrome.storage.local.set({ [key]: value });
}

// Get current mode
function getCurrentMode() {
  const activeTab = document.querySelector('.tab-button.active');
  return activeTab ? activeTab.dataset.tab : 'groups';
}

// Setup event listeners for both modes
function setupEventListeners() {
  // Groups mode listeners
  document.getElementById('sortAllWindows-groups').addEventListener('click', () => sortAllWindows(true));
  document.getElementById('sortCurrentWindow-groups').addEventListener('click', () => sortCurrentWindow(true));
  document.getElementById('removeDuplicatesWindow-groups').addEventListener('click', () => removeDuplicatesWindow(true));
  document.getElementById('removeDuplicatesAllWindows-groups').addEventListener('click', () => removeDuplicatesAllWindows(true));
  document.getElementById('removeDuplicatesGlobally-groups').addEventListener('click', () => removeDuplicatesGlobally(true));
  document.getElementById('extractDomain-groups').addEventListener('click', () => extractDomain(true));
  document.getElementById('extractAllDomains-groups').addEventListener('click', () => extractAllDomains(true));
  document.getElementById('moveAllToSingleWindow-groups').addEventListener('click', () => moveAllToSingleWindow(true));
  document.getElementById('copyAllTabs-groups').addEventListener('click', () => copyAllTabs(true));
  document.getElementById('flattenWindow-groups').addEventListener('click', () => flattenWindow());

  // Individual mode listeners
  document.getElementById('sortAllWindows-individual').addEventListener('click', () => sortAllWindows(false));
  document.getElementById('sortCurrentWindow-individual').addEventListener('click', () => sortCurrentWindow(false));
  document.getElementById('removeDuplicatesWindow-individual').addEventListener('click', () => removeDuplicatesWindow(false));
  document.getElementById('removeDuplicatesAllWindows-individual').addEventListener('click', () => removeDuplicatesAllWindows(false));
  document.getElementById('removeDuplicatesGlobally-individual').addEventListener('click', () => removeDuplicatesGlobally(false));
  document.getElementById('extractDomain-individual').addEventListener('click', () => extractDomain(false));
  document.getElementById('extractAllDomains-individual').addEventListener('click', () => extractAllDomains(false));
  document.getElementById('moveAllToSingleWindow-individual').addEventListener('click', () => moveAllToSingleWindow(false));
  document.getElementById('copyAllTabs-individual').addEventListener('click', () => copyAllTabs(false));

  // AI listeners (both modes)
  document.getElementById('aiOrganize-groups').addEventListener('click', () => aiOrganize(true));
  document.getElementById('aiOrganize-individual').addEventListener('click', () => aiOrganize(false));
  document.getElementById('aiSettings-groups').addEventListener('click', () => openAiSettings());
  document.getElementById('aiSettings-individual').addEventListener('click', () => openAiSettings());
}

// Simple logging helper
function log(message, ...args) {
  console.log('[Tab Organizer]', message, ...args);
  chrome.runtime.sendMessage({ type: 'log', data: { message, args } }).catch(() => { });
}

// Generic function to send actions to the background script
function sendAction(action, data = {}) {
  const message = { action, ...data };
  chrome.runtime.sendMessage(message, function (response) {
    if (chrome.runtime.lastError) {
      log(`Error from background for action "${action}":`, chrome.runtime.lastError.message);
    } else if (response && !response.success) {
      log(`Background failed for action "${action}":`, response.error);
    } else if (response && response.cancelled) {
      log(`Action "${action}" was cancelled by the user.`);
    }
  });
}

// Sort tabs by URL across all windows
function sortAllWindows(respectGroups = true) {
  sendAction('sortAllWindows', { respectGroups });
}

// Sort tabs by URL in current window
function sortCurrentWindow(respectGroups = true) {
  sendAction('sortCurrentWindow', { respectGroups });
}

// Extract tabs from current domain into a new window
function extractDomain(respectGroups = true) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found for extractDomain');
      return;
    }
    const activeTab = activeTabs[0];
    sendAction('extractDomain', {
      tabId: activeTab.id,
      url: activeTab.url,
      respectGroups
    });
  });
}

// Remove duplicates within current window only
function removeDuplicatesWindow(respectGroups = true) {
  sendAction('removeDuplicatesWindow', { respectGroups });
}

// Remove duplicates within each window separately
function removeDuplicatesAllWindows(respectGroups = true) {
  sendAction('removeDuplicatesAllWindows', { respectGroups });
}

// Remove duplicates across all windows globally
function removeDuplicatesGlobally(respectGroups = true) {
  sendAction('removeDuplicatesGlobally', { respectGroups });
}

// Extract all domains into separate windows
function extractAllDomains(respectGroups = true) {
  sendAction('extractAllDomains', { respectGroups });
}

// Ungroup all tabs in the current window
function flattenWindow() {
  sendAction('flattenWindow');
}

// Move all tabs to a single window
function moveAllToSingleWindow(respectGroups = true) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found for moveAllToSingleWindow');
      return;
    }
    const activeTab = activeTabs[0];
    sendAction('moveAllToSingleWindow', {
      activeTabId: activeTab.id,
      respectGroups
    });
  });
}

// Copy all tab URLs to clipboard
function copyAllTabs(respectGroups = true) {
  const mode = respectGroups ? 'groups' : 'individual';
  chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error copying tabs:', chrome.runtime.lastError.message);
      return;
    }
    if (response && response.success && response.text) {
      navigator.clipboard.writeText(response.text).then(() => {
        const feedback = document.getElementById('copyFeedback-' + mode);
        if (feedback) {
          feedback.classList.add('visible');
          setTimeout(() => feedback.classList.remove('visible'), 1500);
        }
      }).catch(err => {
        log('Clipboard write failed:', err);
      });
    }
  });
}

// Update UI based on number of windows
function updateUIForWindowCount() {
  chrome.windows.getAll({ populate: false }, function (windows) {
    if (windows.length === 1) {
      document.querySelectorAll('.multi-window-section').forEach(section => {
        section.style.display = 'none';
      });
      // Multi-window buttons are now hidden — recompute hotkeys.
      refreshHotkeys();
    }
  });
}

// AI Organize
function aiOrganize(respectGroups = true) {
  sendAction('aiGroupTabs', { respectGroups });
}

function openAiSettings() {
  sendAction('openAiSettings');
}

// Show/hide the AI settings cog based on whether a key is configured
function updateAiButtonState() {
  chrome.runtime.sendMessage({ action: 'loadAiConfig' }, function (response) {
    if (chrome.runtime.lastError || !response) return;

    const hasKey = response.config && response.config.key;
    const cogs = document.querySelectorAll('.ai-cog-btn');
    cogs.forEach(cog => {
      cog.style.display = hasKey ? 'block' : 'none';
    });
    // The AI settings cog visibility changed — recompute hotkeys.
    refreshHotkeys();
  });
}

// ============================================================
// Tab Snoozing — Popup UI
// ============================================================

// Pending unit while the picker is open: 'tab' | 'selected' | 'window' | 'group'
let pendingSnoozeUnit = null;
// Preset metadata from the background: [{ key, label, wakeAt }]
let snoozePresetData = [];

const SNOOZE_UNIT_TO_ACTION = {
  tab: 'snoozeTab',
  selected: 'snoozeSelected',
  window: 'snoozeWindow',
  group: 'snoozeGroup',
};
const SNOOZE_UNIT_TO_BUTTON_ID = {
  tab: 'snoozeTab',
  selected: 'snoozeSelected',
  window: 'snoozeWindow',
  group: 'snoozeGroup',
};
const SNOOZE_PRESET_KEYS = ['laterToday', 'tonight', 'tomorrow', 'weekend', 'nextWeek'];

// Format an epoch ms as a zero-padded local 24h clock ("18:00").
function formatSnoozeClock(wakeAt) {
  const d = new Date(wakeAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Format an epoch ms as a value for <input type="datetime-local"> (local time).
function toLocalDatetimeValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initSnoozeUi() {
  const tabBtn = document.getElementById('snoozeTab');
  if (!tabBtn) return; // snooze UI not present in this DOM

  // Unit buttons open the picker for their unit.
  document.getElementById('snoozeTab').addEventListener('click', () => openSnoozePicker('tab'));
  document.getElementById('snoozeSelected').addEventListener('click', () => openSnoozePicker('selected'));
  document.getElementById('snoozeWindow').addEventListener('click', () => openSnoozePicker('window'));
  document.getElementById('snoozeGroup').addEventListener('click', () => openSnoozePicker('group'));

  // Picker controls.
  document.getElementById('snoozePickerCancel').addEventListener('click', () => closeSnoozePicker());
  document.getElementById('snoozeCustomConfirm').addEventListener('click', () => submitCustomSnooze());

  // Preset buttons.
  for (const key of SNOOZE_PRESET_KEYS) {
    const btn = document.getElementById('snoozePreset-' + key);
    if (btn) {
      btn.addEventListener('click', () => {
        const data = snoozePresetData.find((d) => d.key === key);
        if (data) submitSnooze(data.wakeAt, key);
      });
    }
  }

  // Constrain the custom input to at least one minute in the future.
  const customInput = document.getElementById('snoozeCustomTime');
  if (customInput) customInput.min = toLocalDatetimeValue(Date.now() + 60000);

  // Fetch preset times/labels (single source of truth in the background).
  chrome.runtime.sendMessage({ action: 'getSnoozePresets' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) return;
    snoozePresetData = response.presets || [];
    labelSnoozePresetButtons();
  });

  // Delegated wake/cancel clicks on the sleeping list.
  const list = document.getElementById('snoozedList');
  if (list) {
    list.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const li = btn.closest('.snoozed-item');
      if (!li) return;
      const id = li.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (action === 'wake') wakeNow(id);
      else if (action === 'cancel') cancelSnooze(id);
    });
  }

  // Live-refresh the list when an alarm fires (or any snooze mutation happens).
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes && changes.snoozedItems) {
        renderSnoozedList();
      }
    });
  }

  updateSnoozeButtonState();
  renderSnoozedList();
}

function labelSnoozePresetButtons() {
  for (const p of snoozePresetData) {
    const btn = document.getElementById('snoozePreset-' + p.key);
    if (btn) btn.textContent = `${p.label} · ${formatSnoozeClock(p.wakeAt)}`;
  }
}

// Disable the Group button when the active tab is not in a group.
function updateSnoozeButtonState() {
  const grpBtn = document.getElementById('snoozeGroup');
  if (!grpBtn) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || tabs.length === 0) return;
    const activeTab = tabs[0];
    const inGroup = activeTab.groupId !== undefined && activeTab.groupId !== -1;
    grpBtn.disabled = !inGroup;
    grpBtn.title = inGroup
      ? 'Snooze the active tab\'s group'
      : 'Snooze the active tab\'s group (active tab is not in a group)';
    // The Group button's enabled state changed — recompute hotkeys.
    refreshHotkeys();
  });
}

function markSelectedUnitButton(unit) {
  for (const [u, id] of Object.entries(SNOOZE_UNIT_TO_BUTTON_ID)) {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('selected', u === unit);
  }
}

function openSnoozePicker(unit) {
  const panel = document.getElementById('snoozePickerPanel');
  if (!panel) return;
  // Clicking the already-selected unit again toggles the picker closed.
  if (pendingSnoozeUnit === unit && !panel.hidden) {
    closeSnoozePicker();
    return;
  }
  pendingSnoozeUnit = unit;
  markSelectedUnitButton(unit);
  clearSnoozeFeedback();
  panel.hidden = false;
  // Picker is now the active (modal) hotkey set.
  refreshHotkeys();
}

function closeSnoozePicker() {
  const panel = document.getElementById('snoozePickerPanel');
  if (panel) panel.hidden = true;
  pendingSnoozeUnit = null;
  markSelectedUnitButton(null);
  // Back to the main hotkey set.
  refreshHotkeys();
}

function showSnoozeFeedback(text) {
  const el = document.getElementById('snoozeFeedback');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
}

function clearSnoozeFeedback() {
  const el = document.getElementById('snoozeFeedback');
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// Send the snooze message for the pending unit and surface the result.
function submitSnooze(wakeAt, preset) {
  const unit = pendingSnoozeUnit;
  if (!unit) return;
  const action = SNOOZE_UNIT_TO_ACTION[unit];
  chrome.runtime.sendMessage({ action, wakeAt, preset }, (response) => {
    if (chrome.runtime.lastError) {
      showSnoozeFeedback('Could not snooze');
      return;
    }
    if (response && response.success) {
      showSnoozeFeedback('Snoozed until ' + formatWakeTime(response.record.wakeAt));
      closeSnoozePicker();
      renderSnoozedList();
    } else {
      showSnoozeFeedback((response && response.error) || 'Could not snooze');
    }
  });
}

// Validate the custom datetime (parseable, >= now + 1 min) before submitting.
function submitCustomSnooze() {
  const input = document.getElementById('snoozeCustomTime');
  if (!input) return;
  const value = input.value;
  const parsed = value ? Date.parse(value) : NaN;
  const now = Date.now();
  if (!value || Number.isNaN(parsed) || parsed < now + 60000) {
    showSnoozeFeedback('Pick a time in the future');
    return;
  }
  submitSnooze(parsed, 'custom');
}

// Rebuild the sleeping list from storage; toggle section visibility and count.
function renderSnoozedList() {
  const list = document.getElementById('snoozedList');
  if (!list) return;
  const section = document.getElementById('sleepingSection');
  const countEl = document.getElementById('sleepingCount');
  chrome.runtime.sendMessage({ action: 'listSnoozed' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) return;
    const items = response.items || [];
    list.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'snoozed-item';
      li.setAttribute('data-id', item.id);

      const summary = document.createElement('span');
      summary.className = 'snoozed-summary';
      summary.textContent = item.summary;
      summary.title = item.summary;

      const time = document.createElement('span');
      time.className = 'snoozed-time';
      time.textContent = formatWakeTime(item.wakeAt);

      const wakeBtn = document.createElement('button');
      wakeBtn.className = 'snoozed-wake';
      wakeBtn.setAttribute('data-action', 'wake');
      wakeBtn.textContent = 'Wake now';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'snoozed-cancel';
      cancelBtn.setAttribute('data-action', 'cancel');
      cancelBtn.textContent = 'Cancel';

      li.appendChild(summary);
      li.appendChild(time);
      li.appendChild(wakeBtn);
      li.appendChild(cancelBtn);
      list.appendChild(li);
    }
    if (countEl) countEl.textContent = String(items.length);
    if (section) section.hidden = items.length === 0;
    // The sleeping list (and its Wake/Cancel buttons) was rebuilt — recompute hotkeys.
    refreshHotkeys();
  });
}

function wakeNow(id) {
  chrome.runtime.sendMessage({ action: 'wakeSnoozed', id }, () => {
    renderSnoozedList();
  });
}

function cancelSnooze(id) {
  chrome.runtime.sendMessage({ action: 'cancelSnoozed', id }, () => {
    renderSnoozedList();
  });
}

// Human-friendly wake time: "Today 18:00", "Tomorrow 09:00", "Sat 09:00",
// "12 Jul, 09:00". Clock is local 24h; weekday/month via Intl (default locale).
function formatWakeTime(wakeAt, now = Date.now()) {
  const wake = new Date(wakeAt);
  const nowDate = new Date(now);
  const clock = formatSnoozeClock(wakeAt);

  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const startOfWakeDay = new Date(wake.getFullYear(), wake.getMonth(), wake.getDate()).getTime();
  const dayDiff = Math.round((startOfWakeDay - startOfToday) / 86400000);

  if (dayDiff === 0) return `Today ${clock}`;
  if (dayDiff === 1) return `Tomorrow ${clock}`;
  if (dayDiff >= 2 && dayDiff <= 6) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(wake);
    return `${weekday} ${clock}`;
  }
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(wake);
  return `${wake.getDate()} ${month}, ${clock}`;
}

// ============================================================
// Keyboard Shortcuts — single-key hotkeys for visible controls
// ============================================================
//
// Every actionable, VISIBLE, ENABLED button in the current popup state is
// assigned a unique single letter. A small key-badge is rendered on each
// button so the binding is discoverable, and a document-level keydown listener
// maps the pressed key to its button and clicks it. The map is recomputed
// whenever the visible state changes (mode switch, picker open/close, list
// re-render, button enable/disable), so hidden panels and disabled buttons are
// never bound.

// Preferred mnemonic letters per control, resolved greedily (first free wins).
// Keys are matched via hotkeyPreferenceKey(): mode tabs by "tab:<mode>",
// action buttons by their id with the -groups/-individual suffix stripped,
// and sleeping-list buttons by "row:<action>".
const HOTKEY_PREFERENCES = {
  // Mode-switch tabs
  'tab:groups': ['g'],
  'tab:individual': ['i'],
  // "This Window"
  sortCurrentWindow: ['s'],
  removeDuplicatesWindow: ['d'],
  flattenWindow: ['f'],
  aiOrganize: ['o'],
  aiSettings: ['k', 'h'],
  // "All Windows"
  sortAllWindows: ['a'],
  removeDuplicatesAllWindows: ['u'],
  removeDuplicatesGlobally: ['b'],
  moveAllToSingleWindow: ['m'],
  // "Extract"
  extractDomain: ['n'],
  extractAllDomains: ['l'],
  // "Copy"
  copyAllTabs: ['c'],
  // Snooze unit buttons
  snoozeTab: ['t'],
  snoozeSelected: ['e'],
  snoozeWindow: ['w'],
  snoozeGroup: ['r'],
  // Snooze picker (modal set while the panel is open)
  'snoozePreset-laterToday': ['l'],
  'snoozePreset-tonight': ['t'],
  'snoozePreset-tomorrow': ['m'],
  'snoozePreset-weekend': ['w'],
  'snoozePreset-nextWeek': ['n'],
  snoozeCustomConfirm: ['s'],
  snoozePickerCancel: ['c'],
};

const HOTKEY_FALLBACK_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

// The current key -> button element map for the visible state.
let activeHotkeys = new Map();

// True when the pressed target should be allowed to type (never hijack keys
// from text inputs, textareas, selects, contenteditable, or the datetime-local
// custom-time field).
function isTextInputTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// Layout-free visibility test: walk ancestors and reject if any is hidden via
// the [hidden] attribute, inline display/visibility, or an inactive
// .tab-content panel. This mirrors every way the popup hides controls and works
// identically in the browser and in jsdom (which has no layout engine).
function isHotkeyVisible(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.hidden) return false;
    const style = node.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    if (node.classList && node.classList.contains('tab-content') && !node.classList.contains('active')) {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

// The lookup key into HOTKEY_PREFERENCES for a given element.
function hotkeyPreferenceKey(el) {
  if (el.classList && el.classList.contains('tab-button')) return 'tab:' + el.dataset.tab;
  if (el.id) return el.id.replace(/-(groups|individual)$/, '');
  const action = el.getAttribute && el.getAttribute('data-action');
  if (action) return 'row:' + action;
  return '';
}

// Collect the actionable buttons for the CURRENT visible state, in priority
// order. When the snooze picker is open it is modal: only its buttons bind.
function collectHotkeyTargets() {
  const panel = document.getElementById('snoozePickerPanel');
  const pickerOpen = panel && !panel.hidden && isHotkeyVisible(panel);

  if (pickerOpen) {
    const pickerIds = [
      'snoozePreset-laterToday', 'snoozePreset-tonight', 'snoozePreset-tomorrow',
      'snoozePreset-weekend', 'snoozePreset-nextWeek',
      'snoozeCustomConfirm', 'snoozePickerCancel',
    ];
    return pickerIds
      .map((id) => document.getElementById(id))
      .filter((el) => el && !el.disabled && isHotkeyVisible(el));
  }

  const targets = [];
  // 1. Mode-switch tabs.
  document.querySelectorAll('.tab-nav .tab-button').forEach((b) => targets.push(b));
  // 2. Buttons of the active mode panel only (never the hidden one).
  const activePanel = document.querySelector('.tab-content.active');
  if (activePanel) activePanel.querySelectorAll('button').forEach((b) => targets.push(b));
  // 3. Snooze unit buttons.
  ['snoozeTab', 'snoozeSelected', 'snoozeWindow', 'snoozeGroup'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) targets.push(b);
  });
  // 4. Sleeping-list Wake/Cancel actions (assigned last; may run out of letters).
  document.querySelectorAll('#snoozedList .snoozed-item button[data-action]').forEach((b) => targets.push(b));

  return targets.filter((el) => !el.disabled && isHotkeyVisible(el));
}

// Build a fresh { letter -> element } map for the current visible state.
function buildHotkeyMap() {
  const targets = collectHotkeyTargets();
  const map = new Map();
  const used = new Set();

  for (const el of targets) {
    let chosen = null;
    const prefs = HOTKEY_PREFERENCES[hotkeyPreferenceKey(el)] || [];
    for (const c of prefs) {
      if (!used.has(c)) { chosen = c; break; }
    }
    if (!chosen) {
      // Fall back to the first free letter in the button's own label...
      const label = (el.textContent || '').toLowerCase();
      for (const c of label) {
        if (c >= 'a' && c <= 'z' && !used.has(c)) { chosen = c; break; }
      }
    }
    if (!chosen) {
      // ...then to any remaining letter of the alphabet.
      for (const c of HOTKEY_FALLBACK_LETTERS) {
        if (!used.has(c)) { chosen = c; break; }
      }
    }
    if (chosen) {
      used.add(chosen);
      map.set(chosen, el);
    }
  }
  return map;
}

// Draw a small key-badge on each mapped button.
function renderHotkeyHints(map) {
  for (const [key, el] of map) {
    const badge = document.createElement('span');
    badge.className = 'hotkey-hint';
    badge.textContent = key.toUpperCase();
    badge.setAttribute('aria-hidden', 'true');
    el.appendChild(badge);
  }
}

// Recompute the active hotkey map and redraw the hints. Idempotent: existing
// badges are cleared first so button labels stay clean for letter fallback.
function refreshHotkeys() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  document.querySelectorAll('.hotkey-hint').forEach((s) => s.remove());
  activeHotkeys = buildHotkeyMap();
  renderHotkeyHints(activeHotkeys);
}

// Document-level key handler: click the button bound to the pressed key.
function handleHotkeyKeydown(event) {
  if (event.defaultPrevented) return;
  // Leave shortcuts with modifiers to Chrome / the OS / the global command.
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const panel = document.getElementById('snoozePickerPanel');
  const pickerOpen = panel && !panel.hidden && isHotkeyVisible(panel);

  // Escape closes the picker if it is open (even from within the time field).
  if (event.key === 'Escape') {
    if (pickerOpen) {
      event.preventDefault();
      closeSnoozePicker();
    }
    return;
  }

  // Never hijack keys while the user is typing.
  if (isTextInputTarget(event.target)) return;

  const key = event.key && event.key.length === 1 ? event.key.toLowerCase() : '';
  if (!key) return;

  const el = activeHotkeys.get(key);
  if (el) {
    event.preventDefault();
    el.click();
  }
}

// Register the listener and compute the initial map.
function initKeyboardShortcuts() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  document.addEventListener('keydown', handleHotkeyKeydown);
  refreshHotkeys();
}

// Update status bar with tab/window/group counts
function updateStatusBar() {
  chrome.tabs.query({ currentWindow: true }, function (currentTabs) {
    chrome.windows.getAll({ populate: true }, function (windows) {
      chrome.tabGroups.query({}, function (allGroups) {
        // This window
        const currentWindowId = currentTabs[0]?.windowId;
        const thisWindowTabs = currentTabs.length;
        const thisWindowGroups = allGroups.filter(g => g.windowId === currentWindowId).length;
        const thisParts = [thisWindowTabs + (thisWindowTabs === 1 ? ' tab' : ' tabs')];
        if (thisWindowGroups > 0) {
          thisParts.push(thisWindowGroups + (thisWindowGroups === 1 ? ' group' : ' groups'));
        }
        const thisEl = document.getElementById('statusThisWindow');
        if (thisEl) thisEl.textContent = thisParts.join(' \u00b7 ');

        // All windows
        const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);
        const totalWindows = windows.length;
        const totalGroups = allGroups.length;
        const allParts = [
          totalTabs + (totalTabs === 1 ? ' tab' : ' tabs'),
          totalWindows + (totalWindows === 1 ? ' window' : ' windows')
        ];
        if (totalGroups > 0) {
          allParts.push(totalGroups + (totalGroups === 1 ? ' group' : ' groups'));
        }
        const allEl = document.getElementById('statusAllWindows');
        if (allEl) allEl.textContent = allParts.join(' \u00b7 ');
      });
    });
  });
}
