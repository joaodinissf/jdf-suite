import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// The Settings page's AI section (src/options.js + src/options.html): key
// status, replacing the key, the expiry policy, deleting the key and the
// default model. Each test loads the real page markup and runs the page
// script against it.

const __dirname = dirname(fileURLToPath(import.meta.url));
const optionsSource = readFileSync(resolve(__dirname, '../src/options.js'), 'utf8');
const optionsHtml = readFileSync(resolve(__dirname, '../src/options.html'), 'utf8');
const optionsBody = optionsHtml.slice(optionsHtml.indexOf('<body>') + 6, optionsHtml.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '');

const MODELS = [
  { id: 'm1', name: 'Model One', cost: '$0.01/tab', curated: true, supportsStructuredOutputs: true },
  { id: 'm2', name: 'Model Two', cost: '$0.02/tab', curated: false, supportsStructuredOutputs: false },
];
const EXPIRY_PRESETS = [{ value: 86400000, label: '1 day' }, { value: null, label: 'Never' }];
const MODELS_META = { fetchedAt: Date.now(), fromCache: true, stale: false, fallback: false, error: null };

function flushPromises() {
  return new Promise((r) => setTimeout(r, 0));
}

function loadResponse(config) {
  return { protocol: 2, config, expiryPresets: EXPIRY_PRESETS, defaultModel: 'm1' };
}

// replies: action -> reply object, or (message, cb) => reply. A reply of
// undefined leaves the callback unanswered.
function loadSettingsPage(replies) {
  document.body.innerHTML = optionsBody;
  chrome.storage.sync.get.mockImplementation((_keys, cb) => cb({}));
  const all = { loadOpenRouterModels: { success: true, models: MODELS, modelsMeta: MODELS_META }, ...replies };
  chrome.runtime.sendMessage.mockImplementation((message, cb) => {
    const reply = all[message.action];
    const value = typeof reply === 'function' ? reply(message, cb) : reply;
    if (cb && value !== undefined) cb(value);
  });
  eval(`(function() { ${optionsSource} })()`);
}

const sent = (action) => chrome.runtime.sendMessage.mock.calls
  .map(([m]) => m)
  .filter((m) => m.action === action);

const $ = (id) => document.getElementById(id);

describe('Settings: AI section', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  test('the section is there, with the key form and the model picker', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null) });
    await flushPromises();

    expect($('aiSection')).not.toBeNull();
    expect($('settingsKeyInput').type).toBe('password');
    expect($('settingsExpiry').options.length).toBe(2);
    expect($('aiKeyStatus').textContent).toBe('Not set');
    expect($('aiDeleteKey').hidden).toBe(true);
  });

  test('Save stays off until the config has loaded', async () => {
    let answer;
    loadSettingsPage({ loadAiConfig: (_m, cb) => { answer = cb; } });
    expect($('aiSaveKey').disabled).toBe(true);
    expect($('aiSaveModel').disabled).toBe(true);

    answer(loadResponse(null));
    await flushPromises();
    expect($('aiSaveKey').disabled).toBe(false);
    expect($('aiSaveModel').disabled).toBe(false);
  });

  test('a config that could not be read says so, not that there is no key', async () => {
    loadSettingsPage({ loadAiConfig: { ...loadResponse(null), error: 'storage unavailable' } });
    await flushPromises();

    expect($('aiKeyStatus').textContent).toBe("Couldn't read your key status: storage unavailable");
    expect($('aiSaveKey').disabled).toBe(true);
    expect($('aiSaveModel').disabled).toBe(true);
  });

  test('shows a key on file with its expiry, and offers Delete', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm1', expiresAt: Date.now() + 2 * 3600000 + 60000, expiryDuration: 86400000 }),
    });
    await flushPromises();

    expect($('aiKeyStatus').textContent).toMatch(/^On file · expires in 2h/);
    expect($('aiDeleteKey').hidden).toBe(false);
    expect(document.querySelector('#aiKeyForm .key-help').hidden).toBe(false);
  });

  test('an expired key says so and cannot be kept by leaving the field blank', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-old'), model: 'm1', expiresAt: Date.now() - 1000, expiryDuration: 86400000 }),
    });
    await flushPromises();

    expect($('aiKeyStatus').textContent).toBe('Expired · enter it again');
    expect($('aiKeyStatus').classList.contains('expired')).toBe(true);
    expect(document.querySelector('#aiKeyForm .key-help').hidden).toBe(true);

    $('aiSaveKey').click();
    await flushPromises();
    expect($('aiKeyError').textContent).toBe('Your key has expired. Enter it again to renew.');
    expect(sent('saveAiConfig')).toHaveLength(0);
  });

  test('replacing the key checks it with OpenRouter, saves it, and keeps the default model', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-old'), model: 'm2', expiresAt: null, expiryDuration: null }),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), model: 'm2', expiresAt: Date.now() + 86400000, expiryDuration: 86400000 } }),
    });
    await flushPromises();

    $('settingsKeyInput').value = 'sk-or-v1-new';
    $('settingsExpiry').value = '86400000';
    $('aiSaveKey').click();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.anything());
    expect(sent('saveAiConfig')).toEqual([
      { action: 'saveAiConfig', config: { key: 'sk-or-v1-new', expiryDuration: 86400000, renew: true } },
    ]);
    expect($('settingsKeyInput').value).toBe('');
    expect($('aiKeyStatus').textContent).toMatch(/^On file · expires in/);
    expect($('ai-status').textContent).toBe('Key saved');
  });

  test('the expiry policy can change without re-entering a usable key', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-kept'), model: 'm1', expiresAt: null, expiryDuration: null }),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), model: 'm1', expiresAt: Date.now() + 86400000, expiryDuration: 86400000 } }),
    });
    await flushPromises();
    expect($('settingsExpiry').value).toBe('null');

    $('settingsExpiry').value = '86400000';
    $('aiSaveKey').click();
    // No key was typed, so nothing is checked and Settings doesn't say it is.
    expect($('ai-status').textContent).not.toBe('Checking the key with OpenRouter…');
    await flushPromises();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(sent('saveAiConfig')[0].config).toEqual({ key: 'sk-or-kept', expiryDuration: 86400000, renew: false });
    expect($('ai-status').textContent).toBe('Expiry saved');
  });

  test('asking to delete the key drops an earlier "Expiry saved"', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-kept'), model: 'm1', expiresAt: null, expiryDuration: null }),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), model: 'm1', expiresAt: Date.now() + 86400000, expiryDuration: 86400000 } }),
    });
    await flushPromises();
    $('settingsExpiry').value = '86400000';
    $('aiSaveKey').click();
    await flushPromises();
    expect($('ai-status').textContent).toBe('Expiry saved');

    $('aiDeleteKey').click();
    expect($('aiConfirmDelete').hidden).toBe(false);
    expect($('ai-status').textContent).toBe('');
    expect($('ai-status').classList.contains('visible')).toBe(false);
  });

  test('a key OpenRouter rejects is not saved', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null), saveAiConfig: { success: true } });
    await flushPromises();
    global.fetch.mockResolvedValue({ ok: false, status: 401 });

    $('settingsKeyInput').value = 'sk-or-v1-revoked';
    $('aiSaveKey').click();
    await flushPromises();

    expect($('aiKeyError').textContent).toBe('OpenRouter rejected this key.');
    expect($('aiKeyError').hidden).toBe(false);
    expect(sent('saveAiConfig')).toHaveLength(0);
    expect($('aiSaveKey').disabled).toBe(false);
  });

  test('a save that fails right after one that worked drops the earlier "Key saved"', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse(null),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), expiresAt: null } }),
    });
    await flushPromises();
    $('settingsKeyInput').value = 'sk-or-v1-good';
    $('aiSaveKey').click();
    await flushPromises();
    expect($('ai-status').textContent).toBe('Key saved');

    global.fetch.mockResolvedValue({ ok: false, status: 401 });
    $('settingsKeyInput').value = 'sk-or-v1-revoked';
    $('aiSaveKey').click();
    await flushPromises();
    expect($('aiKeyError').textContent).toBe('OpenRouter rejected this key.');
    expect($('ai-status').textContent).toBe('');
    expect($('ai-status').classList.contains('visible')).toBe(false);
  });

  test('with no key on file, a blank Save asks for one', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null) });
    await flushPromises();
    $('aiSaveKey').click();
    await flushPromises();
    expect($('aiKeyError').textContent).toBe('Please enter your OpenRouter API key.');
  });

  test('a failed save shows the background\'s reason', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null), saveAiConfig: { success: false, error: 'quota exceeded' } });
    await flushPromises();
    $('settingsKeyInput').value = 'sk-or-v1-abc';
    $('aiSaveKey').click();
    await flushPromises();
    expect($('aiKeyError').textContent).toBe('quota exceeded');
    // "Checking the key…" does not stay next to the error.
    expect($('ai-status').textContent).toBe('');
  });

  test('Enter in the key field saves the key', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null), saveAiConfig: { success: true, config: { key: btoa('sk-or-v1-abc'), expiresAt: null } } });
    await flushPromises();
    $('settingsKeyInput').value = 'sk-or-v1-abc';
    $('aiKeyCard').requestSubmit();
    await flushPromises();
    expect(sent('saveAiConfig')).toHaveLength(1);
  });

  test('while OpenRouter checks a key, Settings says so until the answer (L54)', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse(null),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), expiresAt: null } }),
    });
    await flushPromises();
    let answer;
    global.fetch = vi.fn(() => new Promise((r) => { answer = r; }));
    vi.useFakeTimers();
    try {
      $('settingsKeyInput').value = 'sk-or-v1-new';
      $('aiSaveKey').click();
      // Well past the fade of an ordinary status line.
      await vi.advanceTimersByTimeAsync(5000);
      expect($('ai-status').textContent).toBe('Checking the key with OpenRouter…');
      expect($('ai-status').classList.contains('visible')).toBe(true);
      answer({ ok: true, status: 200 });
      await vi.advanceTimersByTimeAsync(0);
      expect($('ai-status').textContent).toBe('Key saved');
    } finally {
      vi.useRealTimers();
    }
  });

  test('Save stays focusable while the key is checked, and a second press does nothing (L52)', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse(null),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), expiresAt: null } }),
    });
    await flushPromises();
    let answer;
    global.fetch = vi.fn(() => new Promise((r) => { answer = r; }));
    $('settingsKeyInput').value = 'sk-or-v1-new';
    $('aiSaveKey').focus();
    $('aiSaveKey').click();
    await flushPromises();

    expect($('aiSaveKey').disabled).toBe(false);
    expect($('aiSaveKey').getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe($('aiSaveKey'));
    $('aiSaveKey').click();
    $('aiKeyCard').requestSubmit();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 200 });
    await flushPromises();
    expect(sent('saveAiConfig')).toHaveLength(1);
    expect($('aiSaveKey').hasAttribute('aria-disabled')).toBe(false);
  });

  test('a key or model id error describes its field and marks it invalid, until it clears (L55)', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse(null),
      saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), expiresAt: null } }),
      saveAiDefaultModel: { success: false, error: 'No such model.' },
    });
    await flushPromises();
    const attrs = (id) => [$(id).getAttribute('aria-invalid'), $(id).getAttribute('aria-describedby')];

    global.fetch.mockResolvedValue({ ok: false, status: 401 });
    $('settingsKeyInput').value = 'sk-or-v1-revoked';
    $('aiSaveKey').click();
    await flushPromises();
    expect(attrs('settingsKeyInput')).toEqual(['true', 'aiKeyError']);

    $('settingsCustom').value = 'acme/model';
    $('settingsCustom').dispatchEvent(new window.Event('input'));
    $('aiSaveModel').click();
    await flushPromises();
    expect($('aiModelError').textContent).toBe('No such model.');
    expect(attrs('settingsCustom')).toEqual(['true', 'aiModelError']);

    // Another choice clears the model error; a key OpenRouter takes, the key's.
    $('settingsCustom').value = 'acme/other';
    $('settingsCustom').dispatchEvent(new window.Event('input'));
    expect(attrs('settingsCustom')).toEqual([null, null]);
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    $('settingsKeyInput').value = 'sk-or-v1-good';
    $('aiSaveKey').click();
    await flushPromises();
    expect(attrs('settingsKeyInput')).toEqual([null, null]);
  });

  test('Keep, focused when the delete question appears, is described by the question (L53)', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm2', expiresAt: null, expiryDuration: null }),
    });
    await flushPromises();
    $('aiDeleteKey').click();
    expect(document.activeElement).toBe($('aiConfirmDeleteNo'));
    const question = document.getElementById($('aiConfirmDeleteNo').getAttribute('aria-describedby'));
    expect(question && question.textContent).toBe('Delete the saved key?');
  });

  test('Delete key asks first, then drops the key, says so and keeps focus in the card', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm2', expiresAt: null, expiryDuration: null }),
      deleteAiKey: { success: true, config: { key: null, model: 'm2', expiresAt: null, expiryDuration: null } },
    });
    await flushPromises();

    $('aiDeleteKey').click();
    await flushPromises();
    expect(sent('deleteAiKey')).toHaveLength(0);
    expect($('aiConfirmDelete').hidden).toBe(false);
    $('aiConfirmDeleteYes').click();
    await flushPromises();

    expect(sent('deleteAiKey')).toHaveLength(1);
    expect(document.activeElement).toBe($('settingsKeyInput'));
    expect($('aiKeyStatus').textContent).toBe('Not set');
    expect($('aiDeleteKey').hidden).toBe(true);
    expect($('ai-status').textContent).toBe('Key deleted');
  });

  test('the default model picker shows the saved model and saves a new one', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm2', expiresAt: null, expiryDuration: null }),
      saveAiDefaultModel: (m) => ({ success: true, config: { key: btoa('sk-or-k'), model: m.model } }),
    });
    await flushPromises();
    expect($('settingsSelect').value).toBe('m2');

    $('settingsSelect').value = 'm1';
    $('settingsSelect').dispatchEvent(new window.Event('change'));
    $('aiSaveModel').click();
    await flushPromises();

    expect(sent('saveAiDefaultModel')).toEqual([{ action: 'saveAiDefaultModel', model: 'm1', allowUnlisted: false, denyDataCollection: true }]);
    expect($('ai-model-status').textContent).toBe('Default model: Model One');
    // Choosing a default never touches the key.
    expect(sent('saveAiConfig')).toHaveLength(0);
  });

  test('Enter in the model id field, the filter or the list saves the default model, once each (L51)', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm1', expiresAt: null, expiryDuration: null }),
      saveAiDefaultModel: (m) => ({ success: true, config: { key: btoa('sk-or-k'), model: m.model } }),
    });
    await flushPromises();
    const enter = (el) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const saved = () => sent('saveAiDefaultModel').map((m) => m.model);

    $('settingsCustom').value = 'm2';
    $('settingsCustom').dispatchEvent(new window.Event('input'));
    enter($('settingsCustom'));
    await flushPromises();
    expect(saved()).toEqual(['m2']);

    $('settingsCustom').value = '';
    $('settingsCustom').dispatchEvent(new window.Event('input'));
    $('settingsFilter').value = 'one';
    $('settingsFilter').dispatchEvent(new window.Event('input'));
    enter($('settingsFilter'));
    await flushPromises();
    expect(saved()).toEqual(['m2', 'm1']);

    enter($('settingsSelect'));
    await flushPromises();
    expect(saved()).toEqual(['m2', 'm1', 'm1']);
    expect($('ai-model-status').textContent).toBe('Default model: Model One');
  });

  test('an id the catalog does not list needs a second Save, even before a key is on file', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse(null),
      saveAiDefaultModel: (m) => (m.allowUnlisted
        ? { success: true, config: { key: null, model: m.model } }
        : { success: false, unlisted: true, error: `${m.model} isn't in OpenRouter's list of models Huddle can use.` }),
    });
    await flushPromises();
    $('settingsCustom').focus(); // With no key, the list loads once it is used.
    await flushPromises();
    expect($('settingsSelect').value).toBe('m1'); // the built-in default

    $('settingsCustom').value = 'acme/model';
    $('settingsCustom').dispatchEvent(new window.Event('input'));
    expect(document.querySelector('#aiModelPicker .model-schema-hint').textContent)
      .toMatch(/Not in OpenRouter's list/);
    $('aiSaveModel').click();
    await flushPromises();
    expect($('aiModelError').textContent).toMatch(/Save again to keep it anyway/);
    $('aiSaveModel').click();
    await flushPromises();

    expect(sent('saveAiDefaultModel')).toEqual([
      { action: 'saveAiDefaultModel', model: 'acme/model', allowUnlisted: false, denyDataCollection: true },
      { action: 'saveAiDefaultModel', model: 'acme/model', allowUnlisted: true, denyDataCollection: true },
    ]);
    expect($('ai-model-status').textContent).toBe('Default model: acme/model');
  });
});

describe('Settings: a default the catalog no longer lists', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
  });

  test('says so, and shows the model organize uses instead', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse({ key: null, model: 'qwen/qwen3.5-flash-20260224' }) });
    await flushPromises();
    $('settingsFilter').focus();
    await flushPromises();
    await flushPromises();
    expect($('aiDefaultNote').hidden).toBe(false);
    expect($('aiDefaultNote').textContent)
      .toBe('Your default Qwen 3.5 Flash is no longer on OpenRouter; using Model One. Save a default model to keep one.');
    expect($('settingsSelect').value).toBe('m1');
  });

  test('a listed default has no note', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse({ key: null, model: 'm2' }) });
    await flushPromises();
    $('settingsFilter').focus();
    await flushPromises();
    await flushPromises();
    expect($('aiDefaultNote').hidden).toBe(true);
    expect($('settingsSelect').value).toBe('m2');
  });
});

// L25: Settings contacts OpenRouter (the catalog the worker fetches for
// loadOpenRouterModels) only with a key on file, or once the model list is
// used; PRODUCT.md says so.
describe('Settings: the model catalog loads only when needed', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
  });

  test('with no key, nothing is fetched until focus enters the picker, then once', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null) });
    await flushPromises();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(0);
    expect($('settingsSelect').options.length).toBe(0);

    $('settingsSelect').focus();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(1);
    expect($('settingsSelect').options.length).toBe(2);

    $('settingsCustom').focus();
    $('settingsFilter').focus();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(1);
  });

  test('with no key, the recommended models show before the catalog, with nothing fetched (D4)', async () => {
    loadSettingsPage({ loadAiConfig: { ...loadResponse(null), models: [{ id: 'm1', name: 'Model one' }] } });
    await flushPromises();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(0);
    expect([...$('settingsSelect').options].map((o) => o.value)).toEqual(['m1']);
    expect(document.querySelector('#aiModelPicker').textContent).toContain('Recommended models');

    $('settingsSelect').focus();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(1);
    expect($('settingsSelect').options.length).toBe(2);
  });

  test.each(['settingsFilter', 'settingsCustom'])('focus in %s loads it too', async (id) => {
    loadSettingsPage({ loadAiConfig: loadResponse({ key: null, model: 'm2', keyExpiredAt: 1 }) });
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(0);
    $(id).focus();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(1);
  });

  test('with a key on file, it loads at once', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm2', expiresAt: null, expiryDuration: null }) });
    await flushPromises();
    await flushPromises();
    expect(sent('loadOpenRouterModels')).toHaveLength(1);
    expect($('settingsSelect').value).toBe('m2');
  });
});

// L24: the data-collection checkbox, on by default, saved with the model.
describe('Settings: don\'t use providers that train on my prompts', () => {
  beforeEach(() => {
    chrome.runtime.lastError = null;
  });

  test('its label, on with nothing stored', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null) });
    await flushPromises();
    expect(document.querySelector('label[for="aiDenyDataCollection"]').textContent)
      .toBe('Don\'t use providers that train on my prompts');
    expect($('aiDenyDataCollection').checked).toBe(true);
  });

  test('shows a stored off, and Save sends what it shows', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse({ key: btoa('sk-or-k'), model: 'm1', expiresAt: null, expiryDuration: null, denyDataCollection: false }),
      saveAiDefaultModel: (m) => ({ success: true, config: { key: btoa('sk-or-k'), model: m.model, denyDataCollection: m.denyDataCollection } }),
    });
    await flushPromises();
    expect($('aiDenyDataCollection').checked).toBe(false);
    $('aiSaveModel').click();
    await flushPromises();
    $('aiDenyDataCollection').checked = true;
    $('aiSaveModel').click();
    await flushPromises();
    expect(sent('saveAiDefaultModel').map((m) => m.denyDataCollection)).toEqual([false, true]);
  });
});
