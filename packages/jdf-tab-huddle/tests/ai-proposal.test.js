import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// The organize page (src/ai-proposal.html + ai-proposal.js, with the shared
// ai-config.js): each test loads the real page markup and runs the page
// scripts against it. The worker end of a run is a fake port: the test posts
// what the worker would post, or closes it.

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(__dirname, '../src/ai-proposal.js'), 'utf8');
const configSource = readFileSync(resolve(__dirname, '../src/ai-config.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '../src/ai-proposal.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '');

const MODELS = [
  { id: 'm1', name: 'Model One', provider: 'Acme', cost: '$1.00 in per M', curated: true, supportsStructuredOutputs: true },
  { id: 'm2', name: 'Model Two', provider: 'Acme', cost: '$2.00 in per M', curated: false, supportsStructuredOutputs: false },
];
const EXPIRY_PRESETS = [{ value: 86400000, label: '1 day' }, { value: null, label: 'Never' }];
const MODELS_META = { fetchedAt: Date.now(), fromCache: true, stale: false, fallback: false, error: null };
const KEYED = { key: btoa('sk-or-k'), model: 'm1', expiresAt: null, expiryDuration: 86400000 };

const PROPOSAL = {
  type: 'ai-proposal',
  groups: [
    { name: 'Group A', color: 'blue', tabIds: [1, 2] },
    { name: 'Group B', color: 'red', tabIds: [3] },
  ],
  ungroupedTabIds: [4],
  tabs: [
    { id: 1, title: 'One', url: 'https://a.example.com/1' },
    { id: 2, title: 'Two', url: 'https://a.example.com/2' },
    { id: 3, title: 'Three', url: 'https://b.example.com/3' },
    { id: 4, title: 'Four', url: 'https://c.example.com/4' },
  ],
  windowId: 42,
  model: 'm1',
  modelName: 'Model One',
};

// Every page load adds document listeners; the previous page's are removed
// so only one page reacts to a key.
const docListeners = [];
const addDocListener = document.addEventListener.bind(document);
document.addEventListener = (type, fn, opts) => {
  docListeners.push([type, fn, opts]);
  addDocListener(type, fn, opts);
};

let ports;
let pageExports;
let storageListener;

function makePort() {
  const onMessage = [];
  const onDisconnect = [];
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: (fn) => onMessage.push(fn) },
    onDisconnect: { addListener: (fn) => onDisconnect.push(fn) },
    emit: (msg) => onMessage.forEach((fn) => fn(msg)),
    drop: () => onDisconnect.forEach((fn) => fn()),
    startMessage: () => port.postMessage.mock.calls.map((c) => c[0]).find((m) => m.type === 'start'),
  };
  return port;
}

// replies: action -> reply object, or (message) => reply.
function loadPage({ search = '?respectGroups=true', config = KEYED, replies = {}, reloaded = false } = {}) {
  for (const [type, fn, opts] of docListeners.splice(0)) document.removeEventListener(type, fn, opts);
  Object.defineProperty(window, 'location', {
    value: { search, href: `chrome-extension://test-id/ai-proposal.html${search}` },
    writable: true,
    configurable: true,
  });
  window.history.replaceState = vi.fn();
  window.performance.getEntriesByType = () => [{ type: reloaded ? 'reload' : 'navigate' }];
  const all = {
    loadAiConfig: { protocol: 2, config, expiryPresets: EXPIRY_PRESETS, defaultModel: 'm1' },
    loadOpenRouterModels: { success: true, models: MODELS, modelsMeta: MODELS_META },
    cancelAiProposal: { success: true },
    ...replies,
  };
  chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
    if (!(msg.action in all)) return;
    const reply = all[msg.action];
    const value = typeof reply === 'function' ? reply(msg) : reply;
    if (cb && value !== undefined) cb(value);
  });
  chrome.runtime.connect.mockImplementation(() => {
    const port = makePort();
    ports.push(port);
    return port;
  });
  document.body.innerHTML = body;
  pageExports = eval(`(function() { ${configSource}\n${pageSource}\n return { moveTab, renderGroup }; })()`);
  const calls = chrome.storage.onChanged.addListener.mock.calls;
  storageListener = calls.length ? calls[calls.length - 1][0] : null;
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

const $ = (id) => document.getElementById(id);
const content = () => $('content');
const sent = (action) => chrome.runtime.sendMessage.mock.calls.map(([m]) => m).filter((m) => m.action === action);
const buttons = () => Array.from(document.querySelectorAll('#content button')).map((b) => b.textContent);
const buttonNamed = (label) => Array.from(document.querySelectorAll('#content button')).find((b) => b.textContent === label);
const titlesIn = (card) => Array.from(card.querySelectorAll('.tab-title')).map((el) => el.textContent);
const key = (k, opts = {}) => document.activeElement.dispatchEvent(
  new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

async function organize(instructions = '') {
  $('userInstructions').value = instructions;
  $('startOrganize').click();
  await flush();
  return ports[ports.length - 1];
}

async function toProposal(msg = PROPOSAL) {
  const port = await organize();
  port.emit({ type: 'started', protocol: 2 });
  port.emit(msg);
  return port;
}

beforeEach(() => {
  ports = [];
  window.close = vi.fn();
  window.sessionStorage.clear();
  chrome.runtime.lastError = null;
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  chrome.runtime.lastError = null;
});

describe('starting a run', () => {
  test('Organize opens a port and starts a run with the instructions, the default model and the mode', async () => {
    loadPage({ search: '?respectGroups=false' });
    await flush();
    const port = await organize('by site');
    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'huddle-ai-run' });
    expect(port.startMessage()).toEqual({
      type: 'start', protocol: 2, instructions: 'by site', model: null, respectGroups: false,
    });
    expect($('loadingText').textContent).toBe('Starting…');
    // Focus goes to the progress, not Stop, so a second Enter can't stop it.
    expect(document.activeElement).toBe($('runProgress'));
  });

  test('a second Enter right after Organize does not stop the run', async () => {
    loadPage();
    await flush();
    const port = await organize();
    // Enter on whatever has focus now: never Stop.
    expect(document.activeElement.id).not.toBe('stopRun');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.activeElement.click();
    await flush();
    expect(port.disconnect).not.toHaveBeenCalled();
    expect($('stopRun')).not.toBeNull();
  });

  test('Organize waits for the config before it can run', async () => {
    loadPage({ replies: { loadAiConfig: () => undefined } });
    expect($('startOrganize').disabled).toBe(true);
  });

  test('a double click is one run', async () => {
    loadPage();
    await flush();
    const organizeButton = $('startOrganize');
    organizeButton.click();
    organizeButton.click();
    await flush();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
  });

  test('Cmd/Ctrl+Enter in the instructions organizes', async () => {
    loadPage();
    await flush();
    $('userInstructions').focus();
    key('Enter', { metaKey: true });
    await flush();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
  });

  test('status updates go to a live region too', async () => {
    loadPage();
    await flush();
    const port = await organize();
    port.emit({ type: 'ai-status', text: 'Asking Model One…' });
    expect($('loadingText').textContent).toBe('Asking Model One…');
    expect($('runStatus').textContent).toBe('Asking Model One…');
  });
});

describe('a run\'s end, whatever ends it', () => {
  test('a proposal renders, names its model and puts focus on Apply', async () => {
    loadPage();
    await flush();
    await toProposal();
    expect(content().querySelectorAll('.group-card')).toHaveLength(3);
    expect(document.querySelector('.proposal-head').textContent).toBe('Proposal from Model One · 2 groups, 3 tabs');
    expect($('actionsContainer').hidden).toBe(false);
    expect(document.activeElement).toBe($('applyButton'));
    expect($('runStatus').textContent).toBe('Proposal ready: 2 groups, 3 tabs.');
  });

  test('Stop closes the port and brings the form back with the instructions', async () => {
    loadPage();
    await flush();
    const port = await organize('by site');
    $('stopRun').click();
    expect(port.disconnect).toHaveBeenCalled();
    expect(content().querySelector('.ended-msg').textContent).toMatch(/^Stopped/);
    expect($('userInstructions').value).toBe('by site');
    expect($('startOrganize').textContent).toBe('Run again');
  });

  test('Escape during a run stops it', async () => {
    loadPage();
    await flush();
    const port = await organize();
    key('Escape');
    expect(port.disconnect).toHaveBeenCalled();
  });

  test('the worker going away mid-run ends the run with Run again, never a stuck spinner', async () => {
    loadPage();
    await flush();
    const port = await organize();
    port.emit({ type: 'started', protocol: 2 });
    port.drop();
    expect(content().querySelector('.ended-msg').textContent).toMatch(/This run has ended/);
    expect(buttonNamed('Run again')).toBeTruthy();
    expect(document.activeElement).toBe($('startOrganize'));
  });

  test('a port nothing answers, twice, is an old worker: Reload Huddle', async () => {
    vi.useFakeTimers();
    try {
      loadPage();
      await vi.runAllTimersAsync();
      $('startOrganize').click();
      chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      ports[0].drop();
      await vi.advanceTimersByTimeAsync(400);
      ports[1].drop();
      chrome.runtime.lastError = null;
      expect(content().textContent).toMatch(/Reload Huddle to continue/);
      expect(buttons()).toEqual(['Reload Huddle', 'Cancel']);
      // Like every other state, it shows its keys.
      expect(content().querySelector('.keys-hint').textContent).toMatch(/reload.*Esc.*close/s);
      $('reloadHuddle').click();
      expect(chrome.runtime.reload).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('an old worker is spotted on load (no protocol in its reply)', async () => {
    loadPage({ replies: { loadAiConfig: { config: KEYED, expiryPresets: EXPIRY_PRESETS } } });
    await flush();
    expect(buttonNamed('Reload Huddle')).toBeTruthy();
  });

  test('an old worker that closes the port on loadAiConfig is spotted too', async () => {
    loadPage({
      replies: {
        loadAiConfig: () => {
          chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
          return null;
        },
      },
    });
    await flush();
    chrome.runtime.lastError = null;
    expect(content().textContent).not.toMatch(/message port closed/);
    expect(buttonNamed('Reload Huddle')).toBeTruthy();
  });

  test('messages from an earlier run never reach a later one', async () => {
    loadPage();
    await flush();
    const first = await toProposal();
    $('runAgainButton').click();
    await flush();
    const second = ports[1];
    expect(first.disconnect).toHaveBeenCalled();
    first.emit({ type: 'ai-chunk', text: 'old run text' });
    first.emit({ ...PROPOSAL, groups: [{ name: 'Old', color: 'grey', tabIds: [1] }] });
    expect(content().querySelector('.group-card')).toBeNull();
    second.emit({ type: 'ai-error', kind: 'model', error: 'Model One refused.' });
    expect(content().querySelector('.error-msg').textContent).toBe('Model One refused.');
  });
});

describe('errors offer the way out that fits', () => {
  async function errorWith(msg) {
    loadPage();
    await flush();
    const port = await organize('keep these');
    port.emit({ type: 'started', protocol: 2 });
    port.emit({ type: 'ai-error', ...msg });
  }

  test('a model error: Retry and Change model, the instructions kept, focus on Retry', async () => {
    await errorWith({ kind: 'model', error: 'DeepInfra refused.' });
    expect(buttons()).toEqual(expect.arrayContaining(['Retry', 'Change model', 'Cancel']));
    expect(buttons()).not.toContain('Open Settings');
    expect($('userInstructions').value).toBe('keep these');
    expect(document.activeElement).toBe($('startOrganize'));
    buttonNamed('Change model').click();
    expect($('modelPanel').hidden).toBe(false);
  });

  test('a missing key goes straight to the key form, not to a dead-end error', async () => {
    await errorWith({ kind: 'key', needsKey: 'missing', error: 'Huddle has no OpenRouter key yet.' });
    expect(content().querySelector('.error-msg')).toBeNull();
    expect($('keySetup').hidden).toBe(false);
    expect($('startOrganize').textContent).toBe('Save key and organize');
    expect(document.activeElement).toBe($('inlineKeyInput'));
  });

  test('a rejected key says so and shows the key form', async () => {
    await errorWith({ kind: 'key', needsKey: 'rejected', error: 'OpenRouter rejected your saved key (401).' });
    // Said once, as the key form's intro, not again in an error box.
    expect(content().querySelector('.error-msg')).toBeNull();
    expect($('keySetup').hidden).toBe(false);
    expect($('keyIntro').textContent).toBe('OpenRouter rejected your saved key (401).');
    expect($('debugToggle').hidden).toBe(true);
  });

  test('a batch model offers Change model as the primary action, not Retry', async () => {
    await errorWith({ kind: 'model', retryable: false, error: 'm1 is a batch model.' });
    expect($('startOrganize').textContent).toBe('Change model');
    expect(buttons()).not.toContain('Retry');
    key('Enter', { ctrlKey: true });
    await flush();
    expect(ports).toHaveLength(1);
    expect($('modelPanel').hidden).toBe(false);
    $('runSelect').value = 'm2';
    $('runSelect').dispatchEvent(new window.Event('change'));
    expect($('startOrganize').textContent).toBe('Organize');
  });

  test('a model with no endpoint (404) leads with Change model, not a Retry that fails again', async () => {
    await errorWith({ kind: 'model', retryable: false, error: 'Model One isn\'t available on OpenRouter right now (404). Pick another model.' });
    expect($('startOrganize').textContent).toBe('Change model');
    expect(document.activeElement).toBe($('startOrganize'));
    $('startOrganize').click();
    await flush();
    expect(ports).toHaveLength(1);
    expect($('modelPanel').hidden).toBe(false);
    // Enter on another model lands on the button that now runs it.
    $('runSelect').value = 'm2';
    $('runSelect').dispatchEvent(new window.Event('change'));
    $('runSelect').focus();
    key('Enter');
    expect($('startOrganize').textContent).toBe('Organize');
    expect(document.activeElement).toBe($('startOrganize'));
  });

  test('not enough credits (402) leads with Add credits, which then turns into Retry', async () => {
    chrome.tabs.create.mockClear();
    await errorWith({ kind: 'credits', retryable: false, error: 'OpenRouter needs more credits to run Model One (402).' });
    expect($('startOrganize').textContent).toBe('Add credits');
    expect(buttons()).toEqual(expect.arrayContaining(['Change model', 'Cancel']));
    expect(buttons().filter((b) => b === 'Add credits')).toHaveLength(1);
    let now = 5000000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      $('startOrganize').focus();
      key('Enter', { metaKey: true });
      await flush();
      expect(ports).toHaveLength(1);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://openrouter.ai/settings/credits' });
      expect($('startOrganize').textContent).toBe('Retry');
      // A quick second Enter lands on the button that now reads Retry: nothing
      // is sent, since the run would fail with 402 again.
      now += 150;
      key('Enter', { metaKey: true });
      await flush();
      expect(ports).toHaveLength(1);
      // A deliberate Retry a moment later runs.
      now += 800;
      key('Enter', { metaKey: true });
      await flush();
      expect(ports).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  test('a quick second Enter after a run that errored fast presses nothing', async () => {
    chrome.tabs.create.mockClear();
    loadPage();
    await flush();
    let now = 1000000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      // Enter on Organize: the keydown, then the click it activates.
      $('startOrganize').focus();
      key('Enter');
      $('startOrganize').click();
      await flush();
      const port = ports[0];
      port.emit({ type: 'started', protocol: 2 });
      now += 50;
      port.emit({ type: 'ai-error', kind: 'credits', retryable: false, error: 'OpenRouter needs more credits (402).' });
      expect($('startOrganize').textContent).toBe('Add credits');
      expect(document.activeElement).toBe($('startOrganize'));
      now += 350;
      const second = key('Enter', { metaKey: true });
      await flush();
      expect(second).toBe(false);
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(ports).toHaveLength(1);
      // Focus the user moves is theirs: Cmd+Enter from the instructions works.
      $('userInstructions').focus();
      key('Enter', { metaKey: true });
      await flush();
      expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
      // And so does a deliberate press on the focused button a moment later.
      $('startOrganize').focus();
      now += 600;
      key('Enter', { metaKey: true });
      await flush();
      expect(ports).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  test('after a failure Retry can\'t fix and another model picked, the note names the button on the page', async () => {
    await errorWith({ kind: 'model', retryable: false, error: 'Model One isn\'t available on OpenRouter right now (404). Pick another model.' });
    $('startOrganize').click();
    $('runSelect').value = 'm2';
    $('runSelect').dispatchEvent(new window.Event('change'));
    expect($('startOrganize').textContent).toBe('Organize');
    expect($('modelNote').textContent).toMatch(/^That run used .+\. Organize uses .+\.$/);
    expect($('modelNote').textContent).not.toMatch(/Retry/);
  });

  test('an old worker hides the model bar: it has nothing to run', async () => {
    loadPage({ replies: { loadAiConfig: { config: KEYED, expiryPresets: EXPIRY_PRESETS } } });
    await flush();
    expect(buttonNamed('Reload Huddle')).toBeTruthy();
    expect($('modelBar').hidden).toBe(true);
  });

  test('Groups mode with nothing ungrouped offers Flat, which runs with respectGroups off', async () => {
    await errorWith({ kind: 'no-tabs', error: 'Every tab is already in a group.' });
    expect($('startOrganize').textContent).toBe('Organize all tabs (Flat)');
    $('startOrganize').click();
    await flush();
    expect(ports[1].startMessage()).toMatchObject({ respectGroups: false, instructions: 'keep these' });
  });

  test('Retry reads the instructions as edited', async () => {
    await errorWith({ kind: 'transient', error: 'Try again.' });
    $('userInstructions').value = 'changed';
    $('startOrganize').click();
    await flush();
    expect(ports[1].startMessage().instructions).toBe('changed');
  });

  test('Escape on an error closes the page', async () => {
    await errorWith({ kind: 'model', error: 'x' });
    key('Escape');
    expect(sent('cancelAiProposal')).toHaveLength(1);
  });
});

describe('a reload', () => {
  test('after a run shows it ended, with the instructions and the picked model kept', async () => {
    window.sessionStorage.setItem('huddleOrganizePage', JSON.stringify({
      instructions: 'one group per site', explicitModel: 'm2', respectGroups: true, hadRun: true,
    }));
    loadPage({ reloaded: true });
    await flush();
    expect(content().querySelector('.ended-msg').textContent).toMatch(/This run has ended/);
    expect($('userInstructions').value).toBe('one group per site');
    $('startOrganize').click();
    await flush();
    expect(ports[0].startMessage()).toMatchObject({ instructions: 'one group per site', model: 'm2' });
  });

  test('after a proposal says the proposal is gone, not that a run was cut short', async () => {
    window.sessionStorage.setItem('huddleOrganizePage', JSON.stringify({
      instructions: '', explicitModel: null, respectGroups: true, hadRun: true, hadProposal: true,
    }));
    loadPage({ reloaded: true });
    await flush();
    const text = content().querySelector('.ended-msg').textContent;
    expect(text).toMatch(/cleared the proposal that was on screen/);
    expect(text).not.toMatch(/no longer working on it/);
    expect(document.activeElement).toBe($('startOrganize'));
  });

  test('after a reload with no instructions, the page does not claim any are kept', async () => {
    window.sessionStorage.setItem('huddleOrganizePage', JSON.stringify({
      instructions: '', explicitModel: null, respectGroups: true, hadRun: true,
    }));
    loadPage({ reloaded: true });
    await flush();
    expect(content().querySelector('.ended-msg').textContent).not.toMatch(/instructions are kept/);
    expect(document.activeElement).toBe($('startOrganize'));
  });

  test('Stop says the user stopped the run', async () => {
    loadPage();
    await flush();
    const port = await organize();
    port.emit({ type: 'started', protocol: 2 });
    key('Escape');
    expect(content().querySelector('.ended-msg').textContent).toMatch(/You stopped this run/);
  });

  test('a fresh page with nothing run shows the plain form', async () => {
    loadPage({ reloaded: true });
    await flush();
    expect(content().querySelector('.ended-msg')).toBeNull();
    expect($('startOrganize').textContent).toBe('Organize');
  });
});

describe('the model bar', () => {
  test('names the saved default and marks it', async () => {
    loadPage();
    await flush();
    await flush();
    expect($('modelName').textContent).toBe('Model One');
    expect($('defaultTag').hidden).toBe(false);
    expect($('makeDefault').hidden).toBe(true);
  });

  test('a picked model goes with the next run only, and Make default saves it', async () => {
    loadPage({ replies: { saveAiDefaultModel: (m) => ({ success: true, config: { ...KEYED, model: m.model } }) } });
    await flush();
    await flush();
    $('changeModel').click();
    expect(document.activeElement).toBe($('runFilter'));
    $('runSelect').value = 'm2';
    $('runSelect').dispatchEvent(new window.Event('change'));
    expect($('modelName').textContent).toBe('Model Two');
    expect($('makeDefault').hidden).toBe(false);
    const port = await organize();
    expect(port.startMessage().model).toBe('m2');
    $('makeDefault').click();
    await flush();
    expect(sent('saveAiDefaultModel')[0]).toMatchObject({ model: 'm2' });
    expect($('modelNote').textContent).toBe('Model Two is now your default model.');
  });

  test('Escape in the list closes it and restores the model it opened with', async () => {
    loadPage();
    await flush();
    await flush();
    $('changeModel').click();
    $('runSelect').value = 'm2';
    $('runSelect').dispatchEvent(new window.Event('change'));
    $('runSelect').focus();
    key('Escape');
    expect($('modelPanel').hidden).toBe(true);
    expect($('modelName').textContent).toBe('Model One');
    expect(document.activeElement).toBe($('changeModel'));
  });

  test('Make default is not offered for an id the catalog does not list', async () => {
    loadPage();
    await flush();
    await flush();
    $('changeModel').click();
    $('runCustom').value = 'acme/typo-model';
    $('runCustom').dispatchEvent(new window.Event('input'));
    expect($('modelName').textContent).toBe('acme/typo-model');
    expect($('makeDefault').hidden).toBe(true);
  });

  test('a default changed in Settings is followed while nothing was picked here', async () => {
    loadPage();
    await flush();
    await flush();
    storageListener({ aiConfig: { newValue: { ...KEYED, model: 'm2' } } }, 'local');
    expect($('modelName').textContent).toBe('Model Two');
    const port = await organize();
    // The worker reads the default itself.
    expect(port.startMessage().model).toBeNull();
  });

  test('a key saved in Settings hides the key form', async () => {
    loadPage({ config: null });
    await flush();
    expect($('keySetup').hidden).toBe(false);
    storageListener({ aiConfig: { newValue: KEYED } }, 'local');
    expect($('keySetup').hidden).toBe(true);
    expect($('startOrganize').textContent).toBe('Organize');
  });
});

describe('the inline key form', () => {
  test('Enter in the key field checks and saves the key, then starts the run', async () => {
    loadPage({
      config: null,
      replies: { saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), model: 'm1', expiresAt: null } }) },
    });
    await flush();
    expect(document.activeElement).toBe($('inlineKeyInput'));
    $('inlineKeyInput').value = 'sk-or-v1-new';
    $('composeForm').requestSubmit();
    await flush();
    await flush();
    expect(global.fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.anything());
    expect(sent('saveAiConfig')[0].config).toEqual({ key: 'sk-or-v1-new', expiryDuration: 86400000, renew: true });
    expect(ports).toHaveLength(1);
  });

  test('a key with an invisible character is cleaned; a non-key character is refused without a request', async () => {
    loadPage({ config: null, replies: { saveAiConfig: { success: true, config: KEYED } } });
    await flush();
    $('inlineKeyInput').value = 'sk-or-good​';
    $('startOrganize').click();
    await flush();
    await flush();
    expect(sent('saveAiConfig')[0].config.key).toBe('sk-or-good');

    loadPage({ config: null });
    await flush();
    global.fetch.mockClear();
    $('inlineKeyInput').value = 'sk-or-gööd';
    $('startOrganize').click();
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
    expect($('keyError').textContent).toMatch(/character OpenRouter keys never have/);
  });

  test('an expired key says so', async () => {
    loadPage({ config: { key: null, keyExpiredAt: Date.now() - 1000, model: 'm1' } });
    await flush();
    expect($('keyIntro').textContent).toBe('Your OpenRouter key has expired. Enter it again to organize.');
  });
});

describe('the proposal', () => {
  test('picking another model with the keyboard leads to Run again, and Cmd+Enter never applies the old proposal', async () => {
    loadPage();
    await flush();
    await flush();
    await toProposal();
    expect(document.activeElement).toBe($('applyButton'));
    expect($('proposalKeys').textContent).toMatch(/apply/);
    $('changeModel').click();
    $('runFilter').value = 'two';
    $('runFilter').dispatchEvent(new window.Event('input'));
    key('ArrowDown');
    key('Enter');
    expect($('modelPanel').hidden).toBe(true);
    expect($('modelNote').textContent).toBe('This proposal came from Model One. Run again to use Model Two.');
    expect(document.activeElement).toBe($('runAgainButton'));
    expect($('runAgainButton').classList.contains('primary')).toBe(true);
    expect($('applyButton').classList.contains('primary')).toBe(false);
    expect($('runAgainButton').getAttribute('aria-keyshortcuts')).toBe('Meta+Enter Control+Enter');
    expect($('applyButton').hasAttribute('aria-keyshortcuts')).toBe(false);
    expect($('proposalKeys').textContent).toMatch(/run again/);
    key('Enter', { metaKey: true });
    await flush();
    expect(sent('applyAiProposal')).toHaveLength(0);
    expect(ports).toHaveLength(2);
    expect(ports[1].startMessage().model).toBe('m2');
  });

  test('picking back the proposal\'s own model makes Apply the primary again', async () => {
    loadPage();
    await flush();
    await flush();
    await toProposal();
    $('changeModel').click();
    $('runSelect').value = 'm2';
    $('runSelect').dispatchEvent(new window.Event('change'));
    $('runSelect').value = 'm1';
    $('runSelect').dispatchEvent(new window.Event('change'));
    $('runSelect').focus();
    key('Enter');
    expect($('applyButton').classList.contains('primary')).toBe(true);
    expect($('runAgainButton').classList.contains('primary')).toBe(false);
    expect(document.activeElement).toBe($('changeModel'));
  });

  test('the model bar sits under the title, above the proposal\'s buttons', async () => {
    loadPage();
    await flush();
    await toProposal();
    const follows = $('modelBar').compareDocumentPosition($('actionsContainer'));
    expect(follows & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('moving tabs between groups and to Ungrouped', async () => {
    loadPage();
    await flush();
    await toProposal();
    pageExports.moveTab(3, 1, '0');
    let cards = content().querySelectorAll('.group-card');
    expect(titlesIn(cards[0])).toEqual(['One', 'Two', 'Three']);
    expect(cards[1].querySelector('.tab-count').textContent).toBe('0 tabs');
    pageExports.moveTab(1, 0, 'ungrouped');
    cards = content().querySelectorAll('.group-card');
    expect(titlesIn(cards[2])).toEqual(['Four', 'One']);
  });

  test('group cards are labelled groups with list semantics', async () => {
    loadPage();
    await flush();
    await toProposal();
    const card = content().querySelector('.group-card');
    expect(card.getAttribute('role')).toBe('group');
    expect(card.getAttribute('aria-label')).toBe('Group Group A, 2 tabs');
    expect(card.querySelector('.group-name').getAttribute('aria-label')).toBe('Name of group 1');
    expect(card.querySelector('ul.tab-list > li.tab-row')).not.toBeNull();
  });

  test('the colours are one radio group: one Tab stop, arrows change the colour', async () => {
    loadPage();
    await flush();
    await toProposal();
    const group = content().querySelector('.color-select');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Colour for Group A');
    const tabbable = Array.from(group.querySelectorAll('[role="radio"]')).filter((d) => d.tabIndex === 0);
    expect(tabbable.map((d) => d.dataset.group)).toEqual(['blue']);
    tabbable[0].focus();
    key('ArrowRight');
    const card = content().querySelector('.group-card');
    expect(card.dataset.group).toBe('red');
    expect(document.activeElement.dataset.group).toBe('red');
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  });

  test('Apply sends only groups with tabs, and Ungrouped for Flat', async () => {
    loadPage();
    await flush();
    await toProposal({ ...PROPOSAL, groups: [...PROPOSAL.groups, { name: 'Empty', color: 'grey', tabIds: [] }] });
    $('applyButton').click();
    expect(sent('applyAiProposal')[0]).toEqual({
      action: 'applyAiProposal',
      groups: PROPOSAL.groups.map(({ name, color, tabIds }) => ({ name, color, tabIds })),
      ungroupedTabIds: [4],
      respectGroups: true,
      windowId: 42,
      leftOut: 0,
    });
  });

  test('Apply is off while no group has a tab, and the page says why', async () => {
    loadPage();
    await flush();
    await toProposal();
    pageExports.moveTab(3, 1, 'ungrouped');
    pageExports.moveTab(1, 0, 'ungrouped');
    pageExports.moveTab(2, 0, 'ungrouped');
    expect($('applyButton').disabled).toBe(true);
    expect($('applyBlocked').textContent).toMatch(/nothing to apply/);
    expect(content().querySelector('.proposal-head').textContent).toMatch(/0 groups, 0 tabs/);
    expect(content().querySelector('.group-empty').textContent).toMatch(/Apply skips/);
  });

  test('a failed Apply keeps the proposal and says why', async () => {
    loadPage({ replies: { applyAiProposal: { success: false, error: 'None of the proposed tabs are still in this window.' } } });
    await flush();
    await toProposal();
    $('applyButton').click();
    expect($('applyError').textContent).toBe('Couldn\'t apply the groups: None of the proposed tabs are still in this window.');
    expect($('applyButton').disabled).toBe(false);
    expect(content().querySelectorAll('.group-card')).toHaveLength(3);
  });

  test('an Apply that left tabs out says so and offers Close', async () => {
    loadPage({ replies: { applyAiProposal: { success: true, grouped: 2, groups: 1, skipped: 1, closing: false } } });
    await flush();
    await toProposal();
    $('applyButton').click();
    expect($('applyError').textContent).toBe('Grouped 2 tabs into 1 group. 1 proposed tab was closed or moved to another window, so it was left out.');
    expect(document.activeElement).toBe($('closeAfterApply'));
  });

  test('a proposed tab that closes leaves the proposal', async () => {
    loadPage();
    await flush();
    await toProposal();
    chrome.tabs.onRemoved.callListeners(3);
    expect(content().textContent).not.toContain('Three');
    // Its group had no other tab, so the card goes and the count follows.
    expect(content().textContent).not.toContain('0 tabs');
    expect(content().querySelector('.proposal-head').textContent).toMatch(/1 group, 2 tabs/);
    expect($('applyError').textContent).toMatch(/1 proposed tab was closed or moved to another window/);
    $('applyButton').click();
    expect(sent('applyAiProposal')[0].leftOut).toBe(1);
  });

  test('a proposed tab moved to another window leaves the proposal, and Apply never sends it', async () => {
    // This page's own onDetached listeners only (earlier pages' stay on the
    // shared mock).
    const shared = chrome.tabs.onDetached;
    const detached = [];
    chrome.tabs.onDetached = { addListener: (fn) => detached.push(fn) };
    try {
      loadPage();
      await flush();
      await toProposal();
      expect(detached).toHaveLength(1);
      detached.forEach((fn) => fn(2, { oldWindowId: 42, oldPosition: 1 }));
      expect(content().textContent).not.toContain('Two');
      expect(content().querySelector('.proposal-head').textContent).toMatch(/2 groups, 2 tabs/);
      expect($('applyError').textContent).toMatch(/1 proposed tab was closed or moved to another window/);
      $('applyButton').click();
      const [apply] = sent('applyAiProposal');
      expect(apply.groups).toEqual([
        { name: 'Group A', color: 'blue', tabIds: [1] },
        { name: 'Group B', color: 'red', tabIds: [3] },
      ]);
      expect(apply.ungroupedTabIds).toEqual([4]);
      expect(apply.leftOut).toBe(1);
      expect(apply.windowId).toBe(42);
    } finally {
      chrome.tabs.onDetached = shared;
    }
  });

  test('when every proposed tab is gone, the page says so and offers Run again', async () => {
    loadPage();
    await flush();
    await toProposal();
    for (const id of [1, 2, 3, 4]) chrome.tabs.onRemoved.callListeners(id);
    expect($('actionsContainer').hidden).toBe(true);
    expect(content().querySelector('.error-msg').textContent).toMatch(/Every tab in this proposal was closed/);
    expect($('startOrganize').textContent).toBe('Run again');
    expect(document.activeElement).toBe($('startOrganize'));
  });

  test('Cmd/Ctrl+Enter applies', async () => {
    loadPage();
    await flush();
    await toProposal();
    key('Enter', { ctrlKey: true });
    expect(sent('applyAiProposal')).toHaveLength(1);
  });

  test('Run again uses the instructions edited under the proposal', async () => {
    loadPage();
    await flush();
    await toProposal();
    $('userInstructions').value = 'by topic';
    $('userInstructions').dispatchEvent(new window.Event('input'));
    $('runAgainButton').click();
    await flush();
    expect(ports[1].startMessage().instructions).toBe('by topic');
  });
});

describe('the raw output', () => {
  test('the toggle is a disclosure, offered once the prompt is known', async () => {
    loadPage();
    await flush();
    const port = await organize();
    expect($('debugToggle').hidden).toBe(true);
    port.emit({ type: 'ai-debug', model: 'm1', modelName: 'Model One', messages: [{ role: 'user', content: 'Group my tabs' }] });
    expect($('debugToggle').hidden).toBe(false);
    expect($('debugToggle').getAttribute('aria-expanded')).toBe('false');
    // Before the model says anything, the section holds only the prompt.
    expect($('debugToggle').textContent).toBe('Show the prompt Huddle sent');
    port.emit({ type: 'ai-chunk', text: 'Hello ' });
    expect($('debugToggle').textContent).toBe('Hide the model\'s raw output');
    expect($('debugToggle').getAttribute('aria-expanded')).toBe('true');
    expect($('rawResponsePre').textContent).toBe('Hello ');
    port.emit(PROPOSAL);
    expect($('debugToggle').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a default the catalog no longer lists', () => {
  test('the page says so and names the model it uses instead', async () => {
    loadPage({ config: { ...KEYED, model: 'qwen/qwen3.5-flash-20260224' } });
    await flush();
    await flush();
    expect($('modelName').textContent).toBe('Model One');
    expect($('defaultTag').hidden).toBe(true);
    expect($('modelNote').textContent)
      .toBe('Your default Qwen 3.5 Flash is no longer on OpenRouter; using Model One.');
    // Make default turns the stand-in into the saved default.
    expect($('makeDefault').hidden).toBe(false);
  });

  test('offline (no catalog) the saved default stays, with no note', async () => {
    loadPage({
      config: { ...KEYED, model: 'qwen/qwen3.5-flash-20260224' },
      replies: { loadOpenRouterModels: { success: false, models: MODELS, modelsMeta: { ...MODELS_META, fallback: true } } },
    });
    await flush();
    await flush();
    expect($('modelName').textContent).toBe('Qwen 3.5 Flash');
    expect($('modelNote').textContent).toBe('');
  });
});
