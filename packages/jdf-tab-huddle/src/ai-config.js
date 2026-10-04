// Shared by the Settings page (options.html) and the organize page
// (ai-proposal.html): talking to the background, the OpenRouter key checks,
// the key form and the model picker. Settings holds the lasting setup; the
// organize page holds the choice for one run. Everything hangs off one
// global, HuddleAi, so the two pages' own function names never collide.
// eslint-disable-next-line no-unused-vars
const HuddleAi = (() => {
  // Must equal AI_PROTOCOL in background.js (a unit test checks).
  const PROTOCOL = 2;

  // Chrome serves an unpacked extension's pages fresh from disk but keeps
  // running the service worker it already has until the extension is
  // reloaded. After a git checkout the two disagree; this is what we say.
  const STALE_MESSAGE = 'Huddle was updated, but Chrome is still running the old version in the background. Reload Huddle to continue (this page closes; open it again from the popup).';

  // Models Huddle used to recommend and OpenRouter has since dropped, so a
  // default saved back then is named, not shown as a bare id.
  const FORMER_MODEL_NAMES = [
    ['qwen/qwen3.5-flash-20260224', 'Qwen 3.5 Flash'],
    ['google/gemini-3.1-flash-lite-preview-20260303', 'Gemini 3.1 Flash Lite Preview'],
  ];

  const EYE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" '
    + 'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

  // Chrome's wording when nothing answered a message (an old worker with no
  // handler for it, or no listener at all).
  function isNoReceiverError(message) {
    return /message port closed|Receiving end does not exist|Could not establish connection/i.test(message || '');
  }

  function staleError() {
    const err = new Error(STALE_MESSAGE);
    err.stale = true;
    return err;
  }

  // chrome.runtime.sendMessage as a promise. It rejects when the background
  // cannot answer, and with a stale error (err.stale) when the background is
  // an older build that does not know the action.
  function request(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(isNoReceiverError(lastError.message) ? staleError() : new Error(lastError.message));
            return;
          }
          if (response && response.error === 'unknown-action') {
            reject(staleError());
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

  // 'missing', 'expired', or null when organize can run. The background
  // deletes an expired key and leaves keyExpiredAt, which still reads as
  // expired so the pages can say why the key is gone.
  function keyState(config) {
    if (!config || !config.key) return config && config.keyExpiredAt ? 'expired' : 'missing';
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
    if (keyState(config) === 'expired') return 'Expired · enter it again';
    if (!config || !config.key) return 'Not set';
    if (config.expiresAt === null || typeof config.expiresAt === 'number') {
      return `On file · ${formatTimeRemaining(config.expiresAt)}`;
    }
    return 'On file';
  }

  // ---- Key checks -----------------------------------------------------------

  // Pasted keys often carry the header prefix ("Bearer sk-or-...") or an
  // invisible character copied along from a web page or a password manager.
  function normalizeKeyInput(raw) {
    return (raw || '')
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
      .trim()
      .replace(/^Bearer\s+/i, '');
  }

  function keyFormatError(key) {
    if (/\s/.test(key)) {
      return 'The key contains spaces or line breaks. Paste only the key itself.';
    }
    if (!key.startsWith('sk-or-')) {
      return 'That is not an OpenRouter key. OpenRouter keys start with "sk-or-".';
    }
    if (!/^sk-or-[A-Za-z0-9_-]+$/.test(key)) {
      return 'The key contains a character OpenRouter keys never have (often an invisible one picked up when copying). Paste only the key.';
    }
    return null;
  }

  // Asks OpenRouter whether it accepts the key before it is stored. A
  // network that stalls gives up after 15 s, with the connection message.
  async function verifyOpenRouterKey(key) {
    let response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/key', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      // Building the request fails on a character a header cannot carry;
      // only a failed connection is a network problem.
      if (err instanceof TypeError && /header|ISO-8859|ByteString/i.test(err.message || '')) {
        return { ok: false, error: 'The key contains a character OpenRouter keys never have. Paste only the key.' };
      }
      return {
        ok: false,
        error: 'Couldn\'t reach OpenRouter to check this key. Check your connection and try again.',
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
  // The caller wraps it in a <form>, so Enter in the field submits.
  function createKeyForm(root, { idPrefix, keyLabel = 'OpenRouter API key' }) {
    root.innerHTML = `
      <div class="ai-field">
        <label for="${idPrefix}KeyInput">${keyLabel}</label>
        <div class="key-input-wrapper">
          <input type="password" id="${idPrefix}KeyInput" class="key-input" placeholder="sk-or-…" autocomplete="off" spellcheck="false">
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
      keyInput.placeholder = text ? 'Key on file · paste to replace' : 'sk-or-…';
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
    }

    return { keyInput, expirySelect, setExpiryPresets, setKeepHint, collect, clear };
  }

  // ---- Model picker ---------------------------------------------------------

  function formatAge(fetchedAt) {
    const mins = Math.floor((Date.now() - fetchedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
  }

  function formatModelsStatus(meta, count) {
    const n = count || 0;
    const models = `${n} model${n === 1 ? '' : 's'}`;
    if (!meta) return n ? models : '';
    if (meta.fallback) {
      return `Recommended only · ${meta.error || 'couldn\'t load the full list'}`;
    }
    if (meta.stale) {
      const when = meta.fetchedAt ? `the list from ${formatAge(meta.fetchedAt)}` : 'the saved list';
      return `Couldn't refresh (${meta.error || 'unknown error'}). Showing ${when}.`;
    }
    if (meta.fetchedAt) return `${models} · updated ${formatAge(meta.fetchedAt)}`;
    return models;
  }

  function isBatchId(id) {
    return typeof id === 'string' && /[:-]batch$/i.test(id);
  }

  // One line per model: "GPT-6 Luna · OpenAI · $1.50 in · $6.00 out per M".
  // A name that already says "(free)" is not told so twice.
  function optionLabel(m) {
    const parts = [m.name];
    if (m.provider && m.provider.toLowerCase() !== (m.name || '').toLowerCase()) parts.push(m.provider);
    if (m.cost && !(m.cost === 'free' && /\(free\)/i.test(m.name || ''))) parts.push(m.cost);
    return parts.join(' · ');
  }

  // The catalog as a filterable listbox (recommended first), a Refresh action
  // and a model id field. The choice is picker state, not the listbox's
  // value, so a filter never adds, keeps or silently swaps a row.
  // Callbacks: onChange(id) on every change of choice; onCommit() for Enter
  // (the organize page closes the panel); onCancel() for Escape.
  function createModelPicker(root, {
    idPrefix, onChange = () => {}, onCommit = () => {}, onCancel = () => {},
  }) {
    root.innerHTML = `
      <label for="${idPrefix}Filter">Filter models</label>
      <input type="search" id="${idPrefix}Filter" class="model-filter" placeholder="Name, provider or id…" autocomplete="off" aria-controls="${idPrefix}Select">
      <select id="${idPrefix}Select" class="model-select" size="8" aria-label="Models"></select>
      <p class="models-empty" hidden></p>
      <p class="model-choice" aria-live="polite"></p>
      <p class="model-schema-hint"></p>
      <div class="model-actions">
        <button type="button" class="btn small model-refresh">Refresh catalog</button>
        <span class="models-status" role="status" aria-live="polite"></span>
      </div>
      <label for="${idPrefix}Custom" class="label-gap">Or a model id</label>
      <input type="text" id="${idPrefix}Custom" class="model-custom" placeholder="provider/model-name" autocomplete="off" spellcheck="false">`;

    const filterEl = root.querySelector('.model-filter');
    const select = root.querySelector('.model-select');
    const emptyEl = root.querySelector('.models-empty');
    const refreshBtn = root.querySelector('.model-refresh');
    const statusEl = root.querySelector('.models-status');
    const customEl = root.querySelector('.model-custom');
    const choiceEl = root.querySelector('.model-choice');
    const hintEl = root.querySelector('.model-schema-hint');

    let models = [];
    let modelsMeta = null;
    let loaded = false;
    let selectedId = null;
    // Names of models a refresh dropped (or Huddle once recommended), so the
    // page can still name them.
    const goneNames = new Map(FORMER_MODEL_NAMES);

    function findModel(id) {
      if (!id) return null;
      return models.find((m) => m.id === id) || null;
    }

    function modelName(id) {
      const m = findModel(id);
      if (m) return m.name;
      return goneNames.get(id) || id || '';
    }

    // Whether Huddle's catalog offers this id (so it may become the default).
    function isListed(id) {
      return !!findModel(id) && !isBatchId(id);
    }

    function getModelId() {
      return customEl.value.trim() || selectedId || '';
    }

    // The ids of a live (or cached) catalog, or null while none has loaded
    // (offline, Huddle has only its own recommendations).
    function catalogIds() {
      if (!loaded || !modelsMeta || modelsMeta.fallback || models.length === 0) return null;
      return new Set(models.map((m) => m.id));
    }

    // The first recommended model the catalog lists (the worker drops the
    // ones it does not), or null.
    function firstRecommended() {
      return models.find((m) => m.curated && !isBatchId(m.id)) || null;
    }

    function matches(m, filter) {
      if (!filter) return true;
      return [m.id, m.name, m.provider].some((v) => v && v.toLowerCase().includes(filter));
    }

    // text overrides the catalog status (the filter's match count).
    function setStatus(text) {
      statusEl.textContent = text != null ? text : formatModelsStatus(modelsMeta, models.length);
    }

    function populate() {
      const filter = filterEl.value.trim().toLowerCase();
      select.innerHTML = '';
      let shown = 0;

      function addGroup(label, list) {
        if (!list.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        for (const m of list) {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = optionLabel(m);
          opt.title = m.id;
          group.appendChild(opt);
          shown += 1;
        }
        select.appendChild(group);
      }

      addGroup('Recommended', models.filter((m) => m.curated && matches(m, filter)));
      addGroup('All models', models.filter((m) => !m.curated && matches(m, filter)));

      // The choice is highlighted only when it is a visible row and no custom
      // id overrides it; otherwise no row is (never a stand-in row).
      const want = !customEl.value.trim() && selectedId ? selectedId : '';
      select.value = want;
      if (select.value !== want) select.selectedIndex = -1;

      const empty = !!(loaded && filter && shown === 0);
      emptyEl.hidden = !empty;
      emptyEl.textContent = empty ? `No models match "${filterEl.value.trim()}".` : '';
      select.hidden = empty;
      // With no match the empty message says so; the status keeps the count.
      if (loaded) setStatus(filter && shown ? `${shown} of ${models.length} models` : null);
      updateHints();
      fitRows();
    }

    // Sizes the listbox to exactly ROWS whole rows. Chrome draws a group's
    // header shorter than an option and ignores CSS row heights for it, so
    // the rows are measured (only possible while the list is visible).
    const ROWS = 8;
    function fitRows() {
      if (select.hidden || !select.getClientRects().length) return;
      const heights = [];
      for (const group of select.querySelectorAll('optgroup')) {
        const first = group.querySelector('option');
        if (first) heights.push(first.getBoundingClientRect().top - group.getBoundingClientRect().top);
        for (const opt of group.querySelectorAll('option')) heights.push(opt.getBoundingClientRect().height);
      }
      const option = heights.find((h, i) => i > 0 && h > 0) || 26;
      while (heights.length < ROWS) heights.push(option);
      const rows = heights.slice(0, ROWS).reduce((sum, h) => sum + h, 0);
      if (!rows) return;
      const cs = window.getComputedStyle(select);
      const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      select.style.height = `${Math.ceil(rows + chrome)}px`;
    }

    // The choice, named with its price (it may be filtered out of the list),
    // and a warning when Huddle can tell it won't work.
    function updateHints() {
      const id = getModelId();
      const model = findModel(id);
      choiceEl.textContent = !id ? '' : `Chosen: ${model ? optionLabel(model) : id}`;

      if (!id) {
        hintEl.textContent = '';
      } else if (isBatchId(id)) {
        hintEl.textContent = 'Batch models can\'t organize tabs: they only take offline batch jobs. Pick another model.';
      } else if (!model && goneNames.has(id) && catalogIds()) {
        hintEl.textContent = `OpenRouter no longer lists ${goneNames.get(id)}. Pick another model.`;
      } else if (!model && !loaded) {
        // Nothing to say while the catalog loads: the id is likely listed.
        hintEl.textContent = '';
      } else if (!model) {
        hintEl.textContent = modelsMeta && !modelsMeta.fallback
          ? 'Not in OpenRouter\'s list of models Huddle can use: it may not exist, or may not answer in JSON.'
          : 'Huddle can\'t check this id until the catalog loads.';
      } else if (model.supportsStructuredOutputs === false) {
        hintEl.textContent = 'This model can\'t be held to the exact answer format Huddle reads, so now and then its answer may need a retry.';
      } else {
        hintEl.textContent = '';
      }
    }

    function applyCatalog(list, meta) {
      const before = new Map(models.map((m) => [m.id, m.name]));
      models = Array.isArray(list) ? list : [];
      modelsMeta = meta || null;
      loaded = true;
      for (const [id, name] of before) {
        if (!findModel(id)) goneNames.set(id, name);
      }
      populate();
    }

    // Before any catalog (no key yet): Huddle's own recommendations, with no
    // network call. The catalog replaces them once the picker is browsed.
    function showRecommended(list) {
      if (loaded || !Array.isArray(list) || list.length === 0) return;
      models = list;
      populate();
      setStatus('Recommended models · the full list loads when you browse it');
    }

    async function refresh({ force = true } = {}) {
      refreshBtn.disabled = true;
      statusEl.textContent = 'Loading catalog…';
      try {
        const data = await request({ action: force ? 'refreshOpenRouterModels' : 'loadOpenRouterModels' });
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          applyCatalog(data.models, data.modelsMeta);
          onChange(getModelId());
        } else {
          loaded = true;
          modelsMeta = { fallback: true, error: (data && data.modelsMeta && data.modelsMeta.error) || 'no reply from Huddle' };
          setStatus();
        }
      } catch (err) {
        loaded = true;
        modelsMeta = { ...(modelsMeta || {}), stale: models.length > 0, fallback: models.length === 0, error: err.message };
        setStatus();
      } finally {
        refreshBtn.disabled = false;
      }
    }

    // Loads the catalog (the cache when fresh). The choice set with setModelId
    // stays; an id the catalog does not know moves to the id field.
    async function load() {
      await refresh({ force: false });
      if (selectedId && !findModel(selectedId) && !customEl.value.trim()) {
        customEl.value = selectedId;
        populate();
      }
    }

    // Sets the choice without calling onChange (the page decides).
    function setModelId(id) {
      const value = id || null;
      if (value && loaded && !findModel(value)) {
        customEl.value = value;
      } else {
        customEl.value = '';
        selectedId = value;
      }
      populate();
    }

    select.addEventListener('change', () => {
      selectedId = select.value || selectedId;
      // Choosing from the list clears an id override so the list wins.
      if (customEl.value.trim()) customEl.value = '';
      updateHints();
      onChange(getModelId());
    });
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    });
    filterEl.addEventListener('input', populate);
    filterEl.addEventListener('keydown', (e) => {
      const first = select.querySelector('option');
      if (e.key === 'ArrowDown' && first) {
        e.preventDefault();
        select.focus();
        if (select.selectedIndex < 0) {
          select.value = first.value;
          select.dispatchEvent(new Event('change'));
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Enter takes the highlighted row, or the first match.
        if (select.selectedIndex < 0 && first) {
          select.value = first.value;
          select.dispatchEvent(new Event('change'));
        }
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    });
    customEl.addEventListener('input', () => {
      populate();
      onChange(getModelId());
    });
    customEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    });
    refreshBtn.addEventListener('click', () => {
      refresh();
    });

    return {
      load, refresh, showRecommended, setModelId, getModelId, findModel, modelName, isListed, fitRows,
      catalogIds, firstRecommended,
      focus: () => {
        fitRows();
        filterEl.focus();
      },
      select, filterEl, customEl,
    };
  }

  // The model a run uses when none is picked, as the worker works it out
  // (resolveDefaultModel in background.js): the saved default, else Huddle's;
  // when the loaded catalog lacks it, the first recommended model it lists.
  // { model, missing (the id replaced, or null), mine (the user saved it) }.
  function resolveDefaultModel(config, builtInDefault, picker) {
    const saved = (config && typeof config.model === 'string' && config.model) || null;
    const wanted = saved || builtInDefault || null;
    const keep = { model: wanted, missing: null, mine: !!saved };
    const ids = picker && picker.catalogIds ? picker.catalogIds() : null;
    if (!wanted || !ids || ids.has(wanted)) return keep;
    if (saved && config.unlistedModel === saved) return keep;
    const first = picker.firstRecommended();
    if (!first || first.id === wanted) return keep;
    return { model: first.id, missing: wanted, mine: !!saved };
  }

  // "Your default Qwen 3.5 Flash is no longer on OpenRouter; using Claude
  // Haiku 4.5." or '' when nothing was replaced.
  function defaultFallbackNote(resolved, picker) {
    if (!resolved || !resolved.missing) return '';
    const name = (id) => (picker ? picker.modelName(id) : '') || id;
    const whose = resolved.mine ? 'Your default' : 'Huddle\'s default';
    return `${whose} ${name(resolved.missing)} is no longer on OpenRouter; using ${name(resolved.model)}.`;
  }

  return {
    PROTOCOL,
    STALE_MESSAGE,
    isNoReceiverError,
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
    optionLabel,
    createModelPicker,
    resolveDefaultModel,
    defaultFallbackNote,
  };
})();
