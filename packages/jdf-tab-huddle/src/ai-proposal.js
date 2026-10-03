/* global HuddleAi */
// The organize page. It owns its runs: each Organize, Retry or Run again
// opens a port to the service worker and starts a run on it with this page's
// instructions and model. Everything the run sends comes back on that port,
// so an old run can never write into a new one; the port closing (Stop, a
// reload, the tab closing) cancels the request; and the worker stopping shows
// here as the port closing, never as a page stuck on "Asking…".

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
const COLOR_NAMES = Object.keys(COLOR_MAP);

const CHECK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">'
  + '<path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const AI_RUN_PORT = 'huddle-ai-run';
const PAGE_STATE_KEY = 'huddleOrganizePage';
// While a run waits on OpenRouter, a ping on the port keeps the worker awake.
const PING_MS = 20000;
const IS_MAC = /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

function tabCountLabel(n) {
  return n + (n === 1 ? ' tab' : ' tabs');
}

let proposal = null; // { groups, ungroupedTabIds, tabs, windowId }
let tabMap = {};      // id → tab metadata

const pageParams = new URLSearchParams(window.location.search);
// Groups (true) or Flat (false): the popup's choice, or Flat from an error.
let respectGroups = pageParams.get('respectGroups') !== 'false';

// From 'loadAiConfig': the stored config, the built-in default model and the
// expiry choices for the inline key form.
let aiConfig = null;
let builtInDefaultModel = null;
let expiryPresets = [];
let configLoaded = false;
// 'missing', 'expired' or 'rejected' (OpenRouter refused the stored key)
// while organize needs a key first; null when it can run.
let keyNeeded = null;
// The worker is an older build than this page (see HuddleAi.STALE_MESSAGE).
let staleWorker = false;
let modelPicker = null;
let keyForm = null;

// What the next run sends. Both survive a reload (sessionStorage).
let instructions = '';
let explicitModel = null; // picked on this page; null means the saved default
let hadRun = false;
// Whether the last run ended in a proposal, which a reload throws away.
let hadProposal = false;
// The run on screen: { model, modelName }, and whether it failed.
let lastRun = null;
let lastRunFailed = false;
// The run going now: { port, started, done, pingTimer }, or null.
let run = null;
// compose | loading | proposal | error | stale | applied
let view = 'compose';
// explicitModel when the model panel opened, restored by Escape.
let panelOpenedWith;
let transientNote = '';
let focusApplyOnRender = false;
// Proposed tabs closed or moved to another window since the proposal came.
let leftOutTabs = 0;
// Where focus goes once the config has loaded and the primary button is
// enabled (a disabled button cannot take focus).
let composeFocusPrimary = false;
// OpenRouter's words when it rejected the stored key (the key form's intro).
let rejectedKeyMessage = '';
// A model the last error says no retry can fix: while it is still the next
// model, the primary action is the fix instead of Retry. blockedBy says
// which: 'model' (a batch model, no endpoint) is Change model, 'credits' is
// Add credits.
let blockedModel = null;
let blockedBy = null;
// Whether the model has said anything yet (the debug toggle's label).
let debugHasOutput = false;
// A run started with Enter can end (a quick error or answer) before a second
// Enter of the same double press lands, which would then press whatever the
// page focused next: Retry, Add credits, Change model or Apply. So for a
// moment after a keyboard-started run ends, Enter on the element the page
// focused does nothing. Focus the user moves elsewhere is theirs.
const ENTER_GUARD_MS = 700;
let lastEnterAt = -Infinity;
let runKeyStartedAt = -Infinity;
let enterGuardEl = null;
// The value the focused text field had when it took focus: Escape puts it
// back.
let fieldValueOnFocus = '';

// ---- Page state that survives a reload ------------------------------------

function loadPageState() {
  try {
    return JSON.parse(window.sessionStorage.getItem(PAGE_STATE_KEY) || '{}') || {};
  } catch (_e) {
    return {};
  }
}

function savePageState() {
  try {
    window.sessionStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      instructions, explicitModel, respectGroups, hadRun, hadProposal,
    }));
  } catch (_e) {
    // Private windows can refuse storage; the page still works without it.
  }
}

function setRespectGroups(value) {
  respectGroups = !!value;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('respectGroups', respectGroups ? 'true' : 'false');
    window.history.replaceState(null, '', url);
  } catch (_e) {
    // not fatal
  }
  const hint = document.getElementById('modeHint');
  if (hint) hint.innerHTML = modeHintHtml();
  savePageState();
  // A proposal on screen keeps the mode it was made in; the new one is for
  // Run again, which becomes the primary button, and the note says so.
  if (view === 'proposal') updateModelBar();
}

function modeName(groups) {
  return groups ? 'Groups' : 'Flat';
}

// ---- Small builders ---------------------------------------------------------

function buildButton(label, className, onClick, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (id) button.id = id;
  button.addEventListener('click', onClick);
  return button;
}

function openSettings() {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
}

function openCredits() {
  chrome.tabs.create({ url: 'https://openrouter.ai/settings/credits' });
}

function reloadHuddle() {
  chrome.runtime.reload();
}

// Cancel and Escape: closes this tab (the background does it, so a Settings
// tab opened from here is never the one closed).
function cancelPage() {
  if (run) stopRun({ quiet: true });
  try {
    chrome.runtime.sendMessage({ action: 'cancelAiProposal' }, () => {
      if (chrome.runtime.lastError) window.close();
    });
  } catch (_e) {
    window.close();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function announce(text) {
  const el = document.getElementById('runStatus');
  if (el) el.textContent = text;
}

// ---- Model for the next run -------------------------------------------------

function savedDefaultModel() {
  return (aiConfig && aiConfig.model) || builtInDefaultModel || null;
}

// The default a run uses when none is picked here: the saved one, or the
// first recommended model while the catalog no longer lists it.
function defaultResolution() {
  return HuddleAi.resolveDefaultModel(aiConfig, builtInDefaultModel, modelPicker);
}

function defaultModel() {
  return defaultResolution().model || null;
}

function nextModel() {
  return explicitModel || defaultModel();
}

function modelLabel(id) {
  if (lastRun && lastRun.model === id && lastRun.modelName) {
    const name = modelPicker ? modelPicker.modelName(id) : '';
    return name && name !== id ? name : lastRun.modelName;
  }
  return (modelPicker && modelPicker.modelName(id)) || id;
}

function setModelNote(text) {
  const note = document.getElementById('modelNote');
  if (note) note.textContent = text;
}

// The bar names the model the next run uses, marks the saved default, and
// offers Make default for another model the catalog lists. The note says
// when the proposal or run on screen came from a different model.
function updateModelBar() {
  const nameEl = document.getElementById('modelName');
  if (!nameEl) return;
  const bar = document.getElementById('modelBar');
  // An old worker can't run anything, and after Apply nothing is left to run.
  bar.hidden = view === 'stale' || view === 'applied';
  const id = nextModel();
  bar.classList.toggle('pending', !id);
  nameEl.textContent = id ? modelLabel(id) : '';
  nameEl.title = id || '';
  syncProposalActions();

  const isDefault = !!id && id === savedDefaultModel();
  document.getElementById('defaultTag').hidden = !isDefault;
  const failedHere = lastRunFailed && lastRun && lastRun.model === id;
  document.getElementById('makeDefault').hidden = !id || isDefault || failedHere
    || !(modelPicker && modelPicker.isListed(id));

  if (transientNote) {
    setModelNote(transientNote);
  } else if (view === 'proposal' && proposal && respectGroups !== proposal.respectGroups) {
    setModelNote(`Made in ${modeName(proposal.respectGroups)} mode · Run again to use ${modeName(respectGroups)}`);
  } else if (lastRun && id && lastRun.model !== id && view !== 'compose') {
    const ran = lastRun.modelName || modelLabel(lastRun.model);
    if (view === 'loading') {
      setModelNote(`This run uses ${ran}. ${modelLabel(id)} is for the next run.`);
    } else if (view === 'proposal') {
      setModelNote(`This proposal came from ${ran}. Run again to use ${modelLabel(id)}.`);
    } else {
      // Name the button that runs next only when it is on the page.
      const form = document.getElementById('composeForm');
      const label = !keyNeeded && form ? form.dataset.primaryLabel : '';
      const next = ['Retry', 'Run again', 'Organize'].includes(label) ? `${label} uses` : 'The next run uses';
      setModelNote(`That run used ${ran}. ${next} ${modelLabel(id)}.`);
    }
  } else if (!explicitModel) {
    setModelNote(HuddleAi.defaultFallbackNote(defaultResolution(), modelPicker));
  } else {
    setModelNote('');
  }
}

// With a proposal on screen from one model (or mode) and another picked for
// the next run, Run again is the thing to do: it becomes the primary button
// and takes Cmd/Ctrl+Enter, so that shortcut never applies a proposal the
// page just said to replace. Apply stays one click (or Tab) away.
function nextRunDiffers() {
  const id = nextModel();
  return view === 'proposal' && ((!!lastRun && !!id && lastRun.model !== id)
    || (!!proposal && respectGroups !== proposal.respectGroups));
}

function syncProposalActions() {
  const apply = document.getElementById('applyButton');
  const again = document.getElementById('runAgainButton');
  const keys = document.getElementById('proposalKeys');
  if (!apply || !again) return;
  const differs = nextRunDiffers();
  const shortcut = 'Meta+Enter Control+Enter';
  apply.classList.toggle('primary', !differs);
  again.classList.toggle('primary', differs);
  if (differs) {
    apply.removeAttribute('aria-keyshortcuts');
    again.setAttribute('aria-keyshortcuts', shortcut);
  } else {
    apply.setAttribute('aria-keyshortcuts', shortcut);
    again.removeAttribute('aria-keyshortcuts');
  }
  if (keys) {
    keys.innerHTML = `<kbd>${MOD_KEY}</kbd><kbd>↵</kbd> ${differs ? 'run again' : 'apply'} `
      + '<span aria-hidden="true">·</span> <kbd>Esc</kbd> cancel';
  }
}

// Where focus goes once a model is picked (Enter in the list): the button
// that runs with it, else back to Change.
function focusAfterPick() {
  if (nextRunDiffers()) {
    document.getElementById('runAgainButton').focus();
    return;
  }
  const start = document.getElementById('startOrganize');
  if ((view === 'error' || view === 'compose') && start && !start.disabled && !keyNeeded) {
    start.focus();
    return;
  }
  document.getElementById('changeModel').focus();
}

function onPickerChange(id) {
  transientNote = '';
  const value = id || null;
  // The saved default counts as "no pick" even while the catalog lacks it:
  // the picker reports it when the catalog loads, and the run then uses the
  // stand-in the model bar names.
  explicitModel = value && value !== defaultModel() && value !== savedDefaultModel() ? value : null;
  savePageState();
  updateModelBar();
  updateKeySection();
}

function openModelPanel() {
  const panel = document.getElementById('modelPanel');
  const change = document.getElementById('changeModel');
  if (!panel || !panel.hidden) return;
  panelOpenedWith = explicitModel;
  panel.hidden = false;
  change.setAttribute('aria-expanded', 'true');
  change.textContent = 'Hide models';
  if (modelPicker) modelPicker.focus();
}

function closeModelPanel({ revert = false, focusChange = true, afterPick = false } = {}) {
  const panel = document.getElementById('modelPanel');
  const change = document.getElementById('changeModel');
  if (!panel || panel.hidden) return;
  if (revert && panelOpenedWith !== undefined) {
    explicitModel = panelOpenedWith;
    if (modelPicker) modelPicker.setModelId(nextModel());
    savePageState();
    updateModelBar();
    updateKeySection();
  }
  panelOpenedWith = undefined;
  panel.hidden = true;
  change.setAttribute('aria-expanded', 'false');
  change.textContent = 'Change';
  if (afterPick) focusAfterPick();
  else if (focusChange) change.focus();
}

function makeDefault() {
  const id = nextModel();
  if (!id) return;
  HuddleAi.request({ action: 'saveAiDefaultModel', model: id }).then((response) => {
    if (!response || !response.success) {
      throw new Error((response && response.error) || 'no reply from Huddle');
    }
    aiConfig = response.config || { ...(aiConfig || {}), model: id };
    explicitModel = null;
    savePageState();
    transientNote = `${modelLabel(id)} is now your default model.`;
    updateModelBar();
  }).catch((err) => {
    if (err.stale) staleWorker = true;
    transientNote = `Couldn't save the default model: ${err.message}`;
    updateModelBar();
  });
}

function setupModelBar() {
  const panel = document.getElementById('modelPanel');
  if (!panel) return;
  modelPicker = HuddleAi.createModelPicker(panel, {
    idPrefix: 'run',
    onChange: onPickerChange,
    onCommit: () => closeModelPanel({ afterPick: true }),
    onCancel: () => closeModelPanel({ revert: true }),
  });

  const change = document.getElementById('changeModel');
  change.addEventListener('click', () => {
    if (panel.hidden) openModelPanel();
    else closeModelPanel();
  });
  document.getElementById('makeDefault').addEventListener('click', makeDefault);
}

// Only the config: the catalog loads separately, so the key form and
// Organize never wait on it.
async function loadPageConfig() {
  let data;
  try {
    data = await HuddleAi.request({ action: 'loadAiConfig' });
  } catch (err) {
    if (err.stale) {
      showStale();
    } else {
      showError({ kind: 'none', error: `Huddle couldn't load its settings: ${err.message}` });
    }
    return;
  }
  if (!data || data.protocol !== HuddleAi.PROTOCOL) {
    showStale();
    return;
  }
  builtInDefaultModel = data.defaultModel || null;
  expiryPresets = data.expiryPresets || [];
  if (!data.error) {
    aiConfig = data.config || null;
    if (keyNeeded !== 'rejected') keyNeeded = HuddleAi.keyState(aiConfig);
  }
  configLoaded = true;
  if (modelPicker) {
    modelPicker.setModelId(nextModel());
    modelPicker.load().then(() => {
      modelPicker.setModelId(nextModel());
      updateModelBar();
    });
  }
  updateKeySection();
  updateModelBar();
  // The form was drawn before the config loaded: its primary button was
  // still disabled (so it could not take focus), or a key turned out to be
  // needed. Focus goes where focusCompose meant it to.
  const active = document.activeElement;
  if ((view === 'compose' || view === 'error') && document.getElementById('composeForm')
      && (!active || active === document.body
        || (keyNeeded && active.id === 'userInstructions'))) {
    focusCompose({ primary: composeFocusPrimary });
  }
}

// Settings (or another organize tab) changed the key or the default model.
function onStorageChanged(changes, area) {
  if (area !== 'local' || !changes.aiConfig) return;
  const previousKey = aiConfig && aiConfig.key;
  aiConfig = changes.aiConfig.newValue || null;
  // A rejected key stays rejected until a different one is saved.
  if (!(keyNeeded === 'rejected' && aiConfig && aiConfig.key && aiConfig.key === previousKey)) {
    keyNeeded = HuddleAi.keyState(aiConfig);
  }
  if (!explicitModel && modelPicker) modelPicker.setModelId(nextModel());
  updateKeySection();
  updateModelBar();
}

// ---- Debug section (the model's raw output) --------------------------------

function setDebugOpen(open) {
  const toggle = document.getElementById('debugToggle');
  const section = document.getElementById('debugSection');
  section.classList.toggle('visible', open);
  toggle.setAttribute('aria-expanded', String(open));
  // Before the model answers, the section holds only what Huddle sent.
  const what = debugHasOutput ? 'the model\'s raw output' : 'the prompt Huddle sent';
  toggle.textContent = `${open ? 'Hide' : 'Show'} ${what}`;
}

function resetDebugSection() {
  const toggle = document.getElementById('debugToggle');
  const section = document.getElementById('debugSection');
  toggle.hidden = true;
  toggle.removeAttribute('data-opened');
  debugHasOutput = false;
  setDebugOpen(false);
  section.innerHTML = '';
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

  // The prompt can be inspected from here on, even if the run then fails;
  // the section itself stays closed until the model says something.
  document.getElementById('debugToggle').hidden = false;
  setDebugOpen(false);
}

function appendChunk(text) {
  const pre = document.getElementById('rawResponsePre');
  if (pre) {
    pre.textContent += text;
    pre.scrollTop = pre.scrollHeight;
  }
  // The first output opens the section, so it streams in view.
  const toggle = document.getElementById('debugToggle');
  if (text) debugHasOutput = true;
  if (text && toggle.getAttribute('data-opened') !== 'true') {
    toggle.hidden = false;
    toggle.setAttribute('data-opened', 'true');
    setDebugOpen(true);
  }
}

function setupDebugToggle() {
  const toggle = document.getElementById('debugToggle');
  const section = document.getElementById('debugSection');
  if (!toggle || !section) return;
  toggle.addEventListener('click', () => {
    setDebugOpen(!section.classList.contains('visible'));
  });
}

// ---- Runs -----------------------------------------------------------------

function readInstructionsField() {
  const field = document.getElementById('userInstructions');
  if (field) instructions = field.value.trim();
  return instructions;
}

function stopPing(r) {
  if (r && r.pingTimer) clearInterval(r.pingTimer);
}

// Ends the run going now (its result arrived, or the user stopped it).
function endRun() {
  const r = run;
  run = null;
  if (!r) return;
  r.done = true;
  stopPing(r);
  try {
    r.port.disconnect();
  } catch (_e) {
    // already closed
  }
}

// Starts a run on a new port. Ignored while one is starting or going, so a
// double click or Enter twice is one run.
function startRun(attempt = 0) {
  if (staleWorker) {
    showStale();
    return;
  }
  if (run && attempt === 0) return;
  if (attempt === 0) {
    const now = Date.now();
    runKeyStartedAt = now - lastEnterAt < 150 ? lastEnterAt : -Infinity;
    enterGuardEl = null;
  }
  readInstructionsField();
  hadRun = true;
  hadProposal = false;
  savePageState();
  closeModelPanel({ focusChange: false });

  const model = nextModel();
  lastRun = { model, modelName: model ? modelLabel(model) : '' };
  lastRunFailed = false;
  blockedModel = null;
  blockedBy = null;
  transientNote = '';
  view = 'loading';
  proposal = null;
  hideApplyNotice();
  setActionsVisible(false);
  resetDebugSection();
  showLoading('Starting…');
  updateModelBar();

  let port;
  try {
    port = chrome.runtime.connect({ name: AI_RUN_PORT });
  } catch (_e) {
    showStale();
    return;
  }
  const r = { port, started: false, done: false, pingTimer: null };
  run = r;
  port.onMessage.addListener((msg) => {
    if (run === r) handleRunMessage(msg);
  });
  port.onDisconnect.addListener(() => {
    // Reading lastError marks it handled.
    const lost = chrome.runtime.lastError;
    if (run !== r || r.done) return;
    stopPing(r);
    run = null;
    if (!r.started) {
      // Nothing answered the port: once more (a worker waking up can miss
      // the first connect), then this is a worker older than the page.
      if (attempt === 0) {
        setTimeout(() => startRun(1), 300);
        return;
      }
      if (!lost || HuddleAi.isNoReceiverError(lost.message)) {
        showStale();
        return;
      }
    }
    showEnded({
      title: 'This run has ended',
      detail: 'Huddle stopped working on it (Chrome restarted its background), so nothing was changed. Run it again for a fresh proposal.',
    });
    armEnterGuard();
  });
  try {
    port.postMessage({
      type: 'start',
      protocol: HuddleAi.PROTOCOL,
      instructions,
      model: explicitModel,
      respectGroups,
    });
  } catch (_e) {
    // onDisconnect reports it
  }
  r.pingTimer = setInterval(() => {
    try {
      port.postMessage({ type: 'ping' });
    } catch (_e) {
      stopPing(r);
    }
  }, PING_MS);
}

function stopRun({ quiet = false } = {}) {
  if (!run) return;
  endRun();
  if (quiet) return;
  showEnded({
    title: 'Stopped',
    detail: 'You stopped this run, so nothing was changed.',
  });
}

function handleRunMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'started') {
    if (run) run.started = true;
  } else if (msg.type === 'ai-status') {
    setLoadingText(msg.text);
  } else if (msg.type === 'ai-debug') {
    lastRun = { model: msg.model || null, modelName: msg.modelName || msg.model || '' };
    initDebugSection(msg.model, msg.messages || []);
    updateModelBar();
  } else if (msg.type === 'ai-chunk') {
    appendChunk(msg.text);
  } else if (msg.type === 'ai-proposal') {
    endRun();
    showProposal(msg);
    armEnterGuard();
  } else if (msg.type === 'ai-error') {
    endRun();
    if (msg.kind === 'stale') {
      showStale();
    } else {
      showError(msg);
    }
    armEnterGuard();
  }
}

// Called once a run's end is on screen, with focus where the page put it.
function armEnterGuard() {
  enterGuardEl = document.activeElement;
}

// ---- Views ------------------------------------------------------------------

function setActionsVisible(visible) {
  const actions = document.getElementById('actionsContainer');
  if (actions) actions.hidden = !visible;
}

function setLoadingText(text) {
  const el = document.getElementById('loadingText');
  if (el) el.textContent = text;
  announce(text);
}

function showLoading(text) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="loading" id="runProgress" tabindex="-1" aria-busy="true">
      <span class="spinner" aria-hidden="true"></span>
      <p id="loadingText" class="loading-text"></p>
      <button type="button" class="btn small" id="stopRun" aria-keyshortcuts="Escape">Stop</button>
    </div>`;
  document.getElementById('stopRun').addEventListener('click', () => stopRun());
  setLoadingText(text);
  // Focus follows the run to its progress, one Tab before Stop (Escape stops
  // too). Not onto Stop itself: the button that started the run is gone, and a
  // second Enter pressed quickly on it would land on Stop and end the run.
  document.getElementById('runProgress').focus({ preventScroll: true });
}

function modeHintHtml() {
  return respectGroups
    ? 'Organizing <strong>ungrouped tabs only</strong> (Groups)'
    : 'Reorganizing <strong>all tabs</strong> (Flat)';
}

// The form for the next run: the key section (while a key is needed), the
// instructions and the buttons. Every state but a running or proposed run
// shows it, with a notice on top, so the instructions can always be edited
// before running again. onPrimary() adjusts the run before it starts (Flat).
function renderCompose({ notice = null, primaryLabel = 'Organize', onPrimary = null, extras = [] } = {}) {
  setActionsVisible(false);
  const content = document.getElementById('content');
  content.innerHTML = `
    <form id="composeForm" class="compose" novalidate>
      <section id="keySetup" class="key-setup ai-form" data-group="cyan" hidden>
        <h2 class="section-head"><span class="group-chip">OpenRouter key</span><span class="group-line"></span></h2>
        <p id="keyIntro" class="key-intro"></p>
        <div class="key-warning">
          <p>Huddle keeps the key in this browser with basic encoding. It is <strong>not encrypted</strong>, so use a key with a spending limit on OpenRouter and a short expiry.</p>
        </div>
        <div id="keyFormMount"></div>
        <p class="field-help">You can replace or delete the key later in <button type="button" class="link-btn" id="openSettingsLink">Settings</button>.</p>
        <div id="keyError" class="field-error" role="alert" hidden></div>
      </section>
      <p class="mode-hint" id="modeHint">${modeHintHtml()}</p>
      <div class="instructions">
        <label for="userInstructions">How should your tabs be organized?</label>
        <textarea id="userInstructions" rows="3" placeholder='Leave blank for default grouping, or e.g. "group movies by decade of release"'></textarea>
      </div>
      <div class="form-actions" id="composeActions">
        <button type="submit" class="btn primary" id="startOrganize" aria-keyshortcuts="Meta+Enter Control+Enter">Organize</button>
      </div>
      <p class="keys-hint"><kbd>${MOD_KEY}</kbd><kbd>↵</kbd> <span id="primaryKeyLabel"></span> <span aria-hidden="true">·</span> <kbd>Esc</kbd> close</p>
    </form>`;
  if (notice) content.prepend(notice);

  const actions = document.getElementById('composeActions');
  for (const extra of extras) {
    actions.appendChild(buildButton(extra.label, 'btn', extra.onClick, extra.id));
  }
  actions.appendChild(buildButton('Cancel', 'btn cancel', cancelPage, 'cancelOrganize'));

  keyForm = HuddleAi.createKeyForm(document.getElementById('keyFormMount'), { idPrefix: 'inline' });
  document.getElementById('openSettingsLink').addEventListener('click', openSettings);
  const field = document.getElementById('userInstructions');
  // Set as a value, never as markup: it is the user's own text.
  field.value = instructions;
  field.addEventListener('input', () => {
    instructions = field.value.trim();
    savePageState();
  });

  const form = document.getElementById('composeForm');
  form.dataset.primaryLabel = primaryLabel;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const blocked = isPrimaryBlocked();
    if (blocked) {
      runBlockedPrimary(blocked);
      return;
    }
    onOrganize(onPrimary);
  });
  updateKeySection();
}

// Focus lands on what the user does next: the key while one is needed, the
// primary button after an error or an ended run, else the instructions.
function focusCompose({ primary = false } = {}) {
  composeFocusPrimary = primary;
  if (keyNeeded && keyForm) {
    keyForm.keyInput.focus();
  } else if (primary) {
    const start = document.getElementById('startOrganize');
    if (start) start.focus();
  } else {
    const field = document.getElementById('userInstructions');
    if (field) field.focus();
  }
}

function showInstructionsInput() {
  view = 'compose';
  renderCompose();
  focusCompose();
}

function buildNotice(className, role, title, detail) {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('role', role);
  if (title) {
    const heading = document.createElement('p');
    heading.className = 'ended-title';
    heading.textContent = title;
    el.appendChild(heading);
  }
  const text = document.createElement('p');
  text.textContent = detail;
  el.appendChild(text);
  return el;
}

// No run is going for this page any more: it was reloaded, stopped, or the
// worker restarted. The form comes back with the instructions kept.
function showEnded({ title, detail }) {
  view = 'error';
  lastRunFailed = false;
  blockedModel = null;
  blockedBy = null;
  const notice = buildNotice('ended-msg', 'status', title, detail);
  renderCompose({ notice, primaryLabel: 'Run again' });
  announce(`${title}. ${detail}`);
  updateModelBar();
  focusCompose({ primary: true });
}

function showStale() {
  endRun();
  staleWorker = true;
  view = 'stale';
  closeModelPanel({ focusChange: false });
  setActionsVisible(false);
  const content = document.getElementById('content');
  const notice = buildNotice('error-msg', 'alert', null, HuddleAi.STALE_MESSAGE);
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  actions.append(
    buildButton('Reload Huddle', 'btn primary', reloadHuddle, 'reloadHuddle'),
    buildButton('Cancel', 'btn cancel', cancelPage),
  );
  const keys = document.createElement('p');
  keys.className = 'keys-hint';
  keys.innerHTML = `<kbd>${MOD_KEY}</kbd><kbd>↵</kbd> reload `
    + '<span aria-hidden="true">·</span> <kbd>Esc</kbd> close';
  content.replaceChildren(notice, actions, keys);
  updateModelBar();
  document.getElementById('reloadHuddle').focus();
}

// An error from the run, or before one. Its kind decides the way out:
//   key       the key is missing, expired or rejected: the key form
//   model     another model is the fix: Change model (and Retry), or
//             Change model alone when Retry can't work (batch, no endpoint)
//   credits   Add credits, then Retry (and Change model)
//   auth      a 401 Huddle could not pin down: Open Settings (and Retry)
//   no-tabs   Groups mode found nothing: Organize all tabs (Flat)
//   transient, network, none: Retry
// The text can come from the network, so it is set as text, never HTML.
function showError(msg) {
  const kind = msg.kind || 'model';
  view = 'error';
  lastRunFailed = true;
  blockedModel = msg.retryable === false && lastRun ? lastRun.model : null;
  blockedBy = blockedModel ? (kind === 'credits' ? 'credits' : 'model') : null;
  if (msg.needsKey) keyNeeded = msg.needsKey;
  if (msg.needsKey === 'rejected') rejectedKeyMessage = msg.error || '';

  // A key problem goes straight to the key form: its intro says why, once.
  // The model never saw the prompt, so there is nothing to inspect either.
  if (kind === 'key' && msg.needsKey) {
    resetDebugSection();
    renderCompose({ primaryLabel: 'Organize' });
    announce(msg.error);
    updateModelBar();
    focusCompose();
    return;
  }

  const notice = buildNotice('error-msg', 'alert', null, msg.error || 'Something went wrong.');
  const extras = [];
  let primaryLabel = 'Retry';
  let onPrimary = null;
  if (kind === 'no-tabs') {
    primaryLabel = 'Organize all tabs (Flat)';
    onPrimary = () => setRespectGroups(false);
  } else if (kind === 'model' && blockedModel) {
    // Retry can't help: the primary button is Change model (isPrimaryBlocked).
    primaryLabel = 'Organize';
  } else if (kind === 'model') {
    extras.push({ label: 'Change model', onClick: openModelPanel, id: 'changeModelAction' });
  } else if (kind === 'credits') {
    // Add credits leads (isPrimaryBlocked), then the button turns into Retry.
    if (!blockedBy) extras.push({ label: 'Add credits', onClick: openCredits });
    extras.push({ label: 'Change model', onClick: openModelPanel, id: 'changeModelAction' });
  } else if (kind === 'auth' || kind === 'key') {
    extras.push({ label: 'Open Settings', onClick: openSettings });
  }
  renderCompose({ notice, primaryLabel, onPrimary, extras });
  updateModelBar();
  focusCompose({ primary: true });
}

// ---- The inline key form ---------------------------------------------------

function showKeyError(msg) {
  const el = document.getElementById('keyError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function keyIntroText() {
  if (keyNeeded === 'rejected') return rejectedKeyMessage || 'OpenRouter rejected your saved key. Enter a new one to organize.';
  if (keyNeeded === 'expired') return 'Your OpenRouter key has expired. Enter it again to organize.';
  return 'Organize with AI uses your own OpenRouter API key. Add it once and Huddle keeps it for next time.';
}

// Shows the inline key form while a key is needed, and fills its expiry
// choice once the presets have loaded. The primary button waits for the
// config: an empty expiry choice cannot be saved.
function updateKeySection() {
  const section = document.getElementById('keySetup');
  if (!section) return;
  section.hidden = !keyNeeded;
  document.getElementById('keyIntro').textContent = keyIntroText();
  if (keyForm && !keyForm.expirySelect.options.length && expiryPresets.length) {
    const selected = aiConfig && aiConfig.expiryDuration !== undefined ? aiConfig.expiryDuration : 86400000;
    keyForm.setExpiryPresets(expiryPresets, selected);
  }
  const start = document.getElementById('startOrganize');
  const form = document.getElementById('composeForm');
  const label = (form && form.dataset.primaryLabel) || 'Organize';
  const blocked = isPrimaryBlocked();
  start.textContent = keyNeeded ? 'Save key and organize'
    : blocked === 'model' ? 'Change model'
      : blocked === 'credits' ? 'Add credits' : label;
  const keyLabel = document.getElementById('primaryKeyLabel');
  // "organize all tabs (Flat)": only the first letter drops to lower case.
  if (keyLabel) keyLabel.textContent = start.textContent.charAt(0).toLowerCase() + start.textContent.slice(1);
  start.disabled = !configLoaded || (!!keyNeeded && !expiryPresets.length);
}

// The last run failed in a way no retry of the same model can fix yet:
// 'model' or 'credits' (blockedBy), else null.
function isPrimaryBlocked() {
  return !keyNeeded && !!blockedModel && view === 'error' && nextModel() === blockedModel
    ? blockedBy : null;
}

// The primary button while a retry can't work: Change model opens the list;
// Add credits opens OpenRouter's credits page, and the button then says
// Retry, for when the credits are in.
function runBlockedPrimary(blocked) {
  if (blocked === 'credits') {
    openCredits();
    blockedModel = null;
    blockedBy = null;
    updateKeySection();
    // The same focused button now reads Retry: a quick second Enter must not
    // send a request that is bound to fail with 402 again.
    runKeyStartedAt = Date.now();
    armEnterGuard();
    return;
  }
  openModelPanel();
}

// With a key needed, the primary button first runs the key checks
// (OpenRouter's too) and saves it, then starts the run here. The default
// model is left alone. beforeRun() adjusts the run (Flat).
async function onOrganize(beforeRun) {
  if (run) return;
  readInstructionsField();
  if (!keyNeeded) {
    if (beforeRun) beforeRun();
    startRun();
    return;
  }

  const start = document.getElementById('startOrganize');
  showKeyError('');
  start.disabled = true;
  const result = await keyForm.collect();
  if (!result.ok) {
    start.disabled = false;
    showKeyError(result.error);
    keyForm.keyInput.focus();
    return;
  }

  let response;
  try {
    response = await HuddleAi.request({
      action: 'saveAiConfig',
      config: { key: result.key, expiryDuration: result.expiryDuration, renew: result.newKey },
    });
  } catch (err) {
    if (err.stale) {
      showStale();
      return;
    }
    response = { success: false, error: err.message };
  }
  if (!response || !response.success) {
    start.disabled = false;
    showKeyError((response && response.error) || 'Failed to save the key.');
    return;
  }

  aiConfig = response.config || aiConfig;
  keyNeeded = null;
  rejectedKeyMessage = '';
  keyForm.clear();
  updateModelBar();
  if (beforeRun) beforeRun();
  startRun();
}

// ---- Proposal ----------------------------------------------------------------

// Shown above the proposal: an Apply that failed (the proposal stays to
// adjust and apply again), or what Apply left out.
function showApplyNotice(msg, { error = true } = {}) {
  let el = document.getElementById('applyError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'applyError';
    const content = document.getElementById('content');
    content.parentNode.insertBefore(el, content);
  }
  el.className = error ? 'error-msg apply-error' : 'ended-msg apply-error';
  // An error is an alert; anything else is read out once, through
  // announce() below, so the notice itself isn't a second live region.
  if (error) el.setAttribute('role', 'alert');
  else el.removeAttribute('role');
  el.textContent = msg;
  el.hidden = false;
  // Replaces "Proposal ready".
  if (!error) announce(msg);
}

function hideApplyNotice() {
  const el = document.getElementById('applyError');
  if (el) el.hidden = true;
}

function getTabMeta(tabId) {
  return tabMap[tabId] || { id: tabId, title: '(unknown)', url: '', favIconUrl: '' };
}

function showProposal(msg) {
  view = 'proposal';
  hadProposal = true;
  savePageState();
  lastRunFailed = false;
  leftOutTabs = 0;
  // Copied: the page edits its proposal in place.
  proposal = {
    groups: (msg.groups || []).map((g) => ({ ...g, tabIds: [...(g.tabIds || [])] })),
    ungroupedTabIds: [...(msg.ungroupedTabIds || [])],
    tabs: msg.tabs || [],
    windowId: msg.windowId,
  };
  if (msg.model) lastRun = { model: msg.model, modelName: msg.modelName || msg.model };
  if (typeof msg.respectGroups === 'boolean') respectGroups = msg.respectGroups;
  // The mode Apply sends, whatever the popup's O says later.
  proposal.respectGroups = respectGroups;
  tabMap = {};
  for (const t of proposal.tabs) {
    tabMap[t.id] = t;
  }
  focusApplyOnRender = true;
  render();
  updateModelBar();
  // The raw output folds away now that the proposal is readable.
  if (document.getElementById('debugToggle')) setDebugOpen(false);
  const grouped = proposal.groups.reduce((n, g) => n + g.tabIds.length, 0);
  announce(`Proposal ready: ${groupCountLabel(proposal.groups.length)}, ${tabCountLabel(grouped)}.`);
}

function groupCountLabel(n) {
  return n + (n === 1 ? ' group' : ' groups');
}

function leftOutText(n) {
  return n === 1
    ? '1 proposed tab was closed, moved or pinned, so it was left out.'
    : `${n} proposed tabs were closed, moved or pinned, so they were left out.`;
}

// A tab that is gone from this window is taken out of the proposal on
// screen, and the page says so. A group it leaves empty goes too (a group
// the user emptied stays, to move tabs back into). With nothing left, the
// proposal becomes an error that offers Run again.
function dropProposedTab(tabId) {
  if (view !== 'proposal' || !proposal) return;
  const had = proposal.ungroupedTabIds.includes(tabId)
    || proposal.groups.some((g) => g.tabIds.includes(tabId));
  if (!had) return;
  leftOutTabs += 1;
  proposal.ungroupedTabIds = proposal.ungroupedTabIds.filter((id) => id !== tabId);
  proposal.groups = proposal.groups.filter((g) => {
    if (!g.tabIds.includes(tabId)) return true;
    g.tabIds = g.tabIds.filter((id) => id !== tabId);
    return g.tabIds.length > 0;
  });
  const left = proposal.ungroupedTabIds.length
    + proposal.groups.reduce((n, g) => n + g.tabIds.length, 0);
  if (left === 0) {
    showNothingLeft();
    return;
  }
  render();
  showApplyNotice(leftOutText(leftOutTabs).replace('left out', 'taken out of the proposal'), { error: false });
}

function showNothingLeft() {
  view = 'error';
  proposal = null;
  lastRunFailed = false;
  blockedModel = null;
  blockedBy = null;
  hideApplyNotice();
  const notice = buildNotice('error-msg', 'alert', null,
    'Every tab in this proposal was closed or moved to another window, so there is nothing left to apply. Run again for a new proposal.');
  renderCompose({ notice, primaryLabel: 'Run again' });
  updateModelBar();
  focusCompose({ primary: true });
}

// A group's name, or a stand-in while the user has cleared it.
function groupLabel(group, i) {
  return group.name || `Unnamed group ${i + 1}`;
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
    opt.textContent = groupLabel(g, i);
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

function setGroupColor(groupIndex, name) {
  proposal.groups[groupIndex].color = name;
  render(`dot-${groupIndex}-${name}`);
}

// The nine colours as one radio group: one Tab stop (the chosen colour),
// arrow keys move through the colours.
function renderColorPicker(groupIndex) {
  const group = proposal.groups[groupIndex];
  const container = document.createElement('div');
  container.className = 'color-select';
  container.setAttribute('role', 'radiogroup');
  container.setAttribute('aria-label', `Colour for ${groupLabel(group, groupIndex)}`);

  for (const [name, label] of Object.entries(COLOR_MAP)) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot';
    const active = group.color === name;
    if (active) dot.classList.add('active');
    dot.dataset.group = name;
    dot.setAttribute('role', 'radio');
    dot.setAttribute('aria-label', label);
    dot.setAttribute('aria-checked', String(active));
    dot.tabIndex = active ? 0 : -1;
    dot.title = label;
    dot.dataset.focusKey = `dot-${groupIndex}-${name}`;
    dot.innerHTML = CHECK_ICON;
    dot.addEventListener('click', () => setGroupColor(groupIndex, name));
    container.appendChild(dot);
  }

  container.addEventListener('keydown', (e) => {
    const current = COLOR_NAMES.indexOf(proposal.groups[groupIndex].color);
    const last = COLOR_NAMES.length - 1;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = current >= last ? 0 : current + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = current <= 0 ? last : current - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    setGroupColor(groupIndex, COLOR_NAMES[next]);
  });

  return container;
}

function renderTabRow(tabId, groupIndex) {
  const meta = getTabMeta(tabId);
  const row = document.createElement('li');
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
  // Both lines can be cut off: the tooltip has them in full.
  info.title = `${meta.title}\n${meta.url}`;

  row.appendChild(favicon);
  row.appendChild(info);
  row.appendChild(buildMoveSelect(tabId, groupIndex));
  return row;
}

function renderGroup(group, groupIndex) {
  const card = document.createElement('div');
  card.className = 'group-card';
  card.dataset.group = group.color;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `Group ${groupLabel(group, groupIndex)}, ${tabCountLabel(group.tabIds.length)}`);

  const header = document.createElement('div');
  header.className = 'group-header';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'group-name';
  nameInput.value = group.name;
  nameInput.maxLength = 40;
  nameInput.setAttribute('aria-label', `Name of group ${groupIndex + 1}`);
  nameInput.dataset.focusKey = `name-${groupIndex}`;
  nameInput.addEventListener('change', () => {
    proposal.groups[groupIndex].name = nameInput.value.trim().slice(0, 40);
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

  if (group.tabIds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'group-empty';
    empty.textContent = 'No tabs. Apply skips this group.';
    card.appendChild(empty);
    return card;
  }
  const tabList = document.createElement('ul');
  tabList.className = 'tab-list';
  for (const tabId of group.tabIds) tabList.appendChild(renderTabRow(tabId, groupIndex));
  card.appendChild(tabList);
  return card;
}

function renderUngrouped() {
  if (proposal.ungroupedTabIds.length === 0) return null;

  const card = document.createElement('div');
  card.className = 'group-card ungrouped';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `Ungrouped, ${tabCountLabel(proposal.ungroupedTabIds.length)}`);

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

  const tabList = document.createElement('ul');
  tabList.className = 'tab-list';
  for (const tabId of proposal.ungroupedTabIds) tabList.appendChild(renderTabRow(tabId, -1));
  card.appendChild(tabList);
  return card;
}

// The proposal's heading line and the instructions Run again will use.
function renderProposalHead() {
  const frag = document.createDocumentFragment();
  const grouped = proposal.groups.reduce((n, g) => n + g.tabIds.length, 0);
  const filled = proposal.groups.filter((g) => g.tabIds.length > 0).length;
  const head = document.createElement('p');
  head.className = 'proposal-head';
  const from = lastRun && lastRun.modelName ? ` from <strong>${escapeHtml(lastRun.modelName)}</strong>` : '';
  head.innerHTML = `Proposal${from} · ${groupCountLabel(filled)}, ${tabCountLabel(grouped)}`;
  frag.appendChild(head);
  if (filled === 0) {
    // Apply is disabled; say why where it can be read, not only on hover.
    const why = document.createElement('p');
    why.className = 'proposal-warn';
    why.id = 'applyBlocked';
    why.textContent = 'No tab is in a group, so there is nothing to apply. Move a tab into a group, or Run again for a new proposal.';
    frag.appendChild(why);
  }

  const details = document.createElement('details');
  details.className = 'next-run';
  details.id = 'nextRun';
  const summary = document.createElement('summary');
  summary.innerHTML = 'Instructions for Run again: <span class="summary-text"></span>';
  summary.querySelector('.summary-text').textContent = instructions ? `"${instructions}"` : 'none';
  const field = document.createElement('textarea');
  field.id = 'userInstructions';
  field.rows = 2;
  field.value = instructions;
  field.setAttribute('aria-label', 'Instructions for Run again');
  field.dataset.focusKey = 'instructions';
  field.placeholder = 'Leave blank for default grouping';
  field.addEventListener('input', () => {
    instructions = field.value.trim();
    summary.querySelector('.summary-text').textContent = instructions ? `"${instructions}"` : 'none';
    savePageState();
  });
  details.append(summary, field);
  frag.appendChild(details);
  return frag;
}

// Re-rendering replaces every control, so the focused one (a colour dot, a
// move select, a name input) is found again by its focus key afterwards. A
// new proposal puts focus on Apply.
function render(focusOverride = null) {
  const content = document.getElementById('content');
  const active = document.activeElement;
  const focusKey = focusOverride
    || (active && content.contains(active) ? active.dataset.focusKey : null);
  const nextRunOpen = !!(document.getElementById('nextRun') && document.getElementById('nextRun').open);
  content.innerHTML = '';

  content.appendChild(renderProposalHead());
  if (nextRunOpen) document.getElementById('nextRun').open = true;
  for (let i = 0; i < proposal.groups.length; i++) {
    content.appendChild(renderGroup(proposal.groups[i], i));
  }

  const ungrouped = renderUngrouped();
  if (ungrouped) content.appendChild(ungrouped);

  setActionsVisible(true);
  const apply = document.getElementById('applyButton');
  const anyGrouped = proposal.groups.some((g) => g.tabIds.length > 0);
  apply.disabled = !anyGrouped;
  if (anyGrouped) apply.removeAttribute('aria-describedby');
  else apply.setAttribute('aria-describedby', 'applyBlocked');

  if (focusKey) {
    const target = content.querySelector(`[data-focus-key="${focusKey}"]`);
    if (target) target.focus();
  } else if (focusApplyOnRender && apply) {
    apply.focus();
  }
  focusApplyOnRender = false;
}

function setupActionButtons() {
  const applyButton = document.getElementById('applyButton');
  if (!applyButton) return;
  applyButton.addEventListener('click', () => {
    if (!proposal || applyButton.disabled) return;
    const groupsToApply = proposal.groups
      .filter(g => g.tabIds.length > 0)
      .map(g => ({ name: g.name, color: g.color, tabIds: g.tabIds }));

    const label = applyButton.textContent;
    applyButton.disabled = true;
    applyButton.textContent = 'Applying…';
    hideApplyNotice();

    // When everything was grouped the background closes this tab. Otherwise
    // the tab stays and says what happened.
    chrome.runtime.sendMessage({
      action: 'applyAiProposal',
      groups: groupsToApply,
      ungroupedTabIds: [...proposal.ungroupedTabIds],
      respectGroups: proposal.respectGroups,
      windowId: proposal.windowId,
      // Tabs the page already took out, so Apply reports them too.
      leftOut: leftOutTabs,
    }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (!lastError && response && response.success) {
        if (response.closing) return;
        setActionsVisible(false);
        const left = response.skipped ? ` ${leftOutText(response.skipped)}` : '';
        showApplyNotice(`Grouped ${tabCountLabel(response.grouped || 0)} into ${groupCountLabel(response.groups || 0)}.${left}`, { error: false });
        const content = document.getElementById('content');
        const close = buildButton('Close', 'btn primary', cancelPage, 'closeAfterApply');
        const actions = document.createElement('div');
        actions.className = 'form-actions';
        actions.appendChild(close);
        content.replaceChildren(actions);
        // Nothing is left to run: the model bar has no job here.
        view = 'applied';
        updateModelBar();
        close.focus();
        return;
      }
      applyButton.disabled = false;
      applyButton.textContent = label;
      // Disabling Apply sent focus to the page: bring it back to apply again.
      applyButton.focus();
      const why = lastError
        ? (HuddleAi.isNoReceiverError(lastError.message) ? HuddleAi.STALE_MESSAGE : lastError.message)
        : (response && response.error) || 'no reply from Huddle';
      showApplyNotice(`Couldn't apply the groups: ${why}`);
    });
  });

  document.getElementById('runAgainButton').addEventListener('click', () => startRun());
  syncProposalActions();
  document.getElementById('cancelButton').addEventListener('click', cancelPage);
}

// ---- Keyboard ----------------------------------------------------------------

// Cmd/Ctrl+Enter does the primary thing on screen (Organize, Retry, Apply,
// or Run again once another model or mode is picked for it, or from the
// instructions for Run again);
// Escape closes the model list (restoring the model), stops a run, undoes
// the edits in a text field (or leaves it), or cancels the page.
function onKeydown(e) {
  if (e.defaultPrevented) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (view === 'proposal') {
      if (nextRunDiffers() || (e.target.closest && e.target.closest('#nextRun'))) {
        startRun();
        return;
      }
      const apply = document.getElementById('applyButton');
      if (apply && !apply.disabled) apply.click();
      return;
    }
    if (view === 'stale') {
      reloadHuddle();
      return;
    }
    const form = document.getElementById('composeForm');
    const start = document.getElementById('startOrganize');
    if (form && start && !start.disabled) form.requestSubmit(start);
  } else if (e.key === 'Escape') {
    const panel = document.getElementById('modelPanel');
    e.preventDefault();
    if (panel && !panel.hidden) {
      closeModelPanel({ revert: true });
    } else if (run) {
      stopRun();
    } else if (isTextField(e.target)) {
      // The first Escape puts back the value the field had on focus and
      // leaves the field; the next one closes the page.
      if (e.target.value !== fieldValueOnFocus) {
        e.target.value = fieldValueOnFocus;
        if (e.target.tagName === 'TEXTAREA') e.target.dispatchEvent(new Event('input'));
      }
      e.target.blur();
    } else {
      cancelPage();
    }
  }
}

function isTextField(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

// Records the value a text field had when it took focus, for Escape.
function onFocusIn(e) {
  if (isTextField(e.target)) fieldValueOnFocus = e.target.value;
}

// Runs first (capture), before any button or form sees the key.
function guardEnter(e) {
  if (e.key !== 'Enter') return;
  const now = Date.now();
  if (!run && enterGuardEl && document.activeElement === enterGuardEl
    && now - runKeyStartedAt < ENTER_GUARD_MS) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  lastEnterAt = now;
}

// ---- Start-up ------------------------------------------------------------------

// A reload drops the page's run (its port closes with the old page).
function wasReloaded() {
  try {
    const [nav] = window.performance.getEntriesByType('navigation');
    return !!nav && nav.type === 'reload';
  } catch (_e) {
    return false;
  }
}

function init() {
  if (!document.getElementById('modelBar')) return;
  const saved = loadPageState();
  instructions = typeof saved.instructions === 'string' ? saved.instructions : '';
  explicitModel = typeof saved.explicitModel === 'string' ? saved.explicitModel : null;
  hadRun = !!saved.hadRun;
  hadProposal = !!saved.hadProposal;
  if (typeof saved.respectGroups === 'boolean' && wasReloaded()) respectGroups = saved.respectGroups;

  setupDebugToggle();
  setupActionButtons();
  setupModelBar();
  window.addEventListener('keydown', guardEnter, true);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('focusin', onFocusIn);
  if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener(onStorageChanged);
  // A proposed tab closed or moved to another window leaves the proposal.
  if (chrome.tabs && chrome.tabs.onRemoved) chrome.tabs.onRemoved.addListener(dropProposedTab);
  if (chrome.tabs && chrome.tabs.onDetached) chrome.tabs.onDetached.addListener(dropProposedTab);
  // The popup's O on an already open organize page brings its mode along.
  // It comes from the worker (tabs.sendMessage), which has no tab; a content
  // script's runtime.sendMessage reaches this page too, with its tab.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender && sender.tab) return;
    if (msg && msg.type === 'ai-set-mode' && !run && typeof msg.respectGroups === 'boolean') {
      setRespectGroups(msg.respectGroups);
    }
  });

  if (wasReloaded() && hadRun) {
    const what = hadProposal
      ? 'Reloading the page cleared the proposal that was on screen.'
      : 'The page was reloaded, so Huddle is no longer working on it.';
    showEnded({
      title: hadProposal ? 'The proposal is gone' : 'This run has ended',
      detail: instructions
        ? `${what} Your instructions are kept: run it again for a fresh proposal.`
        : `${what} Run it again for a fresh proposal.`,
    });
  } else {
    showInstructionsInput();
  }
  updateModelBar();
  loadPageConfig();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
