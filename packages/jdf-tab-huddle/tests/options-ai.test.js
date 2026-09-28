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
    expect($('settingsSelect').options.length).toBe(2);
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
  });

  test('Enter in the key field saves the key', async () => {
    loadSettingsPage({ loadAiConfig: loadResponse(null), saveAiConfig: { success: true, config: { key: btoa('sk-or-v1-abc'), expiresAt: null } } });
    await flushPromises();
    $('settingsKeyInput').value = 'sk-or-v1-abc';
    $('aiKeyCard').requestSubmit();
    await flushPromises();
    expect(sent('saveAiConfig')).toHaveLength(1);
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

    expect(sent('saveAiDefaultModel')).toEqual([{ action: 'saveAiDefaultModel', model: 'm1', allowUnlisted: false }]);
    expect($('ai-model-status').textContent).toBe('Default model: Model One');
    // Choosing a default never touches the key.
    expect(sent('saveAiConfig')).toHaveLength(0);
  });

  test('an id the catalog does not list needs a second Save, even before a key is on file', async () => {
    loadSettingsPage({
      loadAiConfig: loadResponse(null),
      saveAiDefaultModel: (m) => (m.allowUnlisted
        ? { success: true, config: { key: null, model: m.model } }
        : { success: false, unlisted: true, error: `${m.model} isn't in OpenRouter's list of models Huddle can use.` }),
    });
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
      { action: 'saveAiDefaultModel', model: 'acme/model', allowUnlisted: false },
      { action: 'saveAiDefaultModel', model: 'acme/model', allowUnlisted: true },
    ]);
    expect($('ai-model-status').textContent).toBe('Default model: acme/model');
  });
});
