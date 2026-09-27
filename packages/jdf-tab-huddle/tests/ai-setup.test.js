import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const aiSetupJsSource = readFileSync(resolve(__dirname, '../src/ai-setup.js'), 'utf8');

// src/ai-setup.js reads `pageMode` from window.location.search once at
// *module-eval* time (like src/confirmation-dialog.js). tests/setup.js evals
// the source exactly once, before window.location can be mocked per test, and
// its bottom auto-run is guarded to be a no-op against that default DOM (see
// hasRequiredPageElements() in the source) — so pageMode is always 'setup'
// and init()/setupEventListeners() never actually ran there.
//
// For tests that need a specific pageMode ('setup' vs 'edit') and control
// over init()'s async config load, we re-eval the source on demand, after
// mocking window.location.search and building the real page DOM — mirroring
// tests/confirmation-dialog.test.js's own on-demand-reload pattern. The
// reloaded functions are returned from the IIFE rather than assigned to
// `global.*`, so they never collide with the same-named `setupEventListeners`
// exposed globally by src/confirmation-dialog.js (or with the namespaced
// `aiSetup*` globals tests/setup.js exposes from its single bootstrap eval).
function loadAiSetup() {
  const wrapper = `
    (function() {
      ${aiSetupJsSource}
      return {
        init,
        setupEventListeners,
        formatTimeRemaining,
        showError,
        hideError,
        populateModels,
        populateExpiry,
        updateModelCost,
        updateCurrentConfigCard,
        schemaLabelForModel,
        keyStatusLabel,
        formatModelsStatus,
      };
    })();
  `;
  return eval(wrapper);
}

function setLocationSearch(search) {
  Object.defineProperty(window, 'location', {
    value: { search },
    writable: true,
    configurable: true,
  });
}

// Full fixture DOM matching ai-setup.html's relevant elements.
function buildAiSetupDom() {
  document.body.innerHTML = `
    <h1 id="pageTitle">🤖 Set up AI Organize</h1>
    <div id="expiredNotice" style="display: none;"></div>
    <div id="warningSection"><strong>⚠️ Important: You are responsible for your API key</strong></div>
    <div id="currentConfigCard" class="current-config" hidden>
      <h3>Current configuration</h3>
      <dl>
        <dt>Model</dt><dd id="cfgModel">—</dd>
        <dt>Model id</dt><dd id="cfgModelId">—</dd>
        <dt>Structured outputs</dt><dd id="cfgSchema">—</dd>
        <dt>Key</dt><dd id="cfgKey">—</dd>
        <dt>Expiry policy</dt><dd id="cfgExpiry">—</dd>
      </dl>
    </div>
    <div id="errorMsg" style="display: none;"></div>
    <button id="keyToggle">Show</button>
    <input id="apiKeyInput" type="password" value="" />
    <span id="keyStatus"></span>
    <div id="keyHelp" class="field-help" hidden>Leave blank to keep your current key.</div>
    <input id="modelFilter" type="search" value="" />
    <select id="modelSelect"></select>
    <button id="refreshModels">Refresh catalog</button>
    <span id="modelsStatus"></span>
    <input id="customModelId" type="text" value="" />
    <span id="modelCost"></span>
    <span id="modelSchemaHint"></span>
    <select id="expirySelect"></select>
    <button id="saveButton">Set up</button>
    <button id="cancelButton">Cancel</button>
    <button id="deleteButton" style="display: none;">Delete</button>
  `;
}

function flushPromises() {
  return new Promise((r) => setTimeout(r, 0));
}

const MODELS = [
  { id: 'm1', name: 'Model One', cost: '$0.01/tab', curated: true, supportsStructuredOutputs: true },
  { id: 'm2', name: 'Model Two', cost: '$0.02/tab', curated: false, supportsStructuredOutputs: false },
];
const EXPIRY_PRESETS = [{ value: 86400000, label: '1 day' }, { value: null, label: 'Never' }];
const MODELS_META = { fetchedAt: Date.now(), fromCache: true, stale: false, fallback: false, error: null };

describe('ai-setup.js', () => {
  beforeEach(() => {
    // Start every test from an empty document. hasRequiredPageElements()
    // (see src/ai-setup.js) gates the module's own bottom auto-run on the
    // page markup being present — as long as the DOM is empty when
    // loadAiSetup() evals the source, that auto-run is a no-op and only our
    // own explicit mod.init()/mod.setupEventListeners() calls (below,
    // against a DOM we build *after* loading) drive the module.
    document.body.innerHTML = '';
    // The key check on save goes to OpenRouter; tests decide what it answers.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  describe('formatTimeRemaining', () => {
    const NOW = 1_700_000_000_000;
    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    test('never-expires branch (expiresAt === null)', () => {
      expect(formatTimeRemaining(null)).toBe('Key never expires');
    });

    test('expired branch (remaining <= 0)', () => {
      expect(formatTimeRemaining(NOW - 1000)).toBe('Key has expired');
      // Exactly now (remaining === 0) also counts as expired.
      expect(formatTimeRemaining(NOW)).toBe('Key has expired');
    });

    test('< 24h remaining branch', () => {
      const expiresAt = NOW + (2 * 3600000) + (15 * 60000); // 2h15m
      expect(formatTimeRemaining(expiresAt)).toBe('Key expires in 2h 15m');
    });

    test('> 24h remaining branch', () => {
      const expiresAt = NOW + (30 * 3600000); // 30h -> 1d 6h
      expect(formatTimeRemaining(expiresAt)).toBe('Key expires in 1d 6h');
    });
  });

  describe('setup mode — save-button validation', () => {
    test('shows an error when the API key field is empty', () => {
      setLocationSearch('');
      const mod = loadAiSetup();
      buildAiSetupDom();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = '   ';
      document.getElementById('saveButton').click();

      const errorEl = document.getElementById('errorMsg');
      expect(errorEl.textContent).toBe('Please enter your OpenRouter API key.');
      expect(errorEl.style.display).toBe('block');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveAiConfig' })
      );
    });
  });

  describe('edit mode — currentConfig key handling', () => {
    function mockBackground(loadConfigResponse) {
      chrome.runtime.sendMessage.mockImplementation(async (message) => {
        if (message.action === 'loadAiConfig') return loadConfigResponse;
        if (message.action === 'saveAiConfig') return { success: true };
        return {};
      });
    }

    test('decodes the existing stored key via atob when the input is left empty', async () => {
      setLocationSearch('?mode=edit');
      const storedKey = btoa('sk-existing-key');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: { key: storedKey, model: 'm1', expiryDuration: 86400000, expiresAt: null },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = ''; // keep current key
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveAiConfig',
          config: expect.objectContaining({ key: 'sk-existing-key' }),
        })
      );
      expect(window.close).toHaveBeenCalled();
      // Keeping the stored key does not re-check it with OpenRouter.
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('an expired stored key shows the expired notice and cannot be kept by leaving the field blank', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: {
          key: btoa('sk-or-old'),
          model: 'm1',
          expiryDuration: 86400000,
          expiresAt: Date.now() - 1000,
        },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      expect(document.getElementById('expiredNotice').style.display).toBe('block');
      expect(document.getElementById('keyHelp').hidden).toBe(true);
      expect(document.getElementById('apiKeyInput').placeholder).not.toMatch(/leave blank/i);

      document.getElementById('apiKeyInput').value = '';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(document.getElementById('errorMsg').textContent)
        .toBe('Your key has expired — enter it again to renew.');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveAiConfig' })
      );
      expect(window.close).not.toHaveBeenCalled();

      // Re-entering a key is accepted.
      document.getElementById('apiKeyInput').value = 'sk-or-renewed';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveAiConfig',
          config: expect.objectContaining({ key: 'sk-or-renewed' }),
        })
      );
    });

    test('malformed base64 in the stored key shows an error instead of throwing', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        // Not valid base64 — atob() must throw for this input.
        config: { key: '***not-valid-base64***', model: 'm1', expiryDuration: 86400000, expiresAt: null },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = '';
      expect(() => document.getElementById('saveButton').click()).not.toThrow();
      await flushPromises();

      const errorEl = document.getElementById('errorMsg');
      expect(errorEl.textContent).toBe('Could not read existing key. Please enter a new one.');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveAiConfig' })
      );
      expect(window.close).not.toHaveBeenCalled();
    });
  });

  describe('saveAiConfig response handling', () => {
    function mockBackground({ loadConfigResponse, saveConfigResponse }) {
      chrome.runtime.sendMessage.mockImplementation(async (message) => {
        if (message.action === 'loadAiConfig') return loadConfigResponse;
        if (message.action === 'saveAiConfig') return saveConfigResponse;
        return { success: true };
      });
    }

    test('success branch (setup mode): closes the tab and triggers aiGroupTabs', async () => {
      setLocationSearch('');
      mockBackground({
        loadConfigResponse: {
          models: MODELS,
          expiryPresets: EXPIRY_PRESETS,
          modelsMeta: MODELS_META,
          config: null,
        },
        saveConfigResponse: { success: true },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = 'sk-or-new-key';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'aiGroupTabs' })
      );
      expect(window.close).toHaveBeenCalled();
      expect(document.getElementById('errorMsg').style.display).not.toBe('block');
    });

    test.each([
      ['?mode=setup&respectGroups=false', false],
      ['?mode=expired&respectGroups=false', false],
      ['?mode=expired', true],
    ])('Save & organize from %s runs with respectGroups=%s', async (search, expected) => {
      setLocationSearch(search);
      mockBackground({
        loadConfigResponse: {
          models: MODELS,
          expiryPresets: EXPIRY_PRESETS,
          modelsMeta: MODELS_META,
          config: null,
        },
        saveConfigResponse: { success: true },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = 'sk-or-new-key';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'aiGroupTabs',
        respectGroups: expected,
      });
    });

    test('failure branch: shows the server-provided error and does not close the tab', async () => {
      setLocationSearch('');
      mockBackground({
        loadConfigResponse: {
          models: MODELS,
          expiryPresets: EXPIRY_PRESETS,
          modelsMeta: MODELS_META,
          config: null,
        },
        saveConfigResponse: { success: false, error: 'Invalid API key' },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = 'sk-or-bad-key';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(document.getElementById('errorMsg').textContent).toBe('Invalid API key');
      expect(document.getElementById('errorMsg').style.display).toBe('block');
      expect(window.close).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'aiGroupTabs' })
      );
    });

    test('failure branch falls back to a generic message when no error is provided', async () => {
      setLocationSearch('');
      mockBackground({
        loadConfigResponse: {
          models: MODELS,
          expiryPresets: EXPIRY_PRESETS,
          modelsMeta: MODELS_META,
          config: null,
        },
        saveConfigResponse: { success: false },
      });

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = 'sk-or-bad-key';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(document.getElementById('errorMsg').textContent).toBe('Failed to save configuration.');
    });
  });

  describe('model picker', () => {
    function mockBackground(loadConfigResponse) {
      chrome.runtime.sendMessage.mockImplementation(async (message) => {
        if (message.action === 'loadAiConfig') return loadConfigResponse;
        if (message.action === 'saveAiConfig') {
          return { success: true, config: message.config };
        }
        if (message.action === 'refreshOpenRouterModels') {
          return { success: true, models: MODELS, modelsMeta: MODELS_META };
        }
        return {};
      });
    }

    test('custom model id overrides the select on save', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: { key: btoa('sk-existing'), model: 'm1', expiryDuration: 86400000, expiresAt: null },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('customModelId').value = 'custom/provider-model';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveAiConfig',
          config: expect.objectContaining({ model: 'custom/provider-model' }),
        })
      );
    });

    test('filter narrows the select options', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: { key: btoa('sk'), model: 'm1', expiryDuration: 86400000, expiresAt: null },
      });

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      expect(document.getElementById('modelSelect').options.length).toBeGreaterThanOrEqual(2);
      document.getElementById('modelFilter').value = 'two';
      document.getElementById('modelFilter').dispatchEvent(new window.Event('input'));
      const values = Array.from(document.getElementById('modelSelect').options).map((o) => o.value);
      // m1 kept if still selected; m2 matches filter
      expect(values).toContain('m2');
      expect(values).toContain('m1'); // previous selection preserved
    });

    test('schema hint reflects supportsStructuredOutputs', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: { key: btoa('sk'), model: 'm1', expiryDuration: 86400000, expiresAt: null },
      });

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();

      expect(document.getElementById('modelSchemaHint').textContent).toMatch(/yes/i);

      document.getElementById('modelSelect').value = 'm2';
      document.getElementById('modelSelect').dispatchEvent(new window.Event('change'));
      expect(document.getElementById('modelSchemaHint').textContent).toMatch(/no/i);
    });

    test('schema hint says unknown when the flag is missing (not "no")', async () => {
      setLocationSearch('?mode=edit');
      const unknownModels = [
        { id: 'u1', name: 'Unknown', cost: '?', curated: true },
      ];
      mockBackground({
        models: unknownModels,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: { key: btoa('sk'), model: 'u1', expiryDuration: 86400000, expiresAt: null },
      });

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();

      expect(document.getElementById('modelSchemaHint').textContent).toMatch(/unknown/i);
      expect(document.getElementById('modelSchemaHint').textContent).not.toMatch(/:\s*no/i);
    });

    test('current configuration card shows model, key, and expiry', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: {
          key: btoa('sk'),
          model: 'm1',
          expiryDuration: 86400000,
          expiresAt: null,
        },
      });

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      const card = document.getElementById('currentConfigCard');
      expect(card.hidden).toBe(false);
      expect(document.getElementById('cfgModel').textContent).toContain('Model One');
      expect(document.getElementById('cfgModelId').textContent).toBe('m1');
      expect(document.getElementById('cfgKey').textContent).toMatch(/on file/i);
      expect(document.getElementById('cfgExpiry').textContent).toMatch(/1 day|day/i);
      expect(document.getElementById('keyHelp').hidden).toBe(false);
    });

    test('edit mode can change model with an empty key field', async () => {
      setLocationSearch('?mode=edit');
      mockBackground({
        models: MODELS,
        expiryPresets: EXPIRY_PRESETS,
        modelsMeta: MODELS_META,
        config: {
          key: btoa('sk-existing'),
          model: 'm1',
          expiryDuration: 86400000,
          expiresAt: null,
        },
      });
      window.close = vi.fn();

      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = '';
      document.getElementById('modelSelect').value = 'm2';
      document.getElementById('modelSelect').dispatchEvent(new window.Event('change'));
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveAiConfig',
          config: expect.objectContaining({
            key: 'sk-existing',
            model: 'm2',
          }),
        })
      );
    });
  });

  describe('key validation and check on save', () => {
    function mockBackground() {
      chrome.runtime.sendMessage.mockImplementation(async (message) => {
        if (message.action === 'loadAiConfig') {
          return { models: MODELS, expiryPresets: EXPIRY_PRESETS, modelsMeta: MODELS_META, config: null };
        }
        if (message.action === 'saveAiConfig') return { success: true };
        return {};
      });
    }

    async function loadSetupPage() {
      setLocationSearch('');
      mockBackground();
      window.close = vi.fn();
      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();
      return mod;
    }

    async function saveWithKey(value) {
      document.getElementById('apiKeyInput').value = value;
      document.getElementById('saveButton').click();
      await flushPromises();
    }

    const saveCalls = () => chrome.runtime.sendMessage.mock.calls
      .filter(([m]) => m.action === 'saveAiConfig');

    test('a pasted "Bearer " prefix is stripped before checking and saving', async () => {
      await loadSetupPage();
      await saveWithKey('  Bearer sk-or-v1-abc  ');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/key',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer sk-or-v1-abc' }),
        })
      );
      expect(saveCalls()).toHaveLength(1);
      expect(saveCalls()[0][0].config.key).toBe('sk-or-v1-abc');
    });

    test('a key that is not an OpenRouter key is refused without a network call', async () => {
      await loadSetupPage();
      await saveWithKey('sk-proj-openai-key');

      expect(document.getElementById('errorMsg').textContent).toMatch(/start with "sk-or-"/);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(saveCalls()).toHaveLength(0);
    });

    test.each([
      ['a space', 'sk-or-v1 abc'],
      ['a non-breaking space', 'sk-or-v1\u00a0abc'],
      ['a tab', 'sk-or-v1\tabc'],
    ])('a key containing %s is refused', async (_label, key) => {
      await loadSetupPage();
      await saveWithKey(key);

      expect(document.getElementById('errorMsg').textContent).toMatch(/spaces or line breaks/);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(saveCalls()).toHaveLength(0);
    });

    test.each([401, 403])('OpenRouter answering %s means the key is not saved', async (status) => {
      await loadSetupPage();
      global.fetch.mockResolvedValue({ ok: false, status });
      await saveWithKey('sk-or-v1-revoked');

      expect(document.getElementById('errorMsg').textContent).toBe('OpenRouter rejected this key.');
      expect(saveCalls()).toHaveLength(0);
      expect(window.close).not.toHaveBeenCalled();
      expect(document.getElementById('saveButton').disabled).toBe(false);
    });

    test('a network failure during the check means the key is not saved', async () => {
      await loadSetupPage();
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      await saveWithKey('sk-or-v1-abc');

      expect(document.getElementById('errorMsg').textContent).toMatch(/could not reach openrouter/i);
      expect(saveCalls()).toHaveLength(0);
    });

    test('a key OpenRouter accepts is saved', async () => {
      await loadSetupPage();
      await saveWithKey('sk-or-v1-good');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(saveCalls()).toHaveLength(1);
      expect(window.close).toHaveBeenCalled();
    });
  });

  describe('page readiness', () => {
    test('Save stays disabled until init has filled the selects', async () => {
      setLocationSearch('');
      let answerLoad;
      chrome.runtime.sendMessage.mockImplementation((message) => {
        if (message.action === 'loadAiConfig') {
          return new Promise((resolve) => { answerLoad = resolve; });
        }
        return Promise.resolve({ success: true });
      });

      const mod = loadAiSetup();
      buildAiSetupDom();
      const pending = mod.init();
      mod.setupEventListeners();

      expect(document.getElementById('saveButton').disabled).toBe(true);

      answerLoad({ models: MODELS, expiryPresets: EXPIRY_PRESETS, modelsMeta: MODELS_META, config: null });
      await pending;

      expect(document.getElementById('expirySelect').options.length).toBeGreaterThan(0);
      expect(document.getElementById('saveButton').disabled).toBe(false);
    });

    test('Save with no expiry chosen is refused instead of sending an unparsable duration', async () => {
      setLocationSearch('');
      chrome.runtime.sendMessage.mockResolvedValue({ success: true });
      const mod = loadAiSetup();
      buildAiSetupDom(); // expirySelect has no options
      mod.setupEventListeners();

      document.getElementById('apiKeyInput').value = 'sk-or-v1-abc';
      document.getElementById('customModelId').value = 'acme/model';
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(document.getElementById('errorMsg').textContent).toBe('Please choose when the key should expire.');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveAiConfig' })
      );
    });
  });

  describe('formatModelsStatus', () => {
    test('a stale cache with a fetch error names the error once', () => {
      const mod = loadAiSetup();
      const text = mod.formatModelsStatus(
        { fromCache: true, stale: true, fetchedAt: Date.now() - 30 * 3600000, error: 'Failed to fetch' },
        312
      );
      expect(text).toBe('312 models · stale cache (30h ago) · Failed to fetch');
    });
  });

  describe('custom model id and the list', () => {
    function mockBackground() {
      chrome.runtime.sendMessage.mockImplementation(async (message) => {
        if (message.action === 'loadAiConfig') {
          return {
            models: MODELS,
            expiryPresets: EXPIRY_PRESETS,
            modelsMeta: MODELS_META,
            config: { key: btoa('sk-or-existing'), model: 'm1', expiryDuration: 86400000, expiresAt: null },
          };
        }
        if (message.action === 'saveAiConfig') return { success: true };
        return {};
      });
    }

    test('filtering while a custom id is typed does not add it to the list', async () => {
      setLocationSearch('?mode=edit');
      mockBackground();
      window.close = vi.fn();
      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('modelSelect').value = 'm2';
      document.getElementById('modelSelect').dispatchEvent(new window.Event('change'));
      document.getElementById('customModelId').value = 'foo/bar';
      document.getElementById('customModelId').dispatchEvent(new window.Event('input'));
      document.getElementById('modelFilter').value = 'model';
      document.getElementById('modelFilter').dispatchEvent(new window.Event('input'));

      const values = Array.from(document.getElementById('modelSelect').options).map((o) => o.value);
      expect(values).not.toContain('foo/bar');
      expect(document.getElementById('modelSelect').value).toBe('m2');

      // Clearing the custom field falls back to the list choice.
      document.getElementById('customModelId').value = '';
      document.getElementById('customModelId').dispatchEvent(new window.Event('input'));
      document.getElementById('saveButton').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveAiConfig',
          config: expect.objectContaining({ model: 'm2' }),
        })
      );
    });

    test('a custom id not in the list shows a JSON-output warning', async () => {
      setLocationSearch('?mode=edit');
      mockBackground();
      const mod = loadAiSetup();
      buildAiSetupDom();
      await mod.init();
      mod.setupEventListeners();

      document.getElementById('customModelId').value = 'foo/bar';
      document.getElementById('customModelId').dispatchEvent(new window.Event('input'));

      expect(document.getElementById('modelSchemaHint').textContent)
        .toMatch(/may not support JSON output/);
    });
  });
});
