// Chrome's tab group colours and their accessible names, for the colour
// picker. The swatches themselves come from huddle-theme.css (data-group).
const COLOR_MAP = {
  grey:   'Grey',
  blue:   'Blue',
  red:    'Red',
  yellow: 'Yellow',
  green:  'Green',
  pink:   'Pink',
  purple: 'Purple',
  cyan:   'Cyan',
  orange: 'Orange',
};

const CHECK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">'
  + '<path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function tabCountLabel(n) {
  return n + (n === 1 ? ' tab' : ' tabs');
}

let proposal = null; // { groups, ungroupedTabIds, tabs, windowId }
let tabMap = {};      // id → tab metadata

// Groups (true) or Flat (false), as chosen in the popup.
const respectGroups = new URLSearchParams(window.location.search).get('respectGroups') !== 'false';

// Why a sendMessage reply was not a success, as a short phrase.
function replyFailure(response) {
  if (chrome.runtime.lastError) return chrome.runtime.lastError.message;
  return (response && response.error) || 'no reply from Huddle';
}

function buildButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function buildFormActions(...buttons) {
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  actions.append(...buttons);
  return actions;
}

// Starts a fresh organize run (it opens its own proposal tab), then closes
// this one. If the run cannot start, the reason is shown here instead.
function runAgain() {
  chrome.runtime.sendMessage({ action: 'aiGroupTabs', respectGroups }, (response) => {
    if (!chrome.runtime.lastError && response && response.success) {
      window.close();
      return;
    }
    showError(`Couldn't start a new run: ${replyFailure(response)}`);
  });
}

function openAiSettings() {
  chrome.runtime.sendMessage({ action: 'openAiSettings' });
}

// The error text can come from the network, so it is set as text, never HTML.
function showError(msg) {
  const content = document.getElementById('content');
  document.getElementById('actionsContainer').style.display = 'none';
  const el = document.createElement('div');
  el.className = 'error-msg';
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  content.replaceChildren(el, buildFormActions(
    buildButton('Retry', 'btn primary confirm', runAgain),
    buildButton('Open AI settings', 'btn', openAiSettings),
  ));
}

// No run is waiting for this page: it was refreshed, opened on its own, or
// Chrome stopped Huddle's background worker while the page sat idle.
function showRunEnded() {
  const content = document.getElementById('content');
  document.getElementById('actionsContainer').style.display = 'none';
  const el = document.createElement('div');
  el.className = 'ended-msg';
  el.setAttribute('role', 'status');
  const heading = document.createElement('p');
  heading.className = 'ended-title';
  heading.textContent = 'This run has ended';
  const detail = document.createElement('p');
  detail.textContent = 'Huddle is no longer working on this page. Run it again to get a fresh proposal.';
  el.append(heading, detail);
  content.replaceChildren(el, buildFormActions(
    buildButton('Run again', 'btn primary confirm', runAgain),
  ));
}

// Shown above the proposal so it can be adjusted and applied again.
function showApplyError(msg) {
  let el = document.getElementById('applyError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'applyError';
    el.className = 'error-msg apply-error';
    el.setAttribute('role', 'alert');
    const content = document.getElementById('content');
    content.parentNode.insertBefore(el, content);
  }
  el.textContent = msg;
  el.hidden = false;
}

function hideApplyError() {
  const el = document.getElementById('applyError');
  if (el) el.hidden = true;
}

function getTabMeta(tabId) {
  return tabMap[tabId] || { id: tabId, title: '(unknown)', url: '', favIconUrl: '' };
}

// Build the move-to-group <select> for a tab
function buildMoveSelect(tabId, currentGroupIndex) {
  const select = document.createElement('select');
  select.className = 'tab-move';
  select.setAttribute('aria-label', `Move "${getTabMeta(tabId).title}" to group`);
  select.dataset.focusKey = `move-${tabId}`;

  proposal.groups.forEach((g, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = g.name;
    if (i === currentGroupIndex) opt.selected = true;
    select.appendChild(opt);
  });

  // Ungrouped option
  const ungroupedOpt = document.createElement('option');
  ungroupedOpt.value = 'ungrouped';
  ungroupedOpt.textContent = 'Ungrouped';
  if (currentGroupIndex === -1) ungroupedOpt.selected = true;
  select.appendChild(ungroupedOpt);

  select.addEventListener('change', () => {
    moveTab(tabId, currentGroupIndex, select.value);
  });

  return select;
}

// Move a tab from one group to another and re-render
function moveTab(tabId, fromGroupIndex, toValue) {
  // Remove from source
  if (fromGroupIndex === -1) {
    proposal.ungroupedTabIds = proposal.ungroupedTabIds.filter(id => id !== tabId);
  } else {
    proposal.groups[fromGroupIndex].tabIds =
      proposal.groups[fromGroupIndex].tabIds.filter(id => id !== tabId);
  }

  // Add to target
  if (toValue === 'ungrouped') {
    proposal.ungroupedTabIds.push(tabId);
  } else {
    const targetIdx = parseInt(toValue);
    proposal.groups[targetIdx].tabIds.push(tabId);
  }

  render();
}

function renderColorPicker(groupIndex) {
  const container = document.createElement('div');
  container.className = 'color-select';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Group colour');

  for (const [name, label] of Object.entries(COLOR_MAP)) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot';
    const active = proposal.groups[groupIndex].color === name;
    if (active) {
      dot.classList.add('active');
    }
    dot.dataset.group = name;
    dot.setAttribute('aria-label', label);
    dot.setAttribute('aria-pressed', String(active));
    dot.title = label;
    dot.dataset.focusKey = `dot-${groupIndex}-${name}`;
    dot.innerHTML = CHECK_ICON;
    dot.addEventListener('click', () => {
      proposal.groups[groupIndex].color = name;
      render();
    });
    container.appendChild(dot);
  }

  return container;
}

function renderGroup(group, groupIndex) {
  const card = document.createElement('div');
  card.className = 'group-card';
  card.dataset.group = group.color;

  // Header
  const header = document.createElement('div');
  header.className = 'group-header';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'group-name';
  nameInput.value = group.name;
  nameInput.setAttribute('aria-label', 'Group name');
  nameInput.dataset.focusKey = `name-${groupIndex}`;
  nameInput.addEventListener('change', () => {
    proposal.groups[groupIndex].name = nameInput.value.slice(0, 40);
    // Update all move-selects to reflect the new name. Deferred a tick:
    // `change` fires before Tab moves focus, so rendering now would remove
    // the control focus is heading to.
    setTimeout(render, 0);
  });

  const count = document.createElement('span');
  count.className = 'tab-count';
  count.textContent = tabCountLabel(group.tabIds.length);

  const line = document.createElement('span');
  line.className = 'group-line';

  header.appendChild(nameInput);
  header.appendChild(count);
  header.appendChild(line);
  header.appendChild(renderColorPicker(groupIndex));
  card.appendChild(header);

  // Tab list
  const tabList = document.createElement('div');
  tabList.className = 'tab-list';

  for (const tabId of group.tabIds) {
    const meta = getTabMeta(tabId);
    const row = document.createElement('div');
    row.className = 'tab-row';

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.alt = '';
    favicon.src = meta.favIconUrl || 'chrome://favicon/size/16/' + meta.url;
    favicon.onerror = () => { favicon.style.display = 'none'; };

    const info = document.createElement('div');
    info.className = 'tab-info';
    info.innerHTML = `<div class="tab-title">${escapeHtml(meta.title)}</div>
      <div class="tab-url">${escapeHtml(meta.url)}</div>`;

    row.appendChild(favicon);
    row.appendChild(info);
    row.appendChild(buildMoveSelect(tabId, groupIndex));
    tabList.appendChild(row);
  }

  card.appendChild(tabList);
  return card;
}

function renderUngrouped() {
  if (proposal.ungroupedTabIds.length === 0) return null;

  const card = document.createElement('div');
  card.className = 'group-card ungrouped';

  const header = document.createElement('div');
  header.className = 'group-header';
  const label = document.createElement('span');
  label.className = 'ungrouped-label';
  label.textContent = 'Ungrouped';

  const count = document.createElement('span');
  count.className = 'tab-count';
  count.textContent = tabCountLabel(proposal.ungroupedTabIds.length);

  header.appendChild(label);
  header.appendChild(count);
  card.appendChild(header);

  const tabList = document.createElement('div');
  tabList.className = 'tab-list';

  for (const tabId of proposal.ungroupedTabIds) {
    const meta = getTabMeta(tabId);
    const row = document.createElement('div');
    row.className = 'tab-row';

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.alt = '';
    favicon.src = meta.favIconUrl || 'chrome://favicon/size/16/' + meta.url;
    favicon.onerror = () => { favicon.style.display = 'none'; };

    const info = document.createElement('div');
    info.className = 'tab-info';
    info.innerHTML = `<div class="tab-title">${escapeHtml(meta.title)}</div>
      <div class="tab-url">${escapeHtml(meta.url)}</div>`;

    row.appendChild(favicon);
    row.appendChild(info);
    row.appendChild(buildMoveSelect(tabId, -1));
    tabList.appendChild(row);
  }

  card.appendChild(tabList);
  return card;
}

// Re-rendering replaces every control, so the focused one (a colour dot, a
// move select, a name input) is found again by its focus key afterwards.
function render() {
  const content = document.getElementById('content');
  const focusKey = content.contains(document.activeElement)
    ? document.activeElement.dataset.focusKey
    : null;
  content.innerHTML = '';

  for (let i = 0; i < proposal.groups.length; i++) {
    content.appendChild(renderGroup(proposal.groups[i], i));
  }

  const ungrouped = renderUngrouped();
  if (ungrouped) content.appendChild(ungrouped);

  document.getElementById('actionsContainer').style.display = 'flex';

  if (focusKey) {
    const target = content.querySelector(`[data-focus-key="${focusKey}"]`);
    if (target) target.focus();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(text) {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading">${escapeHtml(text)}</div>`;
}

function initDebugSection(model, messages) {
  const section = document.getElementById('debugSection');
  const promptText = messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n---\n\n');

  section.innerHTML = `
    <div class="debug-block">
      <h4>Model</h4>
      <pre>${escapeHtml(model)}</pre>
    </div>
    <div class="debug-block">
      <h4>Prompt sent</h4>
      <pre>${escapeHtml(promptText)}</pre>
    </div>
    <div class="debug-block">
      <h4>Raw response</h4>
      <pre id="rawResponsePre"></pre>
    </div>`;

  // Stays closed until the first chunk: a run that fails before any output
  // must not leave an uncollapsible prompt dump under the error.
  section.classList.remove('visible');
}

function appendChunk(text) {
  const pre = document.getElementById('rawResponsePre');
  if (pre) {
    pre.textContent += text;
    pre.scrollTop = pre.scrollHeight;
  }
  // The toggle has nothing to show until the model has said something; the
  // first output opens the section (shown during streaming) with its toggle.
  const toggle = document.getElementById('debugToggle');
  if (text && toggle.hidden) {
    toggle.hidden = false;
    document.getElementById('debugSection').classList.add('visible');
    toggle.textContent = 'Hide the model\'s raw output';
  }
}

function setupDebugToggle() {
  const toggle = document.getElementById('debugToggle');
  const section = document.getElementById('debugSection');
  toggle.addEventListener('click', () => {
    const visible = section.classList.toggle('visible');
    toggle.textContent = visible ? 'Hide the model\'s raw output' : 'Show the model\'s raw output';
  });
}

function setupActionButtons() {
  const applyButton = document.getElementById('applyButton');
  applyButton.addEventListener('click', () => {
    const groupsToApply = proposal.groups
      .filter(g => g.tabIds.length > 0)
      .map(g => ({ name: g.name, color: g.color, tabIds: g.tabIds }));

    const label = applyButton.textContent;
    applyButton.disabled = true;
    applyButton.textContent = 'Applying...';
    hideApplyError();

    // On success the background closes this tab; on failure it stays open
    // and says why.
    chrome.runtime.sendMessage({
      action: 'applyAiProposal',
      groups: groupsToApply,
      ungroupedTabIds: [...proposal.ungroupedTabIds],
      respectGroups,
      windowId: proposal.windowId,
    }, (response) => {
      if (!chrome.runtime.lastError && response && response.success) return;
      applyButton.disabled = false;
      applyButton.textContent = label;
      showApplyError(`Couldn't apply the groups: ${replyFailure(response)}`);
    });
  });

  document.getElementById('cancelButton').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'cancelAiProposal' });
  });
}

function handleMessage(msg) {
  if (!msg.type) return;
  if (msg.type === 'ai-chunk') {
    appendChunk(msg.text);
  } else if (msg.type === 'ai-status') {
    showStatus(msg.text);
  } else if (msg.type === 'ai-debug') {
    initDebugSection(msg.model, msg.messages);
  } else if (msg.type === 'ai-proposal') {
    proposal = msg;
    tabMap = {};
    for (const t of proposal.tabs) {
      tabMap[t.id] = t;
    }
    render();
    // Collapse debug section now that the proposal is rendered
    const section = document.getElementById('debugSection');
    section.classList.remove('visible');
    document.getElementById('debugToggle').textContent = 'Show the model\'s raw output';
  } else if (msg.type === 'ai-error') {
    showError(msg.error);
  }
}

function showInstructionsInput() {
  const modeHint = respectGroups
    ? 'Organizing <strong>ungrouped tabs only</strong> (Groups)'
    : 'Reorganizing <strong>all tabs</strong> (Flat)';

  const content = document.getElementById('content');
  content.innerHTML = `
    <p class="mode-hint">${modeHint}</p>
    <div class="instructions">
      <label for="userInstructions">How should your tabs be organized?</label>
      <textarea id="userInstructions" rows="3" placeholder='Leave blank for default grouping, or e.g. "group movies by decade of release"'></textarea>
    </div>
    <div class="form-actions">
      <button class="btn primary confirm" id="startOrganize">Organize</button>
      <button class="btn cancel" id="cancelOrganize">Cancel</button>
    </div>`;

  document.getElementById('startOrganize').addEventListener('click', () => {
    const instructions = document.getElementById('userInstructions').value.trim();
    showStatus('Starting...');

    // Listen for pushed messages from background
    chrome.runtime.onMessage.addListener(handleMessage);

    // Tell background we're ready, with optional instructions. If no run is
    // waiting for this tab (or the background can't answer), say so rather
    // than sit on 'Starting...'.
    chrome.runtime.sendMessage({ action: 'aiProposalReady', instructions }, (response) => {
      if (!chrome.runtime.lastError && response && response.pending) return;
      chrome.runtime.onMessage.removeListener(handleMessage);
      showRunEnded();
    });
  });

  document.getElementById('cancelOrganize').addEventListener('click', () => {
    window.close();
  });

  // Focus the textarea
  document.getElementById('userInstructions').focus();
}

// A refresh drops the page's link to its run, so it cannot pick it up again.
function wasReloaded() {
  try {
    const [nav] = window.performance.getEntriesByType('navigation');
    return !!nav && nav.type === 'reload';
  } catch (_e) {
    return false;
  }
}

function init() {
  setupDebugToggle();
  setupActionButtons();
  if (wasReloaded()) {
    showRunEnded();
  } else {
    showInstructionsInput();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
