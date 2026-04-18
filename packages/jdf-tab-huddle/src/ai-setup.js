const urlParams = new URLSearchParams(window.location.search);
const pageMode = urlParams.get('mode') || 'setup'; // 'setup', 'edit', or 'expired'

let models = [];
let expiryPresets = [];
let currentConfig = null;

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function populateModels(selectedId) {
  const select = document.getElementById('modelSelect');
  select.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.cost})`;
    if (m.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
  updateModelCost();
}

function populateExpiry(selectedValue) {
  const select = document.getElementById('expirySelect');
  select.innerHTML = '';
  for (const p of expiryPresets) {
    const opt = document.createElement('option');
    opt.value = p.value === null ? 'null' : String(p.value);
    opt.textContent = p.label;
    const match = p.value === null
      ? selectedValue === null
      : p.value === selectedValue;
    if (match) opt.selected = true;
    select.appendChild(opt);
  }
}

function updateModelCost() {
  const select = document.getElementById('modelSelect');
  const model = models.find(m => m.id === select.value);
  document.getElementById('modelCost').textContent = model
    ? `Cost: ${model.cost}`
    : '';
}

function formatTimeRemaining(expiresAt) {
  if (expiresAt === null) return 'Key never expires';
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Key has expired';
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `Key expires in ${days}d ${hours % 24}h`;
  }
  return `Key expires in ${hours}h ${minutes}m`;
}

async function init() {
  // Load config and metadata from background
  const data = await chrome.runtime.sendMessage({ action: 'loadAiConfig' });
  models = data.models || [];
  expiryPresets = data.expiryPresets || [];
  currentConfig = data.config;

  const isEdit = pageMode === 'edit';
  const isExpired = pageMode === 'expired';

  // Page title
  if (isEdit) {
    document.getElementById('pageTitle').textContent = '⚙️ AI Settings';
  }

  // Expired notice
  if (isExpired) {
    document.getElementById('expiredNotice').style.display = 'block';
  }

  // Warning section — collapsed in edit mode
  if (isEdit) {
    const warning = document.getElementById('warningSection');
    warning.classList.add('warning-collapsed');
    warning.querySelector('strong').textContent = '⚠️ Security reminder (click to expand)';
    warning.addEventListener('click', () => {
      warning.classList.toggle('warning-collapsed');
      warning.querySelector('strong').textContent = warning.classList.contains('warning-collapsed')
        ? '⚠️ Security reminder (click to expand)'
        : '⚠️ Important: You are responsible for your API key';
    });
  }

  // Populate dropdowns
  const selectedModel = currentConfig ? currentConfig.model : null;
  const selectedExpiry = currentConfig ? currentConfig.expiryDuration : 86400000;
  populateModels(selectedModel);
  populateExpiry(selectedExpiry);

  // Key status in edit mode
  if (isEdit && currentConfig) {
    document.getElementById('keyStatus').textContent = formatTimeRemaining(currentConfig.expiresAt);
    document.getElementById('apiKeyInput').placeholder = 'Enter new key to overwrite, or leave empty to keep current';
  }

  // Buttons
  if (isEdit) {
    document.getElementById('saveButton').textContent = 'Save';
    document.getElementById('deleteButton').style.display = 'inline-block';
  }

  // Model cost update on change
  document.getElementById('modelSelect').addEventListener('change', updateModelCost);
}

function setupEventListeners() {
  // Key visibility toggle
  document.getElementById('keyToggle').addEventListener('click', () => {
    const input = document.getElementById('apiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Save
  document.getElementById('saveButton').addEventListener('click', async () => {
    hideError();
    const keyInput = document.getElementById('apiKeyInput').value.trim();
    const model = document.getElementById('modelSelect').value;
    const expiryRaw = document.getElementById('expirySelect').value;
    const expiryDuration = expiryRaw === 'null' ? null : parseInt(expiryRaw);

    // In edit mode, key is optional (keeps current)
    const isEdit = pageMode === 'edit';
    if (!isEdit && !keyInput) {
      showError('Please enter your OpenRouter API key.');
      return;
    }

    // Determine the actual key to save
    let keyToSave = keyInput;
    if (isEdit && !keyInput && currentConfig && currentConfig.key) {
      // Decode the existing key so saveAiConfig can re-encode it
      try {
        keyToSave = atob(currentConfig.key);
      } catch (_e) {
        showError('Could not read existing key. Please enter a new one.');
        return;
      }
    }

    if (!keyToSave) {
      showError('Please enter your OpenRouter API key.');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'saveAiConfig',
      config: { key: keyToSave, model, expiryDuration },
    });

    if (!response.success) {
      showError(response.error || 'Failed to save configuration.');
      return;
    }

    if (!isEdit) {
      // First-time setup → trigger AI grouping immediately
      chrome.runtime.sendMessage({ action: 'aiGroupTabs' });
    }

    // Close this tab
    window.close();
  });

  // Cancel
  document.getElementById('cancelButton').addEventListener('click', () => {
    window.close();
  });

  // Delete
  document.getElementById('deleteButton').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'deleteAiConfig' });
    window.close();
  });
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
