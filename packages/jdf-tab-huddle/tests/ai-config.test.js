// Tests for src/ai-config.js: the key checks, key form and model picker the
// Settings page and the organize page share. HuddleAi is exposed globally by
// tests/setup.js. (Ported from the retired AI setup page's tests.)

const MODELS = [
  { id: 'm1', name: 'Model One', cost: '$0.01/tab', curated: true, supportsStructuredOutputs: true },
  { id: 'm2', name: 'Model Two', cost: '$0.02/tab', curated: false, supportsStructuredOutputs: false },
];
const EXPIRY_PRESETS = [{ value: 86400000, label: '1 day' }, { value: null, label: 'Never' }];
const MODELS_META = { fetchedAt: Date.now(), fromCache: true, stale: false, fallback: false, error: null };

function flushPromises() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('key status', () => {
  const NOW = 1_700_000_000_000;
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('formatTimeRemaining covers never, expired, hours and days', () => {
    expect(HuddleAi.formatTimeRemaining(null)).toBe('never expires');
    expect(HuddleAi.formatTimeRemaining(NOW - 1000)).toBe('expired');
    // Exactly now counts as expired.
    expect(HuddleAi.formatTimeRemaining(NOW)).toBe('expired');
    expect(HuddleAi.formatTimeRemaining(NOW + 2 * 3600000 + 15 * 60000)).toBe('expires in 2h 15m');
    expect(HuddleAi.formatTimeRemaining(NOW + 30 * 3600000)).toBe('expires in 1d 6h');
  });

  test('keyStatusLabel says on file, expires in, or expired', () => {
    expect(HuddleAi.keyStatusLabel(null)).toBe('Not set');
    expect(HuddleAi.keyStatusLabel({ key: null, model: 'm1' })).toBe('Not set');
    expect(HuddleAi.keyStatusLabel({ key: 'k', expiresAt: null })).toBe('On file · never expires');
    expect(HuddleAi.keyStatusLabel({ key: 'k', expiresAt: NOW + 3600000 })).toBe('On file · expires in 1h 0m');
    expect(HuddleAi.keyStatusLabel({ key: 'k', expiresAt: NOW - 1 })).toBe('On file · expired');
  });

  test('keyState and hasUsableKey', () => {
    expect(HuddleAi.keyState(null)).toBe('missing');
    expect(HuddleAi.keyState({ key: 'k', expiresAt: NOW - 1 })).toBe('expired');
    expect(HuddleAi.keyState({ key: 'k', expiresAt: null })).toBeNull();
    expect(HuddleAi.hasUsableKey({ key: 'k', expiresAt: NOW + 1 })).toBe(true);
    expect(HuddleAi.hasUsableKey({ key: 'k', expiresAt: NOW - 1 })).toBe(false);
  });
});

describe('formatModelsStatus', () => {
  test('a stale cache with a fetch error names the error once', () => {
    const text = HuddleAi.formatModelsStatus(
      { fromCache: true, stale: true, fetchedAt: Date.now() - 30 * 3600000, error: 'Failed to fetch' },
      312
    );
    expect(text).toBe('312 models · stale cache (30h ago) · Failed to fetch');
  });

  test('a fallback names the reason', () => {
    expect(HuddleAi.formatModelsStatus({ fallback: true, error: 'offline' }, 3))
      .toBe('Recommended only · could not load catalog: offline');
  });
});

describe('createKeyForm', () => {
  let form;

  beforeEach(() => {
    document.body.innerHTML = '<div id="mount"></div>';
    form = HuddleAi.createKeyForm(document.getElementById('mount'), { idPrefix: 't' });
    form.setExpiryPresets(EXPIRY_PRESETS, 86400000);
    // The key check goes to OpenRouter; tests decide what it answers.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  const typeKey = (value) => { form.keyInput.value = value; };

  test('builds a labelled password field, a show toggle and the expiry choice', () => {
    const input = document.getElementById('tKeyInput');
    expect(input.type).toBe('password');
    expect(document.querySelector('label[for="tKeyInput"]')).not.toBeNull();
    expect(document.getElementById('tExpiry').options.length).toBe(2);
    expect(document.getElementById('tExpiry').value).toBe('86400000');

    const toggle = document.querySelector('.key-toggle');
    toggle.click();
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    expect(input.type).toBe('password');
  });

  test('an empty field is refused', async () => {
    typeKey('   ');
    expect(await form.collect()).toEqual({ ok: false, error: 'Please enter your OpenRouter API key.' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a pasted "Bearer " prefix is stripped before checking', async () => {
    typeKey('  Bearer sk-or-v1-abc  ');
    const result = await form.collect();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-or-v1-abc' }),
      })
    );
    expect(result).toEqual({ ok: true, key: 'sk-or-v1-abc', expiryDuration: 86400000, newKey: true });
  });

  test('a key that is not an OpenRouter key is refused without a network call', async () => {
    typeKey('sk-proj-openai-key');
    const result = await form.collect();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/start with "sk-or-"/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([
    ['a space', 'sk-or-v1 abc'],
    ['a non-breaking space', 'sk-or-v1 abc'],
    ['a tab', 'sk-or-v1\tabc'],
  ])('a key containing %s is refused', async (_label, key) => {
    typeKey(key);
    const result = await form.collect();
    expect(result.error).toMatch(/spaces or line breaks/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([401, 403])('OpenRouter answering %s means the key is refused', async (status) => {
    global.fetch.mockResolvedValue({ ok: false, status });
    typeKey('sk-or-v1-revoked');
    expect(await form.collect()).toEqual({ ok: false, error: 'OpenRouter rejected this key.' });
  });

  test('another OpenRouter failure names the status', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503 });
    typeKey('sk-or-v1-abc');
    expect((await form.collect()).error).toMatch(/HTTP 503/);
  });

  test('a network failure during the check means the key is refused', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    typeKey('sk-or-v1-abc');
    expect((await form.collect()).error).toMatch(/could not reach openrouter/i);
  });

  test('"Never expires" is sent as null', async () => {
    form.expirySelect.value = 'null';
    typeKey('sk-or-v1-abc');
    expect((await form.collect()).expiryDuration).toBeNull();
  });

  test('no expiry chosen (presets not loaded yet) is refused', async () => {
    form.setExpiryPresets([], null);
    typeKey('sk-or-v1-abc');
    expect(await form.collect()).toEqual({ ok: false, error: 'Please choose when the key should expire.' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('keeping the stored key (Settings)', () => {
    test('a blank field keeps a usable stored key without re-checking it', async () => {
      const storedConfig = { key: btoa('sk-or-existing'), expiresAt: null };
      const result = await form.collect({ storedConfig, allowKeep: true });
      expect(result).toEqual({ ok: true, key: 'sk-or-existing', expiryDuration: 86400000, newKey: false });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('an expired stored key cannot be kept', async () => {
      const storedConfig = { key: btoa('sk-or-old'), expiresAt: Date.now() - 1000 };
      expect(await form.collect({ storedConfig, allowKeep: true }))
        .toEqual({ ok: false, error: 'Your key has expired. Enter it again to renew.' });
    });

    test('malformed base64 in the stored key is an error, not a throw', async () => {
      const storedConfig = { key: '***not-valid-base64***', expiresAt: null };
      expect(await form.collect({ storedConfig, allowKeep: true }))
        .toEqual({ ok: false, error: 'Could not read existing key. Please enter a new one.' });
    });

    test('without allowKeep a blank field is refused even with a stored key', async () => {
      const storedConfig = { key: btoa('sk-or-existing'), expiresAt: null };
      expect((await form.collect({ storedConfig })).ok).toBe(false);
    });
  });

  test('setKeepHint shows the hint and a matching placeholder', () => {
    form.setKeepHint('Leave blank to keep it');
    expect(document.querySelector('.key-help').hidden).toBe(false);
    expect(form.keyInput.placeholder).toMatch(/leave blank/i);
    form.setKeepHint(null);
    expect(document.querySelector('.key-help').hidden).toBe(true);
    expect(form.keyInput.placeholder).toBe('sk-or-...');
  });
});

describe('createModelPicker', () => {
  let picker;
  let onChange;

  beforeEach(() => {
    document.body.innerHTML = '<div id="mount"></div>';
    onChange = vi.fn();
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message.action === 'refreshOpenRouterModels') {
        cb({ success: true, models: MODELS, modelsMeta: MODELS_META });
      }
    });
    picker = HuddleAi.createModelPicker(document.getElementById('mount'), { idPrefix: 't', onChange });
  });

  const select = () => document.getElementById('tSelect');
  const custom = () => document.getElementById('tCustom');
  const filter = () => document.getElementById('tFilter');
  const hint = () => document.querySelector('.model-schema-hint').textContent;
  const values = () => Array.from(select().options).map((o) => o.value);

  test('lists recommended models first, in their own group', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    const groups = Array.from(select().querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups).toEqual(['Recommended', 'All models']);
    expect(select().value).toBe('m1');
    expect(picker.getModelId()).toBe('m1');
    expect(document.querySelector('.models-status').textContent).toMatch(/^2 models/);
  });

  test('filter narrows the list but keeps the current choice visible', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    filter().value = 'two';
    filter().dispatchEvent(new window.Event('input'));
    expect(values()).toContain('m2');
    expect(values()).toContain('m1');
    expect(select().value).toBe('m1');
  });

  test('schema hint follows the model', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    expect(hint()).toMatch(/yes/i);
    select().value = 'm2';
    select().dispatchEvent(new window.Event('change'));
    expect(hint()).toMatch(/no/i);
    expect(onChange).toHaveBeenLastCalledWith('m2');
  });

  test('schema hint says unknown when the flag is missing (not "no")', () => {
    picker.setCatalog([{ id: 'u1', name: 'Unknown', cost: '?', curated: true }], MODELS_META, 'u1');
    expect(hint()).toMatch(/unknown/i);
    expect(hint()).not.toMatch(/:\s*no/i);
  });

  test('a custom id overrides the list and warns about JSON output', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    custom().value = 'foo/bar';
    custom().dispatchEvent(new window.Event('input'));
    expect(picker.getModelId()).toBe('foo/bar');
    expect(hint()).toMatch(/may not support JSON output/);
    expect(onChange).toHaveBeenLastCalledWith('foo/bar');
  });

  test('filtering while a custom id is typed does not add it to the list', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    select().value = 'm2';
    select().dispatchEvent(new window.Event('change'));
    custom().value = 'foo/bar';
    custom().dispatchEvent(new window.Event('input'));
    filter().value = 'model';
    filter().dispatchEvent(new window.Event('input'));

    expect(values()).not.toContain('foo/bar');
    expect(select().value).toBe('m2');

    // Clearing the custom field falls back to the list choice.
    custom().value = '';
    custom().dispatchEvent(new window.Event('input'));
    expect(picker.getModelId()).toBe('m2');
  });

  test('choosing from the list clears a custom id', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    custom().value = 'foo/bar';
    select().value = 'm2';
    select().dispatchEvent(new window.Event('change'));
    expect(custom().value).toBe('');
    expect(picker.getModelId()).toBe('m2');
  });

  test('a saved id the catalog does not know goes in the custom field', () => {
    picker.setCatalog(MODELS, MODELS_META, 'acme/private');
    expect(custom().value).toBe('acme/private');
    expect(picker.getModelId()).toBe('acme/private');
  });

  test('setModelId selects a list model or fills the custom field', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    picker.setModelId('m2');
    expect(picker.getModelId()).toBe('m2');
    picker.setModelId('acme/x');
    expect(custom().value).toBe('acme/x');
    expect(picker.getModelId()).toBe('acme/x');
  });

  test('a curated-only catalog refreshes once and keeps the selection', async () => {
    picker.setCatalog([MODELS[0]], { fallback: true, error: 'offline' }, 'm1');
    await flushPromises();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'refreshOpenRouterModels' },
      expect.any(Function)
    );
    expect(values()).toEqual(['m1', 'm2']);
    expect(select().value).toBe('m1');
  });

  test('a full, fresh catalog does not refresh on its own', () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('a failed refresh says why and keeps the list', async () => {
    picker.setCatalog(MODELS, MODELS_META, 'm1');
    chrome.runtime.sendMessage.mockImplementation((message, cb) => cb({ models: [], error: 'HTTP 500' }));
    await picker.refresh();
    expect(document.querySelector('.models-status').textContent).toMatch(/HTTP 500/);
    expect(values()).toEqual(['m1', 'm2']);
  });
});
