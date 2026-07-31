const urlParams = new URLSearchParams(window.location.search);
const pageMode = urlParams.get('mode') || 'setup'; // 'setup', 'edit', or 'expired'

let models = [];
let expiryPresets = [];
let currentConfig = null;
let modelsMeta = null;

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function getSelectedModelId() {
  const custom = (document.getElementById('customModelId')?.value || '').trim();
  if (custom) return custom;
  return document.getElementById('modelSelect')?.value || '';
}

function findModel(id) {
  if (!id) return null;
  return models.find((m) => m.id === id) || null;
}

function populateModels(selectedId, filterText) {
  const select = document.getElementById('modelSelect');
  if (!select) return;

  const previous = selectedId != null
    ? selectedId
    : (select.value || (currentConfig && currentConfig.model) || '');
  const filter = (filterText != null
    ? filterText
    : (document.getElementById('modelFilter')?.value || '')
  ).trim().toLowerCase();

  select.innerHTML = '';

  const matches = (m) => {
    if (!filter) return true;
    return (m.id && m.id.toLowerCase().includes(filter))
      || (m.name && m.name.toLowerCase().includes(filter));
  };

  const recommended = models.filter((m) => m.curated && matches(m));
  const rest = models.filter((m) => !m.curated && matches(m));

  function addGroup(label, list) {
    if (!list.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const m of list) {
      const opt = document.createElement('option');
      opt.value = m.id;
      const schemaMark = m.supportsStructuredOutputs ? ' · schema' : '';
      opt.textContent = `${m.name} (${m.cost})${schemaMark}`;
      opt.dataset.supportsSchema = m.supportsStructuredOutputs ? '1' : '0';
      if (m.id === previous) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  addGroup('Recommended', recommended);
  addGroup('All models', rest);

  // Keep the currently selected / saved id visible even if filtered out or absent from catalog.
  const hasPrevious = previous
    && Array.from(select.options).some((o) => o.value === previous);
  if (previous && !hasPrevious) {
    const opt = document.createElement('option');
    opt.value = previous;
    const known = findModel(previous);
    opt.textContent = known
      ? `${known.name} (${known.cost})`
      : previous;
    opt.selected = true;
    select.appendChild(opt);
  }

  if (!select.value && select.options.length > 0) {
    select.selectedIndex = 0;
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

function schemaLabelForModel(model, hasId) {
  if (!hasId) return '—';
  if (!model || model.supportsStructuredOutputs == null) {
    return 'unknown (JSON object unless catalog says otherwise)';
  }
  if (model.supportsStructuredOutputs) {
    return 'yes (strict JSON schema)';
  }
  return 'no (JSON object mode)';
}

function expiryPolicyLabel(duration) {
  if (duration === null) return 'Never expires';
  const preset = expiryPresets.find((p) => p.value === duration);
  if (preset) return preset.label;
  if (typeof duration === 'number') {
    const hours = duration / 3600000;
    if (hours >= 24 && hours % 24 === 0) return `${hours / 24} days`;
    if (hours >= 1) return `${hours} hours`;
    return `${duration} ms`;
  }
  return '—';
}

function keyStatusLabel(config) {
  if (!config || !config.key) return 'Not set';
  if (config.expiresAt === null) return 'On file · never expires';
  if (typeof config.expiresAt === 'number') {
    if (Date.now() > config.expiresAt) return 'On file · expired — re-enter a key';
    return `On file · ${formatTimeRemaining(config.expiresAt)}`;
  }
  return 'On file';
}

// Summary card tracks the form (what Save will apply), not only last-saved storage.
function updateCurrentConfigCard() {
  const card = document.getElementById('currentConfigCard');
  if (!card) return;

  // Show whenever we have a saved config or the user is mid-edit with a model.
  const modelId = getSelectedModelId() || (currentConfig && currentConfig.model) || '';
  const hasAnything = !!(currentConfig && currentConfig.key) || !!modelId;
  card.hidden = !hasAnything;
  if (!hasAnything) return;

  const model = findModel(modelId);
  const modelName = model ? model.name : (modelId || '—');
  const expiryRaw = document.getElementById('expirySelect')?.value;
  let expiryDuration = currentConfig ? currentConfig.expiryDuration : 86400000;
  if (expiryRaw !== undefined && expiryRaw !== null && expiryRaw !== '') {
    expiryDuration = expiryRaw === 'null' ? null : parseInt(expiryRaw, 10);
  }

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set('cfgModel', modelName || '—');
  set('cfgModelId', modelId || '—');
  set('cfgSchema', schemaLabelForModel(model, !!modelId));
  set('cfgKey', keyStatusLabel(currentConfig));
  set('cfgExpiry', expiryPolicyLabel(expiryDuration));
}

function updateModelCost() {
  const id = getSelectedModelId();
  const model = findModel(id);
  const costEl = document.getElementById('modelCost');
  const hintEl = document.getElementById('modelSchemaHint');

  if (costEl) {
    costEl.textContent = model
      ? `Cost: ${model.cost}`
      : (id ? 'Cost: unknown (custom or uncached model)' : '');
  }

  if (hintEl) {
    if (!id) {
      hintEl.textContent = '';
    } else if (!model || model.supportsStructuredOutputs == null) {
      // Either a custom id, or a curated entry the catalog has not confirmed
      // yet — we genuinely do not know, so do not claim the model lacks support.
      hintEl.textContent = 'Structured outputs: unknown — will use JSON object unless the catalog says otherwise.';
    } else if (model.supportsStructuredOutputs) {
      hintEl.textContent = 'Structured outputs: yes — organize will request a strict JSON schema.';
    } else {
      hintEl.textContent = 'Structured outputs: no — organize will use JSON object mode.';
    }
  }

  updateCurrentConfigCard();
}

function formatModelsStatus(meta, count) {
  if (!meta) return count ? `${count} models` : '';
  if (meta.fallback) {
    const reason = meta.error ? ` · could not load catalog: ${meta.error}` : '';
    return `Recommended only${reason}`;
  }
  const n = count || 0;
  let base = `${n} model${n === 1 ? '' : 's'}`;
  if (meta.fromCache && meta.fetchedAt) {
    const ageMs = Date.now() - meta.fetchedAt;
    const ageH = Math.floor(ageMs / 3600000);
    const ageLabel = ageH < 1 ? 'just now' : `${ageH}h ago`;
    base += meta.stale ? ` · stale cache (${ageLabel})` : ` · cached ${ageLabel}`;
  } else if (meta.fetchedAt) {
    base += ' · just refreshed';
  }
  if (meta.error && !meta.fallback) base += ` · ${meta.error}`;
  if (meta.error && meta.stale) base += ` · ${meta.error}`;
  return base;
}

function setModelsStatus(meta, count) {
  const el = document.getElementById('modelsStatus');
  if (el) el.textContent = formatModelsStatus(meta, count);
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

async function refreshCatalog() {
  const btn = document.getElementById('refreshModels');
  const status = document.getElementById('modelsStatus');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Loading catalog…';

  // Preserve selection if the request fails or returns only curated models.
  const selectedBefore = getSelectedModelId() || (currentConfig && currentConfig.model) || null;

  try {
    const data = await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action: 'refreshOpenRouterModels' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });

    if (data && Array.isArray(data.models) && data.models.length > 0) {
      models = data.models;
      modelsMeta = data.modelsMeta || null;
      if (data.error && !modelsMeta) {
        modelsMeta = { fallback: true, error: data.error };
      }
      populateModels(selectedBefore);
      setModelsStatus(modelsMeta, models.length);
      updateCurrentConfigCard();
    } else {
      const errMsg = (data && (data.error || (data.modelsMeta && data.modelsMeta.error)))
        || 'No response from extension background (try reloading the extension)';
      setModelsStatus(
        { fallback: true, error: errMsg },
        models.length
      );
    }
  } catch (err) {
    setModelsStatus(
      {
        fallback: true,
        error: err.message || 'Catalog refresh failed',
      },
      models.length
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function init() {
  // Load config and metadata from background
  const data = await chrome.runtime.sendMessage({ action: 'loadAiConfig' });
  models = data.models || [];
  expiryPresets = data.expiryPresets || [];
  currentConfig = data.config;
  modelsMeta = data.modelsMeta || null;

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

  // Populate dropdowns
  const selectedModel = currentConfig ? currentConfig.model : null;
  const selectedExpiry = currentConfig ? currentConfig.expiryDuration : 86400000;
  populateModels(selectedModel);
  populateExpiry(selectedExpiry);
  setModelsStatus(modelsMeta, models.length);

  // Prefill custom id only when the saved model is not in the loaded catalog
  // (so power users keep free-form ids without forcing everyone into the field).
  const customInput = document.getElementById('customModelId');
  if (customInput && selectedModel && !findModel(selectedModel)) {
    customInput.value = selectedModel;
  }

  // Key status + help in edit mode (model/expiry can change without a new key)
  if (isEdit && currentConfig) {
    document.getElementById('keyStatus').textContent = keyStatusLabel(currentConfig);
    document.getElementById('apiKeyInput').placeholder = 'Leave blank to keep current key';
    const keyHelp = document.getElementById('keyHelp');
    if (keyHelp) keyHelp.hidden = false;
  }

  // Buttons
  if (isEdit) {
    document.getElementById('saveButton').textContent = 'Save';
    document.getElementById('deleteButton').style.display = 'inline-block';
  }

  // Model cost / schema hint on change
  document.getElementById('modelSelect').addEventListener('change', () => {
    // Choosing from the list clears a custom override so the select wins.
    const custom = document.getElementById('customModelId');
    if (custom && custom.value.trim()) custom.value = '';
    updateModelCost();
  });

  const expiryEl = document.getElementById('expirySelect');
  if (expiryEl) {
    expiryEl.addEventListener('change', updateCurrentConfigCard);
  }

  updateCurrentConfigCard();

  // If the catalog is empty, only curated, or marked stale/fallback, refresh once.
  const shouldAutoRefresh = !modelsMeta
    || modelsMeta.fallback
    || modelsMeta.stale
    || models.every((m) => m.curated);
  if (shouldAutoRefresh) {
    // Fire-and-forget; UI already shows curated/cached list.
    refreshCatalog();
  }
}

function setupEventListeners() {
  // Key visibility toggle
  document.getElementById('keyToggle').addEventListener('click', () => {
    const input = document.getElementById('apiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  const filterEl = document.getElementById('modelFilter');
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      populateModels(getSelectedModelId() || (currentConfig && currentConfig.model) || null);
      updateCurrentConfigCard();
    });
  }

  const customEl = document.getElementById('customModelId');
  if (customEl) {
    customEl.addEventListener('input', updateModelCost);
  }

  const refreshBtn = document.getElementById('refreshModels');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshCatalog();
    });
  }

  // Save
  document.getElementById('saveButton').addEventListener('click', async () => {
    hideError();
    const keyInput = document.getElementById('apiKeyInput').value.trim();
    const model = getSelectedModelId();
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

    if (!model) {
      showError('Please choose a model or enter a custom model id.');
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

// Defensive: only auto-run against a real ai-setup.html page (which always has
// these elements). This keeps the module safe to load in isolation (e.g. test
// harnesses that eval this file against a DOM that doesn't have the page markup
// yet) without ever affecting production behavior.
function hasRequiredPageElements() {
  return !!(
    document.getElementById('modelSelect') &&
    document.getElementById('expirySelect') &&
    document.getElementById('saveButton')
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (hasRequiredPageElements()) {
      init();
      setupEventListeners();
    }
  });
} else if (hasRequiredPageElements()) {
  init();
  setupEventListeners();
}
