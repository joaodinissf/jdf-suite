/* global HuddleAi */
// Huddle Settings — options page controller.
// Reads and writes clumping preferences via chrome.storage.sync, and holds
// the lasting AI setup (key, expiry, default model) through the background.

const CLUMPING_DEFAULTS = {
  enabled: true,
  key: 'z',
  modifier: null,
};

// Allowed keys for the activation-key dropdown. A–Z and 0–9 covers the
// overwhelming majority of conflict-free single-press bindings without
// opening the can-of-worms of punctuation / function-key handling.
function getAllowedKeys() {
  const keys = [];
  for (let i = 97; i <= 122; i++) keys.push(String.fromCharCode(i)); // a..z
  for (let i = 48; i <= 57; i++) keys.push(String.fromCharCode(i)); // 0..9
  return keys;
}

function applyDefaults(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof c.enabled === 'boolean' ? c.enabled : CLUMPING_DEFAULTS.enabled,
    key: typeof c.key === 'string' && c.key.length === 1 ? c.key.toLowerCase() : CLUMPING_DEFAULTS.key,
    modifier: c.modifier === 'shift' || c.modifier === 'ctrl' || c.modifier === 'alt' ? c.modifier : CLUMPING_DEFAULTS.modifier,
  };
}

function loadClumpingSettings() {
  return new Promise((resolve) => {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      resolve({ ...CLUMPING_DEFAULTS });
      return;
    }
    chrome.storage.sync.get(['clumping'], (result) => {
      resolve(applyDefaults(result && result.clumping));
    });
  });
}

function saveClumpingSettings(settings) {
  return new Promise((resolve, reject) => {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      reject(new Error('chrome.storage.sync is unavailable'));
      return;
    }
    const payload = applyDefaults(settings);
    chrome.storage.sync.set({ clumping: payload }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(payload);
      }
    });
  });
}

function populateKeyDropdown(selectEl, selected) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  for (const key of getAllowedKeys()) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key.toUpperCase();
    if (key === selected) option.selected = true;
    selectEl.appendChild(option);
  }
}

function readFormState() {
  const enabledEl = document.getElementById('clumping-enabled');
  const keyEl = document.getElementById('clumping-key');
  const modifierEl = document.getElementById('clumping-modifier');
  return applyDefaults({
    enabled: enabledEl ? enabledEl.checked : CLUMPING_DEFAULTS.enabled,
    key: keyEl ? keyEl.value : CLUMPING_DEFAULTS.key,
    modifier: modifierEl && modifierEl.value ? modifierEl.value : null,
  });
}

function writeFormState(settings) {
  const applied = applyDefaults(settings);
  const enabledEl = document.getElementById('clumping-enabled');
  const keyEl = document.getElementById('clumping-key');
  const modifierEl = document.getElementById('clumping-modifier');
  if (enabledEl) enabledEl.checked = applied.enabled;
  if (keyEl) populateKeyDropdown(keyEl, applied.key);
  if (modifierEl) modifierEl.value = applied.modifier || '';
}

const statusHideTimers = {};

// Success messages fade after 1.8s; errors, and progress (fade: false), stay
// until the next message. Each call cancels the previous fade so a quick
// second save is not hidden early.
function showStatus(message, { error = false, fade = !error, target = 'clumping-status' } = {}) {
  const statusEl = document.getElementById(target);
  if (!statusEl) return;
  clearTimeout(statusHideTimers[target]);
  statusHideTimers[target] = null;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', error);
  statusEl.classList.add('visible');
  if (fade) {
    statusHideTimers[target] = setTimeout(() => {
      statusEl.classList.remove('visible');
      // Emptied after the fade, so the line gives its room back.
      statusHideTimers[target] = setTimeout(() => { statusEl.textContent = ''; }, 350);
    }, 1800);
  }
}

// Empties a status line at once, so an earlier "Saved" never sits next to a
// new error.
function clearStatus(target) {
  const statusEl = document.getElementById(target);
  if (!statusEl) return;
  clearTimeout(statusHideTimers[target]);
  statusHideTimers[target] = null;
  statusEl.classList.remove('visible', 'error');
  statusEl.textContent = '';
}

async function handleFormChange() {
  try {
    const saved = await saveClumpingSettings(readFormState());
    showStatus(`Saved · key "${saved.key.toUpperCase()}"${saved.modifier ? ' + ' + saved.modifier : ''}, ${saved.enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    showStatus(`Error: ${err.message}`, { error: true });
  }
}

// ---- AI ------------------------------------------------------------------

// The stored AI config ({ key, model, expiresAt, expiryDuration }) or null.
let aiConfig = null;
let aiBuiltInDefault = null;
let aiKeyForm = null;
let aiModelPicker = null;
// An id the catalog does not list, which a second Save keeps anyway.
let aiUnlistedConfirm = null;

// Each error belongs to a field: while it shows, the field is invalid and
// described by it, so a screen reader reads it there.
const AI_ERROR_FIELDS = { aiKeyError: 'settingsKeyInput', aiModelError: 'settingsCustom' };

function showAiError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  const field = document.getElementById(AI_ERROR_FIELDS[id]);
  if (!field) return;
  if (msg) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', id);
  } else {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }
}

function renderAiKeyState() {
  const status = document.getElementById('aiKeyStatus');
  const state = HuddleAi.keyState(aiConfig);
  if (status) {
    status.textContent = HuddleAi.keyStatusLabel(aiConfig);
    status.classList.toggle('expired', state === 'expired');
  }
  const hasKey = !!(aiConfig && aiConfig.key);
  document.getElementById('aiDeleteKey').hidden = !hasKey;
  document.getElementById('aiConfirmDelete').hidden = true;
  document.getElementById('aiSaveKey').textContent = hasKey ? 'Save' : 'Save key';
  // A usable key can stay, so the expiry alone can change. An expired key
  // cannot be kept (the background has already removed it).
  aiKeyForm.setKeepHint(hasKey && state === null
    ? 'Leave the key blank to keep the one on file and only change when it expires.'
    : null);
}

// Replace the key or change its expiry: the same checks as the organize
// page's key form, OpenRouter's included. The default model is left alone.
// While it checks, Save is aria-disabled, not disabled, so focus stays on it;
// a second press meanwhile does nothing.
async function saveAiKey() {
  const button = document.getElementById('aiSaveKey');
  if (button.getAttribute('aria-disabled') === 'true') return;
  showAiError('aiKeyError', '');
  button.setAttribute('aria-disabled', 'true');
  // Only a newly typed key is checked; an expiry-only save isn't.
  if (document.getElementById('settingsKeyInput').value.trim()) {
    showStatus('Checking the key with OpenRouter…', { target: 'ai-status', fade: false });
  }
  const result = await aiKeyForm.collect({ storedConfig: aiConfig, allowKeep: true });
  if (!result.ok) {
    button.removeAttribute('aria-disabled');
    clearStatus('ai-status');
    showAiError('aiKeyError', result.error);
    return;
  }
  let response;
  try {
    response = await HuddleAi.request({
      action: 'saveAiConfig',
      // A newly typed key restarts its countdown, even if it is the same key.
      config: { key: result.key, expiryDuration: result.expiryDuration, renew: result.newKey },
    });
  } catch (err) {
    response = { success: false, error: err.message };
  }
  button.removeAttribute('aria-disabled');
  if (!response || !response.success) {
    clearStatus('ai-status');
    showAiError('aiKeyError', (response && response.error) || 'Failed to save configuration.');
    return;
  }
  aiConfig = response.config || aiConfig;
  aiKeyForm.clear();
  renderAiKeyState();
  showStatus(result.newKey ? 'Key saved' : 'Expiry saved', { target: 'ai-status' });
}

// Delete asks first, in place: the key has to be pasted again from
// OpenRouter to undo it.
function askDeleteAiKey() {
  clearStatus('ai-status');
  document.getElementById('aiDeleteKey').hidden = true;
  document.getElementById('aiConfirmDelete').hidden = false;
  document.getElementById('aiConfirmDeleteNo').focus();
}

function keepAiKey() {
  document.getElementById('aiConfirmDelete').hidden = true;
  document.getElementById('aiDeleteKey').hidden = false;
  document.getElementById('aiDeleteKey').focus();
}

async function deleteAiKey() {
  showAiError('aiKeyError', '');
  let response;
  try {
    response = await HuddleAi.request({ action: 'deleteAiKey' });
  } catch (err) {
    response = { success: false, error: err.message };
  }
  if (!response || !response.success) {
    keepAiKey();
    showAiError('aiKeyError', `Couldn't delete the key: ${(response && response.error) || 'no reply from Huddle'}`);
    return;
  }
  aiConfig = response.config || null;
  renderAiKeyState();
  showStatus('Key deleted', { target: 'ai-status' });
  aiKeyForm.keyInput.focus();
}

async function saveAiDefaultModel() {
  showAiError('aiModelError', '');
  const model = aiModelPicker.getModelId();
  if (!model) {
    showAiError('aiModelError', 'Please choose a model or enter a model id.');
    return;
  }
  const allowUnlisted = aiUnlistedConfirm === model;
  let response;
  try {
    response = await HuddleAi.request({
      action: 'saveAiDefaultModel', model, allowUnlisted,
      denyDataCollection: document.getElementById('aiDenyDataCollection').checked,
    });
  } catch (err) {
    response = { success: false, error: err.message };
  }
  if (!response || !response.success) {
    if (response && response.unlisted) {
      aiUnlistedConfirm = model;
      showAiError('aiModelError', `${response.error} Check the id; Save again to keep it anyway.`);
    } else {
      showAiError('aiModelError', (response && response.error) || 'Failed to save the default model.');
    }
    return;
  }
  aiUnlistedConfirm = null;
  aiConfig = response.config || aiConfig;
  renderAiDefaultNote();
  showStatus(`Default model: ${aiModelPicker.modelName(model)}`, { target: 'ai-model-status' });
}

// When the catalog no longer lists the default, organize runs with the first
// recommended model it does list: the picker shows that one, and a note
// says so until another default is saved. Returns the model to show.
function renderAiDefaultNote() {
  const resolved = HuddleAi.resolveDefaultModel(aiConfig, aiBuiltInDefault, aiModelPicker);
  const note = document.getElementById('aiDefaultNote');
  if (note) {
    const text = HuddleAi.defaultFallbackNote(resolved, aiModelPicker);
    note.textContent = text ? `${text} Save a default model to keep one.` : '';
    note.hidden = !text;
  }
  return resolved.model;
}

// Another page (the organize page's key form or Make default) changed it.
function onAiStorageChanged(changes, area) {
  if (area !== 'local' || !changes.aiConfig || !aiKeyForm) return;
  const before = aiConfig && aiConfig.model;
  aiConfig = changes.aiConfig.newValue || null;
  renderAiKeyState();
  const shown = renderAiDefaultNote();
  const after = (aiConfig && aiConfig.model) || aiBuiltInDefault;
  if (after !== before && aiModelPicker) aiModelPicker.setModelId(shown);
}

// Buttons stay off until the config has loaded: an empty expiry select would
// otherwise send no duration at all. With a key on file the catalog loads on
// its own after; without one, OpenRouter is contacted only once the model
// list is used (focus in the filter, the list or the model id field).
async function initAiSection() {
  if (!document.getElementById('aiSection')) return;
  aiKeyForm = HuddleAi.createKeyForm(document.getElementById('aiKeyForm'), {
    idPrefix: 'settings',
    keyLabel: 'OpenRouter API key',
  });
  aiModelPicker = HuddleAi.createModelPicker(document.getElementById('aiModelPicker'), {
    idPrefix: 'settings',
    onChange: () => { aiUnlistedConfirm = null; showAiError('aiModelError', ''); renderAiDefaultNote(); },
    // Enter in the filter, the list or the id field saves, as Save does.
    onCommit: () => document.getElementById('aiModelCard').requestSubmit(),
  });
  document.getElementById('aiKeyCard').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAiKey();
  });
  document.getElementById('aiModelCard').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAiDefaultModel();
  });
  document.getElementById('aiDeleteKey').addEventListener('click', askDeleteAiKey);
  document.getElementById('aiConfirmDeleteYes').addEventListener('click', deleteAiKey);
  document.getElementById('aiConfirmDeleteNo').addEventListener('click', keepAiKey);
  if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener(onAiStorageChanged);

  let data;
  try {
    data = await HuddleAi.request({ action: 'loadAiConfig' });
  } catch (err) {
    document.getElementById('aiKeyStatus').textContent = `Couldn't load: ${err.message}`;
    return;
  }
  data = data || {};
  // Storage could not be read: say so rather than claim there is no key, and
  // leave the buttons off so nothing is saved over a config we never saw.
  if (data.error) {
    document.getElementById('aiKeyStatus').textContent = `Couldn't read your key status: ${data.error}`;
    return;
  }
  aiConfig = data.config || null;
  aiBuiltInDefault = data.defaultModel || null;
  aiKeyForm.setExpiryPresets(data.expiryPresets || [],
    aiConfig && aiConfig.expiryDuration !== undefined ? aiConfig.expiryDuration : 86400000);
  renderAiKeyState();
  document.getElementById('aiSaveKey').disabled = false;
  document.getElementById('aiSaveModel').disabled = false;
  document.getElementById('aiDenyDataCollection').checked = !(aiConfig && aiConfig.denyDataCollection === false);
  aiModelPicker.setModelId((aiConfig && aiConfig.model) || aiBuiltInDefault);
  const loadCatalog = async () => {
    await aiModelPicker.load();
    const shown = renderAiDefaultNote();
    if (shown && shown !== ((aiConfig && aiConfig.model) || aiBuiltInDefault)) aiModelPicker.setModelId(shown);
  };
  if (aiConfig && aiConfig.key) {
    await loadCatalog();
  } else {
    aiModelPicker.showRecommended(data.models);
    document.getElementById('aiModelPicker').addEventListener('focusin', loadCatalog, { once: true });
  }
}

async function init() {
  initAiSection();
  const settings = await loadClumpingSettings();
  writeFormState(settings);
  const enabledEl = document.getElementById('clumping-enabled');
  const keyEl = document.getElementById('clumping-key');
  const modifierEl = document.getElementById('clumping-modifier');
  if (enabledEl) enabledEl.addEventListener('change', handleFormChange);
  if (keyEl) keyEl.addEventListener('change', handleFormChange);
  if (modifierEl) modifierEl.addEventListener('change', handleFormChange);
}

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  init();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
