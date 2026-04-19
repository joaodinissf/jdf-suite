// Huddle Settings — options page controller.
// Reads and writes clumping preferences via chrome.storage.sync.

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

function showStatus(message) {
  const statusEl = document.getElementById('clumping-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 1800);
}

async function handleFormChange() {
  try {
    const saved = await saveClumpingSettings(readFormState());
    showStatus(`Saved · key "${saved.key.toUpperCase()}"${saved.modifier ? ' + ' + saved.modifier : ''}, ${saved.enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    showStatus(`Error: ${err.message}`);
  }
}

async function init() {
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
