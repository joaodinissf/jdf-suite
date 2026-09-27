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

// Success messages fade after 1.8s; errors stay until the next successful save.
// Each call cancels the previous fade so a quick second save is not hidden early.
function showStatus(message, { error = false, target = 'clumping-status' } = {}) {
  const statusEl = document.getElementById(target);
  if (!statusEl) return;
  clearTimeout(statusHideTimers[target]);
  statusHideTimers[target] = null;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', error);
  statusEl.classList.add('visible');
  if (!error) {
    statusHideTimers[target] = setTimeout(() => statusEl.classList.remove('visible'), 1800);
  }
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

function showAiError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function renderAiKeyState() {
  const status = document.getElementById('aiKeyStatus');
  if (status) status.textContent = HuddleAi.keyStatusLabel(aiConfig);
  const hasKey = !!(aiConfig && aiConfig.key);
  const expired = HuddleAi.isStoredKeyExpired(aiConfig);
  document.getElementById('aiDeleteKey').hidden = !hasKey;
  document.getElementById('aiSaveKey').textContent = hasKey ? 'Save' : 'Save key';
  // A usable key can stay, so the expiry alone can change. An expired key
  // cannot be kept.
  aiKeyForm.setKeepHint(hasKey && !expired
    ? 'Leave the key blank to keep the one on file and only change when it expires.'
    : null);
}

// Replace the key or change its expiry: the same checks as the organize
// page's key form, OpenRouter's included. The default model is left alone.
async function saveAiKey() {
  const button = document.getElementById('aiSaveKey');
  showAiError('aiKeyError', '');
  button.disabled = true;
  const result = await aiKeyForm.collect({ storedConfig: aiConfig, allowKeep: true });
  if (!result.ok) {
    button.disabled = false;
    showAiError('aiKeyError', result.error);
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
  button.disabled = false;
  if (!response || !response.success) {
    showAiError('aiKeyError', (response && response.error) || 'Failed to save configuration.');
    return;
  }
  aiConfig = response.config || aiConfig;
  aiKeyForm.clear();
  renderAiKeyState();
  showStatus(result.newKey ? 'Key saved' : 'Expiry saved', { target: 'ai-status' });
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
    showAiError('aiKeyError', `Couldn't delete the key: ${(response && response.error) || 'no reply from Huddle'}`);
    return;
  }
  aiConfig = response.config || null;
  renderAiKeyState();
  showStatus('Key deleted', { target: 'ai-status' });
}

async function saveAiDefaultModel() {
  showAiError('aiModelError', '');
  const model = aiModelPicker.getModelId();
  if (!model) {
    showAiError('aiModelError', 'Please choose a model or enter a custom model id.');
    return;
  }
  let response;
  try {
    response = await HuddleAi.request({ action: 'saveAiDefaultModel', model });
  } catch (err) {
    response = { success: false, error: err.message };
  }
  if (!response || !response.success) {
    showAiError('aiModelError', (response && response.error) || 'Failed to save the default model.');
    return;
  }
  aiConfig = response.config || aiConfig;
  showStatus(`Default model: ${aiModelPicker.modelName(model)}`, { target: 'ai-status' });
}

// Buttons stay off until the config has loaded: an empty expiry select would
// otherwise send no duration at all.
async function initAiSection() {
  if (!document.getElementById('aiSection')) return;
  aiKeyForm = HuddleAi.createKeyForm(document.getElementById('aiKeyForm'), {
    idPrefix: 'settings',
    keyLabel: 'OpenRouter API key',
  });
  aiModelPicker = HuddleAi.createModelPicker(document.getElementById('aiModelPicker'), {
    idPrefix: 'settings',
  });
  document.getElementById('aiSaveKey').addEventListener('click', saveAiKey);
  document.getElementById('aiDeleteKey').addEventListener('click', deleteAiKey);
  document.getElementById('aiSaveModel').addEventListener('click', saveAiDefaultModel);

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
  aiModelPicker.setCatalog(data.models, data.modelsMeta, (aiConfig && aiConfig.model) || aiBuiltInDefault);
  renderAiKeyState();
  document.getElementById('aiSaveKey').disabled = false;
  document.getElementById('aiSaveModel').disabled = false;
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
