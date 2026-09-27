// Shared by the Settings page (options.html) and the organize page
// (ai-proposal.html): the OpenRouter key checks, the key form and the model
// picker. Settings holds the lasting setup; the organize page holds the
// choice for one run. Everything hangs off one global, HuddleAi, so the two
// pages' own function names never collide with these.
// eslint-disable-next-line no-unused-vars
const HuddleAi = (() => {
  const EYE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" '
    + 'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

  // chrome.runtime.sendMessage as a promise that rejects when the background
  // cannot answer (instead of resolving with undefined).
  function request(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
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
  }

  // ---- Key status ---------------------------------------------------------

  function isStoredKeyExpired(config) {
    return !!(config && config.key
      && typeof config.expiresAt === 'number'
      && Date.now() > config.expiresAt);
  }

  function hasUsableKey(config) {
    return !!(config && config.key) && !isStoredKeyExpired(config);
  }

  // 'missing', 'expired', or null when organize can run.
  function keyState(config) {
    if (!config || !config.key) return 'missing';
    return isStoredKeyExpired(config) ? 'expired' : null;
  }

  function formatTimeRemaining(expiresAt) {
    if (expiresAt === null) return 'never expires';
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'expired';
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `expires in ${days}d ${hours % 24}h`;
    }
    return `expires in ${hours}h ${minutes}m`;
  }

  function keyStatusLabel(config) {
    if (!config || !config.key) return 'Not set';
    if (config.expiresAt === null || typeof config.expiresAt === 'number') {
      return `On file · ${formatTimeRemaining(config.expiresAt)}`;
    }
    return 'On file';
  }

  // ---- Key checks -----------------------------------------------------------

  // Pasted keys often carry the header prefix ("Bearer sk-or-...").
  function normalizeKeyInput(raw) {
    return (raw || '').trim().replace(/^Bearer\s+/i, '');
  }

  function keyFormatError(key) {
    if (/\s/.test(key)) {
      return 'The key contains spaces or line breaks. Paste only the key itself.';
    }
    if (!key.startsWith('sk-or-')) {
      return 'That is not an OpenRouter key. OpenRouter keys start with "sk-or-".';
    }
    return null;
  }

  // Asks OpenRouter whether it accepts the key before it is stored.
  async function verifyOpenRouterKey(key) {
    let response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/key', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
      });
    } catch (_err) {
      return {
        ok: false,
        error: 'Could not reach OpenRouter to check this key. Check your connection and try again.',
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'OpenRouter rejected this key.' };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `OpenRouter could not check this key right now (HTTP ${response.status}). Try again.`,
      };
    }
    return { ok: true };
  }

  // ---- Key form -------------------------------------------------------------

  // A password field with a show toggle and the expiry choice. collect() runs
  // every save-time check, OpenRouter's included, and returns what to save.
  function createKeyForm(root, { idPrefix, keyLabel = 'OpenRouter API key' }) {
    root.innerHTML = `
      <div class="ai-field">
        <label for="${idPrefix}KeyInput">${keyLabel}</label>
        <div class="key-input-wrapper">
          <input type="password" id="${idPrefix}KeyInput" class="key-input" placeholder="sk-or-..." autocomplete="off" spellcheck="false">
          <button type="button" class="key-toggle" aria-label="Show key" aria-pressed="false" title="Show or hide the key">${EYE_ICON}</button>
        </div>
        <div class="field-help key-help" hidden></div>
      </div>
      <div class="ai-field">
        <label for="${idPrefix}Expiry">Key expires after</label>
        <select id="${idPrefix}Expiry" class="expiry-select"></select>
      </div>`;

    const keyInput = root.querySelector('.key-input');
    const toggle = root.querySelector('.key-toggle');
    const help = root.querySelector('.key-help');
    const expirySelect = root.querySelector('.expiry-select');

    toggle.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      const shown = keyInput.type === 'text';
      toggle.setAttribute('aria-pressed', String(shown));
      toggle.setAttribute('aria-label', shown ? 'Hide key' : 'Show key');
    });

    function setExpiryPresets(presets, selected) {
      expirySelect.innerHTML = '';
      for (const p of presets || []) {
        const opt = document.createElement('option');
        opt.value = p.value === null ? 'null' : String(p.value);
        opt.textContent = p.label;
        if (p.value === selected) opt.selected = true;
        expirySelect.appendChild(opt);
      }
    }

    // With a usable key on file the field may stay blank to keep it.
    function setKeepHint(text) {
      help.hidden = !text;
      help.textContent = text || '';
      keyInput.placeholder = text ? 'Leave blank to keep your current key' : 'sk-or-...';
    }

    function readExpiry() {
      const raw = expirySelect.value;
      return raw === 'null' ? null : parseInt(raw, 10);
    }

    async function collect({ storedConfig = null, allowKeep = false } = {}) {
      const typed = normalizeKeyInput(keyInput.value);
      const expiryDuration = readExpiry();
      let key = typed;

      if (!typed) {
        if (allowKeep && storedConfig && storedConfig.key) {
          if (isStoredKeyExpired(storedConfig)) {
            return { ok: false, error: 'Your key has expired. Enter it again to renew.' };
          }
          try {
            key = atob(storedConfig.key);
          } catch (_e) {
            return { ok: false, error: 'Could not read existing key. Please enter a new one.' };
          }
        } else {
          return { ok: false, error: 'Please enter your OpenRouter API key.' };
        }
      } else {
        const formatError = keyFormatError(typed);
        if (formatError) return { ok: false, error: formatError };
      }

      // An empty select (not filled yet) must not send an unparsable duration,
      // which messaging would turn into "never expires".
      if (expiryDuration !== null && !Number.isFinite(expiryDuration)) {
        return { ok: false, error: 'Please choose when the key should expire.' };
      }

      // Only a newly typed key is checked; a kept key was checked when saved.
      if (typed) {
        const check = await verifyOpenRouterKey(typed);
        if (!check.ok) return { ok: false, error: check.error };
      }
      return { ok: true, key, expiryDuration, newKey: !!typed };
    }

    function clear() {
      keyInput.value = '';
      keyInput.type = 'password';
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', 'Show key');
    }

    return { keyInput, expirySelect, setExpiryPresets, setKeepHint, collect, clear };
  }

  // ---- Model picker ---------------------------------------------------------

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
    return base;
  }

  // The filtered catalog (recommended first), a Refresh action and a custom
  // id field. onChange(id) runs whenever the user changes the choice.
  function createModelPicker(root, { idPrefix, onChange = () => {} }) {
    root.innerHTML = `
      <label for="${idPrefix}Filter">Filter models</label>
      <input type="search" id="${idPrefix}Filter" class="model-filter" placeholder="Name or id…" autocomplete="off">
      <select id="${idPrefix}Select" class="model-select" size="8" aria-label="Model"></select>
      <div class="model-actions">
        <button type="button" class="btn small model-refresh">Refresh catalog</button>
        <span class="models-status"></span>
      </div>
      <label for="${idPrefix}Custom" class="label-gap">Or custom model id</label>
      <input type="text" id="${idPrefix}Custom" class="model-custom" placeholder="provider/model-name" autocomplete="off" spellcheck="false">
      <div class="model-cost"></div>
      <div class="model-schema-hint"></div>`;

    const filterEl = root.querySelector('.model-filter');
    const select = root.querySelector('.model-select');
    const refreshBtn = root.querySelector('.model-refresh');
    const statusEl = root.querySelector('.models-status');
    const customEl = root.querySelector('.model-custom');
    const costEl = root.querySelector('.model-cost');
    const hintEl = root.querySelector('.model-schema-hint');

    let models = [];
    let modelsMeta = null;
    let initialId = null;

    function findModel(id) {
      if (!id) return null;
      return models.find((m) => m.id === id) || null;
    }

    function modelName(id) {
      const m = findModel(id);
      return m ? m.name : (id || '');
    }

    function getModelId() {
      return customEl.value.trim() || select.value || '';
    }

    // The list choice alone, never the custom id, so a filter or refresh
    // cannot turn a typed custom id into a list option.
    function getListModelId() {
      return select.value || initialId || null;
    }

    function populate(selectedId) {
      const previous = selectedId != null ? selectedId : (select.value || initialId || '');
      const filter = filterEl.value.trim().toLowerCase();
      select.innerHTML = '';

      const matches = (m) => !filter
        || (m.id && m.id.toLowerCase().includes(filter))
        || (m.name && m.name.toLowerCase().includes(filter));

      function addGroup(label, list) {
        if (!list.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        for (const m of list) {
          const opt = document.createElement('option');
          opt.value = m.id;
          const schemaMark = m.supportsStructuredOutputs ? ' · schema' : '';
          opt.textContent = `${m.name} (${m.cost})${schemaMark}`;
          if (m.id === previous) opt.selected = true;
          group.appendChild(opt);
        }
        select.appendChild(group);
      }

      addGroup('Recommended', models.filter((m) => m.curated && matches(m)));
      addGroup('All models', models.filter((m) => !m.curated && matches(m)));

      // Keep the current choice visible even when filtered out or not in the catalog.
      if (previous && !Array.from(select.options).some((o) => o.value === previous)) {
        const opt = document.createElement('option');
        opt.value = previous;
        const known = findModel(previous);
        opt.textContent = known ? `${known.name} (${known.cost})` : previous;
        opt.selected = true;
        select.appendChild(opt);
      }

      if (!select.value && select.options.length > 0) select.selectedIndex = 0;
      updateHints();
    }

    function updateHints() {
      const id = getModelId();
      const model = findModel(id);
      costEl.textContent = model
        ? `Cost: ${model.cost}`
        : (id ? 'Cost: unknown (custom or uncached model)' : '');

      if (!id) {
        hintEl.textContent = '';
      } else if (!model) {
        // Not in the list Huddle filtered to models that can answer in JSON.
        hintEl.textContent = 'Warning: this model is not in Huddle\'s list and may not support JSON output, so organize may fail.';
      } else if (model.supportsStructuredOutputs == null) {
        // A curated entry the catalog has not confirmed yet: we do not know.
        hintEl.textContent = 'Structured outputs: unknown, so organize uses JSON object mode unless the catalog says otherwise.';
      } else if (model.supportsStructuredOutputs) {
        hintEl.textContent = 'Structured outputs: yes, so organize requests a strict JSON schema.';
      } else {
        hintEl.textContent = 'Structured outputs: no, so organize uses JSON object mode.';
      }
    }

    function setStatus(meta, count) {
      statusEl.textContent = formatModelsStatus(meta, count);
    }

    async function refresh() {
      refreshBtn.disabled = true;
      statusEl.textContent = 'Loading catalog…';
      const selectedBefore = getListModelId();
      try {
        const data = await request({ action: 'refreshOpenRouterModels' });
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          models = data.models;
          modelsMeta = data.modelsMeta || (data.error ? { fallback: true, error: data.error } : null);
          populate(selectedBefore);
          setStatus(modelsMeta, models.length);
          onChange(getModelId());
        } else {
          const errMsg = (data && (data.error || (data.modelsMeta && data.modelsMeta.error)))
            || 'No response from extension background (try reloading the extension)';
          setStatus({ fallback: true, error: errMsg }, models.length);
        }
      } catch (err) {
        setStatus({ fallback: true, error: err.message || 'Catalog refresh failed' }, models.length);
      } finally {
        refreshBtn.disabled = false;
      }
    }

    // Fills the list and selects selectedId; an id the catalog does not know
    // goes in the custom field, so power users keep free-form ids.
    function setCatalog(list, meta, selectedId) {
      models = Array.isArray(list) ? list : [];
      modelsMeta = meta || null;
      initialId = selectedId || null;
      customEl.value = selectedId && !findModel(selectedId) ? selectedId : '';
      populate(selectedId || null);
      setStatus(modelsMeta, models.length);

      // An empty, curated-only, stale or fallback catalog refreshes once.
      const shouldAutoRefresh = !modelsMeta
        || modelsMeta.fallback
        || modelsMeta.stale
        || models.every((m) => m.curated);
      if (shouldAutoRefresh) refresh();
    }

    function setModelId(id) {
      if (id && !findModel(id)) {
        customEl.value = id;
        populate(getListModelId());
      } else {
        customEl.value = '';
        populate(id || null);
      }
    }

    select.addEventListener('change', () => {
      // Choosing from the list clears a custom override so the list wins.
      if (customEl.value.trim()) customEl.value = '';
      updateHints();
      onChange(getModelId());
    });
    filterEl.addEventListener('input', () => {
      populate(getListModelId());
    });
    customEl.addEventListener('input', () => {
      updateHints();
      onChange(getModelId());
    });
    refreshBtn.addEventListener('click', () => {
      refresh();
    });

    return { setCatalog, setModelId, getModelId, findModel, modelName, refresh, select, filterEl, customEl };
  }

  return {
    request,
    isStoredKeyExpired,
    hasUsableKey,
    keyState,
    formatTimeRemaining,
    keyStatusLabel,
    normalizeKeyInput,
    keyFormatError,
    verifyOpenRouterKey,
    createKeyForm,
    formatModelsStatus,
    createModelPicker,
  };
})();
