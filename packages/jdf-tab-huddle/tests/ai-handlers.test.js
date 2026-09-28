// Tests for the organize flow in src/background.js: the popup's O
// (handleAiGroupTabs), runs over the organize page's port (onConnect), Apply
// and the stored key and default model. Exposed globally by tests/setup.js.

const HAIKU = 'anthropic/claude-haiku-4.5';
const TABS = [
  { id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 },
  { id: 21, url: 'https://y.com', title: 'Y', pinned: false, groupId: -1 },
];

function jsonAnswer(content) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
  };
}

function errorAnswer(status, message, provider) {
  const error = { code: status, message };
  if (provider) error.metadata = { provider_name: provider };
  return { ok: false, status, text: async () => JSON.stringify({ error }) };
}

const groupsFor = (ids) => JSON.stringify({ groups: [{ name: 'G', color: 'blue', tabIds: ids }] });

// A fake of the port the organize page opens. connect() runs the worker's
// onConnect listener with it; start() sends the page's start message.
function makePort(tab = { id: 10, windowId: 1 }) {
  const onMessage = [];
  const onDisconnect = [];
  const port = {
    name: 'huddle-ai-run',
    sender: tab ? { tab } : {},
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: (fn) => onMessage.push(fn) },
    onDisconnect: { addListener: (fn) => onDisconnect.push(fn) },
    send: (msg) => onMessage.forEach((fn) => fn(msg)),
    close: () => onDisconnect.forEach((fn) => fn()),
    posted: () => port.postMessage.mock.calls.map((c) => c[0]),
    types: () => port.posted().map((m) => m.type),
    last: (type) => port.posted().filter((m) => m.type === type).at(-1),
  };
  chrome.runtime.onConnect.callListeners(port);
  return port;
}

function start(port, extra = {}) {
  port.send({ type: 'start', protocol: AI_PROTOCOL, instructions: '', model: null, respectGroups: true, ...extra });
}

// Resolves once the run has posted a proposal or an error.
async function settled(port) {
  await vi.waitFor(() => expect(port.types().some((t) => t === 'ai-proposal' || t === 'ai-error')).toBe(true));
}

function mockConfig(config) {
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    return list.includes('aiConfig') && config ? { aiConfig: config } : {};
  });
}

beforeEach(() => {
  mockConfig({ key: btoa('sk-or-good'), expiresAt: null, model: HAIKU });
  chrome.storage.local.set.mockResolvedValue(undefined);
  chrome.tabs.query.mockResolvedValue(TABS);
  chrome.tabGroups.query.mockResolvedValue([]);
  chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
  global.fetch = vi.fn().mockResolvedValue(jsonAnswer(groupsFor([20, 21])));
});

describe('handleAiGroupTabs - the popup\'s O', () => {
  test('opens the organize page in the popup\'s window with the Groups/Flat choice, and starts nothing', async () => {
    chrome.tabs.query.mockResolvedValue([]);
    chrome.tabs.create.mockResolvedValue({ id: 10, windowId: 1 });
    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: false }, sendResponse);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-proposal.html?respectGroups=false',
      active: true,
      windowId: 1,
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'opened' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('brings back the organize page already open in that window, with the popup\'s mode', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 44, windowId: 1 }]);
    chrome.tabs.sendMessage.mockResolvedValue(undefined);
    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: true }, sendResponse);
    expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 1, url: 'chrome-extension://test-id/ai-proposal.html*' });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(44, { active: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(44, { type: 'ai-set-mode', respectGroups: true });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'focused' });
  });

  test('a failing tabs.create answers the popup with the reason', async () => {
    chrome.tabs.query.mockResolvedValue([]);
    chrome.tabs.create.mockRejectedValue(new Error('no tabs for you'));
    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: true }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'no tabs for you' });
  });
});

describe('runs over the organize page\'s port', () => {
  test('a run starts straight from the page\'s message: no parked state to lose', async () => {
    const port = makePort();
    start(port, { instructions: 'by site' });
    await settled(port);
    expect(port.types()[0]).toBe('started');
    expect(port.types()).toEqual(expect.arrayContaining(['ai-status', 'ai-debug', 'ai-proposal']));
    expect(port.types().indexOf('ai-proposal')).toBeGreaterThan(port.types().indexOf('ai-debug'));
    const proposal = port.last('ai-proposal');
    expect(proposal.groups).toEqual([{ name: 'G', color: 'blue', tabIds: [20, 21] }]);
    expect(proposal).toMatchObject({ windowId: 1, model: HAIKU, modelName: 'Claude Haiku 4.5' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('by site');
    expect(body.max_tokens).toBe(maxTokensForTabs(2));
    expect(global.fetch.mock.calls[0][1].headers['X-Title']).toBe('Huddle');
  });

  test('a page from another build is told to reload Huddle, and nothing runs', () => {
    const port = makePort();
    start(port, { protocol: AI_PROTOCOL - 1 });
    expect(port.last('ai-error')).toMatchObject({ kind: 'stale' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the page\'s model is for this run; no model means the saved default', async () => {
    const a = makePort();
    start(a, { model: 'openai/gpt-6-luna' });
    await settled(a);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('openai/gpt-6-luna');

    const b = makePort({ id: 11, windowId: 1 });
    start(b);
    await settled(b);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).model).toBe(HAIKU);
  });

  test('Huddle\'s own pages are never sent to the model', async () => {
    chrome.tabs.query.mockResolvedValue([
      ...TABS,
      { id: 30, url: 'chrome-extension://test-id/ai-proposal.html?respectGroups=true', title: 'Organize with AI', pinned: false, groupId: -1 },
      { id: 31, url: 'chrome-extension://test-id/options.html', title: 'Settings', pinned: false, groupId: -1 },
    ]);
    const port = makePort();
    start(port);
    await settled(port);
    const prompt = port.last('ai-debug').messages[1].content;
    expect(prompt).not.toContain('[id:30]');
    expect(prompt).not.toContain('[id:31]');
  });

  test('no key asks the page for one, with no network call', async () => {
    mockConfig(null);
    const port = makePort();
    start(port);
    await settled(port);
    expect(port.last('ai-error')).toMatchObject({ kind: 'key', needsKey: 'missing' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('Groups mode with every tab grouped offers Flat', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 20, url: 'https://x.com', pinned: false, groupId: 7 }]);
    const port = makePort();
    start(port);
    await settled(port);
    expect(port.last('ai-error')).toMatchObject({ kind: 'no-tabs' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a batch model is refused before any request', async () => {
    const port = makePort();
    start(port, { model: 'openai/gpt-6-luna-batch' });
    await settled(port);
    expect(port.last('ai-error').error).toMatch(/batch models can't organize tabs/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('closing the port (Stop, reload, tab closed) aborts the request', async () => {
    let signal;
    global.fetch = vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const port = makePort();
    start(port);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    port.close();
    expect(signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    // Nobody is told: the page is gone or stopped it itself.
    expect(port.types()).not.toContain('ai-error');
  });

  test('a new run in the same tab aborts the one before, and only the new one reports', async () => {
    const signals = [];
    global.fetch = vi.fn((_url, init) => {
      signals.push(init.signal);
      if (signals.length === 1) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return Promise.resolve(jsonAnswer(groupsFor([20])));
    });
    const first = makePort();
    start(first);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const second = makePort();
    start(second);
    await settled(second);
    expect(signals[0].aborted).toBe(true);
    expect(first.types()).not.toContain('ai-proposal');
    expect(first.types()).not.toContain('ai-error');
  });

  test('closing the tab aborts its run', async () => {
    let signal;
    global.fetch = vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    });
    const port = makePort({ id: 77, windowId: 1 });
    start(port);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    chrome.tabs.onRemoved.callListeners(77);
    expect(signal.aborted).toBe(true);
  });

  test('a provider 401 is about the model, not the key', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorAnswer(401, 'User not found.', 'DeepInfra'));
    const port = makePort();
    start(port, { model: 'deepseek/deepseek-v4-flash' });
    await settled(port);
    const err = port.last('ai-error');
    expect(err.kind).toBe('model');
    // The same model gets the same refusal: Change model leads, not Retry.
    expect(err.retryable).toBe(false);
    expect(err.error).toMatch(/^DeepInfra, the provider serving deepseek\/deepseek-v4-flash, refused the request \(401: User not found\)\. Your key works/);
  });

  test('a bare 401 checks the key: rejected means the key form', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(errorAnswer(401, 'User not found.'))
      .mockResolvedValueOnce({ ok: false, status: 401 });
    const port = makePort();
    start(port);
    await settled(port);
    expect(global.fetch.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/key');
    expect(port.last('ai-error')).toMatchObject({ kind: 'key', needsKey: 'rejected' });
    expect(port.last('ai-error').error).toMatch(/rejected your saved key/);
  });

  test('a bare 401 with a key OpenRouter accepts is about the model', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(errorAnswer(401, ''))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const port = makePort();
    start(port);
    await settled(port);
    expect(port.last('ai-error')).toMatchObject({ kind: 'model', retryable: false });
    expect(port.last('ai-error').error).toMatch(/Your key works; pick another model/);
  });

  test('a network failure says OpenRouter could not be reached', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const port = makePort();
    start(port);
    await settled(port);
    expect(port.last('ai-error')).toMatchObject({
      kind: 'network',
      error: 'Couldn\'t reach OpenRouter. Check your connection, then Retry.',
    });
  });

  test('an empty answer and a plan with no groups are errors, not proposals', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    });
    const a = makePort();
    start(a);
    await settled(a);
    expect(a.last('ai-error').error).toBe('Claude Haiku 4.5 returned an empty answer (stopped: length). Try again or pick another model.');

    global.fetch = vi.fn().mockResolvedValue(jsonAnswer(JSON.stringify({ groups: [{ name: 'G', color: 'blue', tabIds: [999] }] })));
    const b = makePort({ id: 11, windowId: 1 });
    start(b);
    await settled(b);
    expect(b.last('ai-error').error).toMatch(/didn't put any of your tabs in a group/);
  });
});

describe('messages every action answers', () => {
  test('an unknown action gets a reply instead of a closed port', () => {
    const reply = vi.fn();
    chrome.runtime.onMessage.callListeners({ action: 'aiRestartRun' }, {}, reply);
    expect(reply).toHaveBeenCalledWith({ success: false, error: 'unknown-action', protocol: AI_PROTOCOL });
  });

  test('loadAiConfig answers with the config at once, without the catalog', async () => {
    const reply = vi.fn();
    chrome.runtime.onMessage.callListeners({ action: 'loadAiConfig' }, {}, reply);
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(reply.mock.calls[0][0]).toMatchObject({ protocol: AI_PROTOCOL, config: expect.objectContaining({ model: HAIKU }) });
    expect(reply.mock.calls[0][0].models).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('handleApplyAiProposal', () => {
  // The window's tabs as tabs.query reports them; tab 3 is in an old group.
  const windowTabs = [
    { id: 1, url: 'https://a.com', pinned: false, groupId: -1 },
    { id: 2, url: 'https://b.com', pinned: false, groupId: -1 },
    { id: 3, url: 'https://c.com', pinned: false, groupId: 700 },
  ];

  beforeEach(() => {
    chrome.tabs.remove.mockResolvedValue();
    chrome.tabs.group.mockResolvedValue(123);
    chrome.tabs.ungroup.mockResolvedValue();
    chrome.tabGroups.update.mockResolvedValue();
    chrome.tabs.query.mockResolvedValue(windowTabs);
    chrome.tabGroups.query.mockResolvedValue([]);
    chrome.tabs.move.mockResolvedValue();
  });

  test('closes the sender proposal tab only after the groups are in place', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [1] }], windowId: 5 },
      { tab: { id: 55 } },
      sendResponse
    );
    expect(chrome.tabs.remove).toHaveBeenCalledWith(55);
    expect(chrome.tabs.group.mock.invocationCallOrder[0])
      .toBeLessThan(chrome.tabs.remove.mock.invocationCallOrder[0]);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, grouped: 1, groups: 1, skipped: 0, closing: true });
  });

  test('keeps the proposal tab open when applying fails', async () => {
    chrome.tabs.group.mockRejectedValue(new Error('group failed'));
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [1] }], windowId: 5 },
      { tab: { id: 55 } },
      sendResponse
    );
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'group failed' });
  });

  test('leaves out tabs closed since the proposal was made, says so and keeps the page', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [1, 99] }], windowId: 5 },
      { tab: { id: 55 } },
      sendResponse
    );
    expect(chrome.tabs.group).toHaveBeenCalledWith({
      tabIds: [1],
      createProperties: { windowId: 5 },
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, grouped: 1, groups: 1, skipped: 1, closing: false });
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('with every proposed tab gone it groups nothing, says so and closes nothing', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [98, 99] }], windowId: 5 },
      { tab: { id: 55 } },
      sendResponse
    );
    expect(chrome.tabs.group).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'None of the proposed tabs are still in this window.' });
  });

  test('Flat mode ungroups the tabs left in Ungrouped', async () => {
    await handleApplyAiProposal(
      {
        groups: [{ name: 'G', color: 'blue', tabIds: [1] }],
        ungroupedTabIds: [2, 3],
        respectGroups: false,
        windowId: 5,
      },
      {},
      vi.fn()
    );
    // Only tab 3 is in a group; tab 2 is already ungrouped.
    expect(chrome.tabs.ungroup).toHaveBeenCalledWith([3]);
  });

  test('Groups mode leaves existing groups alone', async () => {
    await handleApplyAiProposal(
      {
        groups: [{ name: 'G', color: 'blue', tabIds: [1] }],
        ungroupedTabIds: [3],
        respectGroups: true,
        windowId: 5,
      },
      {},
      vi.fn()
    );
    expect(chrome.tabs.ungroup).not.toHaveBeenCalled();
  });

  test('skips groups with empty tabIds', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      {
        groups: [
          { name: 'Keep', color: 'blue', tabIds: [1, 2] },
          { name: 'Empty', color: 'red', tabIds: [] },
        ],
        windowId: 5,
      },
      {},
      sendResponse
    );

    expect(chrome.tabs.group).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.group).toHaveBeenCalledWith({
      tabIds: [1, 2],
      createProperties: { windowId: 5 },
    });
  });

  test('normalizes an invalid tab-group color to grey', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'Weird', color: 'neon_pink', tabIds: [1] }], windowId: 5 },
      {},
      sendResponse
    );

    expect(chrome.tabGroups.update).toHaveBeenCalledWith(123, {
      title: 'Weird',
      color: 'grey',
    });
  });

  test('calls sortWindowTabs after grouping', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [1] }], windowId: 9 },
      {},
      sendResponse
    );

    // sortWindowTabs(windowId, true) internally calls getTabsWithGroupInfo(windowId),
    // which queries tabs and tab groups for that window — proof it ran after grouping.
    expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 9 });
    expect(chrome.tabGroups.query).toHaveBeenCalledWith({ windowId: 9 });

    // The first tabs.query drops stale tab ids; the last one is the sort's.
    const groupOrder = chrome.tabs.group.mock.invocationCallOrder[0];
    const sortQueryOrder = chrome.tabs.query.mock.invocationCallOrder.at(-1);
    expect(groupOrder).toBeLessThan(sortQueryOrder);
  });

  test('a rejecting chrome.tabs.group returns {success: false}', async () => {
    chrome.tabs.group.mockRejectedValue(new Error('group failed'));
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [1] }], windowId: 9 },
      {},
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'group failed' });
  });
});

describe('default model and key storage', () => {
  let stored;
  beforeEach(() => {
    stored = null;
    chrome.storage.local.get.mockImplementation(async () => (stored ? { aiConfig: stored } : {}));
    chrome.storage.local.set.mockImplementation(async (items) => { stored = items.aiConfig; });
  });

  test('saveAiDefaultModel changes only the model, keeping the key and its deadline', async () => {
    const deadline = Date.now() + 3600000;
    stored = { key: btoa('sk-or-k'), model: 'a/one', expiresAt: deadline, expiryDuration: 3600000, setupComplete: true };
    const saved = await saveAiDefaultModel('b/two');
    expect(saved).toMatchObject({ key: btoa('sk-or-k'), model: 'b/two', expiresAt: deadline, expiryDuration: 3600000 });
  });

  test('saveAiDefaultModel works before any key is on file', async () => {
    const saved = await saveAiDefaultModel('b/two');
    expect(saved.model).toBe('b/two');
    expect(saved.key).toBeNull();
    expect(isKeyExpired(saved)).toBe(true);
  });

  test('saveAiDefaultModel refuses an id the catalog does not list, unless confirmed', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      if (list.includes('aiConfig') && stored) out.aiConfig = stored;
      if (list.includes(MODELS_CACHE_KEY)) {
        out[MODELS_CACHE_KEY] = { v: MODELS_CACHE_VERSION, models: [{ id: 'b/two', name: 'Two' }], fetchedAt: Date.now() };
      }
      return out;
    });
    await expect(saveAiDefaultModel('acme/typo-model')).rejects.toMatchObject({ unlisted: true });
    expect(stored).toBeNull();
    expect((await saveAiDefaultModel('acme/typo-model', { allowUnlisted: true })).model).toBe('acme/typo-model');
    await expect(saveAiDefaultModel('openai/gpt-6-luna:batch', { allowUnlisted: true })).rejects.toThrow(/Batch models/);
  });

  test('saveAiDefaultModel refuses an empty model', async () => {
    await expect(saveAiDefaultModel('  ')).rejects.toThrow(/model/i);
  });

  test('deleteAiKey drops the key but keeps the default model', async () => {
    stored = { key: btoa('sk-or-k'), model: 'b/two', expiresAt: null, expiryDuration: null, setupComplete: true };
    const saved = await deleteAiKey();
    expect(saved.key).toBeNull();
    expect(saved.model).toBe('b/two');
  });

  test('saving a key without a model keeps the saved default model', async () => {
    stored = { key: null, model: 'b/two', expiresAt: null, expiryDuration: 86400000, setupComplete: false };
    const saved = await saveAiConfig({ key: 'sk-or-new', expiryDuration: 86400000 });
    expect(saved.model).toBe('b/two');
    expect(saved.key).toBe(btoa('sk-or-new'));
  });

  test('a newly typed key restarts its countdown even when it is the same key', async () => {
    stored = { key: btoa('sk-or-k'), model: 'a/one', expiresAt: Date.now() + 5 * 60000, expiryDuration: 86400000, setupComplete: true };
    const kept = await saveAiConfig({ key: 'sk-or-k', expiryDuration: 86400000 });
    expect(kept.expiresAt - Date.now()).toBeLessThan(6 * 60000);
    const renewed = await saveAiConfig({ key: 'sk-or-k', expiryDuration: 86400000, renew: true });
    expect(renewed.expiresAt - Date.now()).toBeGreaterThan(23 * 3600000);
    expect(chrome.alarms.create).toHaveBeenCalledWith(AI_KEY_ALARM, { when: renewed.expiresAt });
  });

  test('an expired key is removed from storage when read, keeping the model and a marker', async () => {
    const at = Date.now() - 60000;
    stored = { key: btoa('sk-or-k'), model: 'a/one', expiresAt: at, expiryDuration: 3600000, setupComplete: true };
    const config = await loadAiConfig();
    expect(config).toMatchObject({ key: null, model: 'a/one', keyExpiredAt: at, expiryDuration: 3600000 });
    expect(stored.key).toBeNull();
    expect(aiKeyState(config)).toBe('expired');
  });

  test('the saveAiDefaultModel and deleteAiKey messages answer with the new config', async () => {
    stored = { key: btoa('sk-or-k'), model: 'a/one', expiresAt: null, expiryDuration: null, setupComplete: true };
    const saveReply = vi.fn();
    chrome.runtime.onMessage.callListeners({ action: 'saveAiDefaultModel', model: 'c/three' }, {}, saveReply);
    await vi.waitFor(() => expect(saveReply).toHaveBeenCalled());
    expect(saveReply).toHaveBeenCalledWith({ success: true, config: expect.objectContaining({ model: 'c/three' }) });

    const deleteReply = vi.fn();
    chrome.runtime.onMessage.callListeners({ action: 'deleteAiKey' }, {}, deleteReply);
    await vi.waitFor(() => expect(deleteReply).toHaveBeenCalled());
    expect(deleteReply).toHaveBeenCalledWith({ success: true, config: expect.objectContaining({ key: null, model: 'c/three' }) });
  });
});
