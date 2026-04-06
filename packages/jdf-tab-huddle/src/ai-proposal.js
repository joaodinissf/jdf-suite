// Chrome tab group color values for the color picker
const COLOR_MAP = {
  grey:   '#9aa0a6',
  blue:   '#8ab4f8',
  red:    '#f28b82',
  yellow: '#fdd663',
  green:  '#81c995',
  pink:   '#ff8bcb',
  purple: '#c58af9',
  cyan:   '#78d9ec',
  orange: '#fcad70',
};

let proposal = null; // { groups, ungroupedTabIds, tabs, windowId }
let tabMap = {};      // id → tab metadata

function showError(msg) {
  document.getElementById('content').innerHTML =
    `<div class="error-msg">${msg}</div>`;
}

function getTabMeta(tabId) {
  return tabMap[tabId] || { id: tabId, title: '(unknown)', url: '', favIconUrl: '' };
}

// Build the move-to-group <select> for a tab
function buildMoveSelect(tabId, currentGroupIndex) {
  const select = document.createElement('select');
  select.className = 'tab-move';

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

  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    if (proposal.groups[groupIndex].color === name) {
      dot.classList.add('active');
    }
    dot.style.backgroundColor = hex;
    dot.title = name;
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

  // Header
  const header = document.createElement('div');
  header.className = 'group-header';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'group-name';
  nameInput.value = group.name;
  nameInput.addEventListener('change', () => {
    proposal.groups[groupIndex].name = nameInput.value.slice(0, 40);
    // Update all move-selects to reflect the new name
    render();
  });

  const count = document.createElement('span');
  count.className = 'tab-count';
  count.textContent = group.tabIds.length + (group.tabIds.length === 1 ? ' tab' : ' tabs');

  header.appendChild(nameInput);
  header.appendChild(renderColorPicker(groupIndex));
  header.appendChild(count);
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
  card.className = 'group-card';
  card.style.opacity = '0.7';

  const header = document.createElement('div');
  header.className = 'group-header';
  const label = document.createElement('span');
  label.className = 'group-name';
  label.textContent = 'Ungrouped';
  label.style.cursor = 'default';
  label.style.opacity = '0.8';

  const count = document.createElement('span');
  count.className = 'tab-count';
  count.textContent = proposal.ungroupedTabIds.length + ' tabs';

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

function render() {
  const content = document.getElementById('content');
  content.innerHTML = '';

  for (let i = 0; i < proposal.groups.length; i++) {
    content.appendChild(renderGroup(proposal.groups[i], i));
  }

  const ungrouped = renderUngrouped();
  if (ungrouped) content.appendChild(ungrouped);

  document.getElementById('actionsContainer').style.display = 'flex';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderDebug() {
  if (!proposal || !proposal.debug) return;
  const section = document.getElementById('debugSection');
  const toggle = document.getElementById('debugToggle');
  const d = proposal.debug;

  const promptText = d.messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n---\n\n');

  section.innerHTML = `
    <div class="debug-block">
      <h4>Model</h4>
      <pre>${escapeHtml(d.model)}</pre>
    </div>
    <div class="debug-block">
      <h4>Prompt sent</h4>
      <pre>${escapeHtml(promptText)}</pre>
    </div>
    <div class="debug-block">
      <h4>Raw response</h4>
      <pre>${escapeHtml(d.rawResponse)}</pre>
    </div>`;

  toggle.addEventListener('click', () => {
    const visible = section.classList.toggle('visible');
    toggle.textContent = visible ? 'Hide raw model I/O' : 'Show raw model I/O';
  });
}

function setupEventListeners() {
  document.getElementById('applyButton').addEventListener('click', () => {
    // Only send groups that have tabs
    const groupsToApply = proposal.groups
      .filter(g => g.tabIds.length > 0)
      .map(g => ({ name: g.name, color: g.color, tabIds: g.tabIds }));

    chrome.runtime.sendMessage({
      action: 'applyAiProposal',
      groups: groupsToApply,
      windowId: proposal.windowId,
    });
  });

  document.getElementById('cancelButton').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'cancelAiProposal' });
  });
}

async function init() {
  const data = await chrome.runtime.sendMessage({ action: 'getAiProposal' });

  if (!data || data.error) {
    showError(data?.error || 'No proposal available. Please try again from the popup.');
    return;
  }

  proposal = data;

  // Build tab lookup map
  tabMap = {};
  for (const t of proposal.tabs) {
    tabMap[t.id] = t;
  }

  render();
  renderDebug();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init();
    setupEventListeners();
  });
} else {
  init();
  setupEventListeners();
}
