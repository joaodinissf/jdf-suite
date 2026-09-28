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
    expect(HuddleAi.keyStatusLabel({ key: 'k', expiresAt: NOW - 1 })).toBe('Expired · enter it again');
    // The background removes an expired key and leaves keyExpiredAt.
    expect(HuddleAi.keyStatusLabel({ key: null, keyExpiredAt: NOW - 1 })).toBe('Expired · enter it again');
  });

  test('keyState and hasUsableKey', () => {
    expect(HuddleAi.keyState(null)).toBe('missing');
    expect(HuddleAi.keyState({ key: 'k', expiresAt: NOW - 1 })).toBe('expired');
    expect(HuddleAi.keyState({ key: 'k', expiresAt: null })).toBeNull();
    expect(HuddleAi.keyState({ key: null, keyExpiredAt: NOW - 1 })).toBe('expired');
    expect(HuddleAi.hasUsableKey({ key: 'k', expiresAt: NOW + 1 })).toBe(true);
    expect(HuddleAi.hasUsableKey({ key: 'k', expiresAt: NOW - 1 })).toBe(false);
  });
});

describe('formatModelsStatus', () => {
  test('a failed refresh says so, with the age of the list still shown', () => {
    const text = HuddleAi.formatModelsStatus(
      { fromCache: true, stale: true, fetchedAt: Date.now() - 2 * 60000, error: 'OpenRouter 502: upstream catalog unavailable' },
      312
    );
    expect(text).toBe('Couldn\'t refresh (OpenRouter 502: upstream catalog unavailable). Showing the list from 2 min ago.');
  });

  test('a fallback names the reason once', () => {
    expect(HuddleAi.formatModelsStatus({ fallback: true, error: 'couldn\'t reach OpenRouter' }, 3))
      .toBe('Recommended only · couldn\'t reach OpenRouter');
  });

  test('a cached list gives its age', () => {
    expect(HuddleAi.formatModelsStatus({ fromCache: true, fetchedAt: Date.now() - 3 * 3600000 }, 14))
      .toBe('14 models · updated 3 h ago');
  });
});

describe('optionLabel', () => {
  test('name, provider and price, with no duplicate "(free)"', () => {
    expect(HuddleAi.optionLabel({ name: 'GPT-6 Luna', provider: 'OpenAI', cost: '$1.50 in · $6.00 out per M' }))
      .toBe('GPT-6 Luna · OpenAI · $1.50 in · $6.00 out per M');
    expect(HuddleAi.optionLabel({ name: 'Llama 4 Scout (free)', provider: 'Meta', cost: 'free' }))
      .toBe('Llama 4 Scout (free) · Meta');
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
    expect((await form.collect()).error).toMatch(/couldn.t reach openrouter to check/i);
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
    expect(form.keyInput.placeholder).toBe('Key on file · paste to replace');
    form.setKeepHint(null);
    expect(document.querySelector('.key-help').hidden).toBe(true);
    expect(form.keyInput.placeholder).toBe('sk-or-…');
  });
});

describe('createModelPicker', () => {
  let picker;
  let onChange;
  let onCommit;
  let onCancel;
  let catalog;

  beforeEach(() => {
    document.body.innerHTML = '<div id="mount"></div>';
    onChange = vi.fn();
    onCommit = vi.fn();
    onCancel = vi.fn();
    catalog = { success: true, models: MODELS, modelsMeta: MODELS_META };
    chrome.runtime.lastError = null;
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (/OpenRouterModels$/.test(message.action)) cb(catalog);
    });
    picker = HuddleAi.createModelPicker(document.getElementById('mount'), {
      idPrefix: 't', onChange, onCommit, onCancel,
    });
  });

  const select = () => document.getElementById('tSelect');
  const custom = () => document.getElementById('tCustom');
  const filter = () => document.getElementById('tFilter');
  const hint = () => document.querySelector('.model-schema-hint').textContent;
  const status = () => document.querySelector('.models-status').textContent;
  const values = () => Array.from(select().options).map((o) => o.value);
  const typeFilter = (text) => {
    filter().value = text;
    filter().dispatchEvent(new window.Event('input'));
  };
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));

  async function loadWith(id) {
    picker.setModelId(id);
    await picker.load();
  }

  test('loads the catalog on its own, recommended models first', async () => {
    await loadWith('m1');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'loadOpenRouterModels' }, expect.any(Function));
    const groups = Array.from(select().querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups).toEqual(['Recommended', 'All models']);
    expect(select().value).toBe('m1');
    expect(picker.getModelId()).toBe('m1');
    expect(status()).toMatch(/^2 models/);
  });

  test('the filter applies to every model, the current choice included', async () => {
    await loadWith('m1');
    typeFilter('two');
    expect(values()).toEqual(['m2']);
    // The choice is still the choice; it just is not a row now.
    expect(picker.getModelId()).toBe('m1');
    expect(select().selectedIndex).toBe(-1);
    expect(status()).toBe('1 of 2 models');
  });

  test('a filter with no matches says so', async () => {
    await loadWith('m1');
    typeFilter('zzzz');
    expect(values()).toEqual([]);
    expect(document.querySelector('.models-empty').hidden).toBe(false);
    expect(document.querySelector('.models-empty').textContent).toBe('No models match "zzzz".');
    // Said once: the status line keeps the catalog count, not "No matches".
    expect(status()).not.toMatch(/match/i);
  });

  test('the chosen model is named with its price, even when the filter hides it', async () => {
    await loadWith('m1');
    const choice = () => document.querySelector('.model-choice').textContent;
    expect(choice()).toMatch(/^Chosen: /);
    typeFilter('zzzz');
    expect(choice()).toMatch(/^Chosen: /);
    expect(choice()).not.toBe('Chosen: ');
  });

  test('a model without strict answers gets a plain warning; others none', async () => {
    await loadWith('m1');
    expect(hint()).toBe('');
    select().value = 'm2';
    select().dispatchEvent(new window.Event('change'));
    expect(hint()).toMatch(/exact answer format/);
    expect(hint()).not.toMatch(/structured|schema|JSON/i);
    expect(onChange).toHaveBeenLastCalledWith('m2');
  });

  test('an unknown structured-output flag says nothing', async () => {
    catalog = { models: [{ id: 'u1', name: 'Unknown', cost: '?', curated: true }], modelsMeta: MODELS_META };
    await loadWith('u1');
    expect(hint()).toBe('');
  });

  test('a typed id overrides the list, and the list shows no selection', async () => {
    await loadWith('m1');
    custom().value = 'foo/bar';
    custom().dispatchEvent(new window.Event('input'));
    expect(picker.getModelId()).toBe('foo/bar');
    expect(select().selectedIndex).toBe(-1);
    expect(hint()).toMatch(/Not in OpenRouter's list/);
    expect(onChange).toHaveBeenLastCalledWith('foo/bar');
    expect(picker.isListed('foo/bar')).toBe(false);

    // Clearing it falls back to the list choice.
    custom().value = '';
    custom().dispatchEvent(new window.Event('input'));
    expect(picker.getModelId()).toBe('m1');
    expect(select().value).toBe('m1');
  });

  test('a typed batch id gets its own message', async () => {
    await loadWith('m1');
    custom().value = 'openai/gpt-6-luna:batch';
    custom().dispatchEvent(new window.Event('input'));
    expect(hint()).toMatch(/Batch models can't organize tabs/);
  });

  test('choosing from the list clears a typed id', async () => {
    await loadWith('m1');
    custom().value = 'foo/bar';
    select().value = 'm2';
    select().dispatchEvent(new window.Event('change'));
    expect(custom().value).toBe('');
    expect(picker.getModelId()).toBe('m2');
  });

  test('a saved id the catalog does not know goes in the id field', async () => {
    await loadWith('acme/private');
    expect(custom().value).toBe('acme/private');
    expect(picker.getModelId()).toBe('acme/private');
  });

  test('ArrowDown in the filter moves into the list; Enter commits; Escape cancels', async () => {
    await loadWith('m1');
    typeFilter('two');
    key(filter(), 'ArrowDown');
    expect(document.activeElement).toBe(select());
    expect(picker.getModelId()).toBe('m2');
    key(select(), 'Enter');
    expect(onCommit).toHaveBeenCalled();
    key(select(), 'Escape');
    expect(onCancel).toHaveBeenCalled();
  });

  test('Enter in the filter takes the first match', async () => {
    await loadWith('m1');
    typeFilter('two');
    key(filter(), 'Enter');
    expect(picker.getModelId()).toBe('m2');
    expect(onCommit).toHaveBeenCalled();
  });

  test('a model a refresh drops keeps its name and says it is gone', async () => {
    await loadWith('m2');
    catalog = { models: [MODELS[0]], modelsMeta: MODELS_META };
    await picker.refresh();
    expect(picker.modelName('m2')).toBe('Model Two');
    expect(hint()).toBe('OpenRouter no longer lists Model Two. Pick another model.');
  });

  test('a failed refresh says why and keeps the list', async () => {
    await loadWith('m1');
    chrome.runtime.sendMessage.mockImplementation((message, cb) => cb({ models: [], modelsMeta: { error: 'HTTP 500' } }));
    await picker.refresh();
    expect(status()).toMatch(/HTTP 500/);
    expect(values()).toEqual(['m1', 'm2']);
  });
});

describe('request', () => {
  afterEach(() => {
    chrome.runtime.lastError = null;
  });

  test('an old worker that does not know the action reads as stale', async () => {
    chrome.runtime.sendMessage.mockImplementation((_m, cb) => cb({ success: false, error: 'unknown-action' }));
    await expect(HuddleAi.request({ action: 'x' })).rejects.toMatchObject({ stale: true });
  });

  test('a closed message port reads as stale, with a reload hint', async () => {
    chrome.runtime.sendMessage.mockImplementation((_m, cb) => {
      chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
      cb(undefined);
    });
    const err = await HuddleAi.request({ action: 'x' }).catch((e) => e);
    expect(err.stale).toBe(true);
    expect(err.message).toMatch(/Reload Huddle/);
  });
});

describe('page and worker protocol', () => {
  test('the pages and the worker agree on the protocol number', () => {
    expect(HuddleAi.PROTOCOL).toBe(AI_PROTOCOL);
  });
});
