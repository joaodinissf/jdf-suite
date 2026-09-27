/* global HuddleAi */
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

const pageParams = new URLSearchParams(window.location.search);
// Groups (true) or Flat (false), as chosen in the popup.
const respectGroups = pageParams.get('respectGroups') !== 'false';

// 'missing' or 'expired' while organize needs a key first (the popup says so
// in the URL; the stored config confirms it once loaded), else null.
let keyNeeded = ['missing', 'expired'].includes(pageParams.get('key')) ? pageParams.get('key') : null;

// From 'loadAiConfig': the stored config, the built-in default model and the
// expiry choices for the inline key form.
let aiConfig = null;
let builtInDefaultModel = null;
let expiryPresets = [];
let modelPicker = null;
let keyForm = null;

// What the current run was started with, so Run again can repeat it.
let lastInstructions = '';
let runModelId = null;
// True from the start of a run until its proposal, error or end is shown.
let runInProgress = false;

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

function openSettings() {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
}

// ---- Model for this run ------------------------------------------------------

function savedDefaultModel() {
  return (aiConfig && aiConfig.model) || builtInDefaultModel || null;
}

// The picker's choice, or null (the background then uses the default).
function selectedModelId() {
  return (modelPicker && modelPicker.getModelId()) || null;
}

function modelLabel(id) {
  return (modelPicker && modelPicker.modelName(id)) || id;
}

function setModelNote(text) {
  const note = document.getElementById('modelNote');
  if (note) note.textContent = text;
}

// The bar names the model this run uses (or used), marks the saved default,
// and offers Make default for any other choice.
function updateModelBar() {
  const nameEl = document.getElementById('modelName');
  if (!nameEl) return;
  const id = selectedModelId() || savedDefaultModel();
  nameEl.textContent = id ? modelLabel(id) : 'Default model';
  nameEl.title = id || '';

  const isDefault = !!id && id === savedDefaultModel();
  document.getElementById('defaultTag').hidden = !isDefault;
  document.getElementById('makeDefault').hidden = !id || isDefault;

  if (runModelId && id && id !== runModelId) {
    // Run again only shows once the proposal is in, so mid-run the note
    // cannot point at it.
    setModelNote(runInProgress
      ? `This run uses ${modelLabel(runModelId)}. ${modelLabel(id)} applies when you run again after it finishes.`
      : `This run used ${modelLabel(runModelId)}. Run again to use ${modelLabel(id)}.`);
  } else {
    setModelNote('');
  }
}

function setRunAgainVisible(visible) {
  const button = document.getElementById('runAgainButton');
  if (button) button.hidden = !visible;
}

function makeDefault() {
  const id = selectedModelId();
  if (!id) return;
  HuddleAi.request({ action: 'saveAiDefaultModel', model: id }).then((response) => {
    if (!response || !response.success) {
      throw new Error((response && response.error) || 'no reply from Huddle');
    }
    aiConfig = response.config || { ...(aiConfig || {}), model: id };
    updateModelBar();
    setModelNote(`${modelLabel(id)} is now your default model.`);
  }).catch((err) => {
    setModelNote(`Couldn't save the default model: ${err.message}`);
  });
}

function setupModelBar() {
  const panel = document.getElementById('modelPanel');
  if (!panel) return;
  modelPicker = HuddleAi.createModelPicker(panel, {
    idPrefix: 'run',
    onChange: updateModelBar,
  });

  const change = document.getElementById('changeModel');
  change.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    change.setAttribute('aria-expanded', String(!panel.hidden));
    change.textContent = panel.hidden ? 'Change' : 'Done';
  });
  document.getElementById('makeDefault').addEventListener('click', makeDefault);
  document.getElementById('runAgainButton').addEventListener('click', runAgain);
}

// The stored config decides whether a key is needed; the URL was only a hint.
function loadPageConfig() {
  return HuddleAi.request({ action: 'loadAiConfig' }).then((data) => {
    if (!data) return;
    builtInDefaultModel = data.defaultModel || null;
    expiryPresets = data.expiryPresets || [];
    if (!data.error) {
      aiConfig = data.config || null;
      keyNeeded = HuddleAi.keyState(aiConfig);
    }
    if (modelPicker) {
      modelPicker.setCatalog(data.models, data.modelsMeta, selectedModelId() || savedDefaultModel());
    }
    updateKeySection();
    updateModelBar();
  }).catch(() => {
    // The picker stays empty and the run uses the default model.
    updateModelBar();
  });
}

// ---- Runs ----------------------------------------------------------------

function resetDebugSection() {
  const toggle = document.getElementById('debugToggle');
  const section = document.getElementById('debugSection');
  toggle.hidden = true;
  toggle.textContent = 'Show the model\'s raw output';
  section.classList.remove('visible');
  section.innerHTML = '';
}

// Starts the run parked for this tab, with the picked model for this run
// only. If no run is waiting (or the background can't answer), says so
// rather than sit on 'Starting...'.
function startRun(instructions) {
  lastInstructions = instructions;
  runModelId = null;
  runInProgress = true;
  hideApplyError();
  setRunAgainVisible(false);
  document.getElementById('actionsContainer').style.display = 'none';
  resetDebugSection();
  showStatus('Starting...');
  updateModelBar();

  // Listen for pushed messages from background (once, however many runs).
  chrome.runtime.onMessage.removeListener(handleMessage);
  chrome.runtime.onMessage.addListener(handleMessage);

  chrome.runtime.sendMessage({
    action: 'aiProposalReady',
    instructions,
    model: selectedModelId(),
  }, (response) => {
    if (!chrome.runtime.lastError && response && response.pending) return;
    chrome.runtime.onMessage.removeListener(handleMessage);
    showRunEnded();
  });
}

// Run again and Retry: a new run in this same tab, with the model now in the
// picker. A missing key brings back the form with the key field.
function runAgain() {
  setRunAgainVisible(false);
  chrome.runtime.sendMessage({ action: 'aiRestartRun', respectGroups }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      showError(`Couldn't start a new run: ${replyFailure(response)}`);
      return;
    }
    if (keyNeeded) {
      showInstructionsInput();
    } else {
      startRun(lastInstructions);
    }
  });
}

// The error text can come from the network, so it is set as text, never HTML.
function showError(msg) {
  runInProgress = false;
  updateModelBar();
  const content = document.getElementById('content');
  document.getElementById('actionsContainer').style.display = 'none';
  setRunAgainVisible(false);
  const el = document.createElement('div');
  el.className = 'error-msg';
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  content.replaceChildren(el, buildFormActions(
    buildButton('Retry', 'btn primary confirm', runAgain),
    buildButton('Open Settings', 'btn', openSettings),
  ));
}

// No run is waiting for this page: it was refreshed, opened on its own, or
// Chrome stopped Huddle's background worker while the page sat idle.
function showRunEnded() {
  runInProgress = false;
  updateModelBar();
  const content = document.getElementById('content');
  document.getElementById('actionsContainer').style.display = 'none';
  setRunAgainVisible(false);
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
  // With a proposal on screen, another model can be tried in this tab.
  setRunAgainVisible(true);

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
    runModelId = msg.model || null;
    initDebugSection(msg.model, msg.messages);
    updateModelBar();
  } else if (msg.type === 'ai-proposal') {
    runInProgress = false;
    proposal = msg;
    tabMap = {};
    for (const t of proposal.tabs) {
      tabMap[t.id] = t;
    }
    render();
    updateModelBar();
    // Collapse debug section now that the proposal is rendered
    const section = document.getElementById('debugSection');
    section.classList.remove('visible');
    document.getElementById('debugToggle').textContent = 'Show the model\'s raw output';
  } else if (msg.type === 'ai-error') {
    // The key went missing or expired since the page opened: Retry asks for it.
    if (msg.needsKey) keyNeeded = msg.needsKey;
    showError(msg.error);
  }
}

function showKeyError(msg) {
  const el = document.getElementById('keyError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

// Shows the inline key form while a key is needed, and fills its expiry
// choice once the presets have loaded. Organize waits for them: an empty
// expiry choice cannot be saved.
function updateKeySection() {
  const section = document.getElementById('keySetup');
  if (!section) return;
  section.hidden = !keyNeeded;
  document.getElementById('keyIntro').textContent = keyNeeded === 'expired'
    ? 'Your OpenRouter key has expired. Enter it again to organize.'
    : 'Organize with AI uses your own OpenRouter API key. Add it once and Huddle keeps it for next time.';
  if (keyForm && !keyForm.expirySelect.options.length && expiryPresets.length) {
    const selected = aiConfig && aiConfig.expiryDuration !== undefined ? aiConfig.expiryDuration : 86400000;
    keyForm.setExpiryPresets(expiryPresets, selected);
  }
  const start = document.getElementById('startOrganize');
  start.textContent = keyNeeded ? 'Save key and organize' : 'Organize';
  start.disabled = !!keyNeeded && !expiryPresets.length;
}

// With a key needed, Organize first runs the key checks (OpenRouter's too)
// and saves it, then starts the run here. The default model is left alone.
async function onOrganize() {
  const instructions = document.getElementById('userInstructions').value.trim();
  if (!keyNeeded) {
    startRun(instructions);
    return;
  }

  const start = document.getElementById('startOrganize');
  showKeyError('');
  start.disabled = true;
  const result = await keyForm.collect();
  if (!result.ok) {
    start.disabled = false;
    showKeyError(result.error);
    return;
  }

  let response;
  try {
    response = await HuddleAi.request({
      action: 'saveAiConfig',
      config: { key: result.key, expiryDuration: result.expiryDuration },
    });
  } catch (err) {
    response = { success: false, error: err.message };
  }
  if (!response || !response.success) {
    start.disabled = false;
    showKeyError((response && response.error) || 'Failed to save the key.');
    return;
  }

  aiConfig = response.config || aiConfig;
  keyNeeded = null;
  keyForm.clear();
  updateModelBar();
  startRun(instructions);
}

function showInstructionsInput() {
  const modeHint = respectGroups
    ? 'Organizing <strong>ungrouped tabs only</strong> (Groups)'
    : 'Reorganizing <strong>all tabs</strong> (Flat)';

  document.getElementById('actionsContainer').style.display = 'none';
  setRunAgainVisible(false);
  const content = document.getElementById('content');
  content.innerHTML = `
    <section id="keySetup" class="key-setup ai-form" data-group="cyan" hidden>
      <h2 class="section-head"><span class="group-chip">OpenRouter key</span><span class="group-line"></span></h2>
      <p id="keyIntro" class="key-intro"></p>
      <div class="key-warning">
        <p>Huddle keeps the key in this browser with basic encoding. It is <strong>not encrypted</strong>, so use a key with a spending limit on OpenRouter and a short expiry.</p>
      </div>
      <div id="keyFormMount"></div>
      <p class="field-help">You can replace or delete the key later in <button type="button" class="link-btn" id="openSettingsLink">Settings</button>.</p>
      <div id="keyError" class="error-msg" role="alert" hidden></div>
    </section>
    <p class="mode-hint">${modeHint}</p>
    <div class="instructions">
      <label for="userInstructions">How should your tabs be organized?</label>
      <textarea id="userInstructions" rows="3" placeholder='Leave blank for default grouping, or e.g. "group movies by decade of release"'></textarea>
    </div>
    <div class="form-actions">
      <button class="btn primary confirm" id="startOrganize">Organize</button>
      <button class="btn cancel" id="cancelOrganize">Cancel</button>
    </div>`;

  keyForm = HuddleAi.createKeyForm(document.getElementById('keyFormMount'), { idPrefix: 'inline' });
  document.getElementById('openSettingsLink').addEventListener('click', openSettings);
  // Set as a value, never as markup: it is the user's own text.
  document.getElementById('userInstructions').value = lastInstructions;
  updateKeySection();

  document.getElementById('startOrganize').addEventListener('click', onOrganize);
  document.getElementById('cancelOrganize').addEventListener('click', () => {
    window.close();
  });

  if (keyNeeded) {
    keyForm.keyInput.focus();
  } else {
    document.getElementById('userInstructions').focus();
  }
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
  setupModelBar();
  if (wasReloaded()) {
    showRunEnded();
  } else {
    showInstructionsInput();
  }
  loadPageConfig();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
