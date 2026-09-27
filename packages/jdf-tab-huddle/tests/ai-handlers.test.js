// Tests for handleAiGroupTabs / handleApplyAiProposal (src/background.js).
// These orchestrate the AI grouping flow against chrome.* APIs.
// Exposed globally by tests/setup.js.

// handleAiGroupTabs parks each run until its own proposal tab posts an
// 'aiProposalReady' message (the runs are keyed by that tab's id). That message
// is normally sent by ai-proposal.js; here we simulate it by driving the same
// chrome.runtime.onMessage listener background.js itself registered, from the
// tab id the tabs.create mock handed out. Returns the reply callback.
function triggerAiProposalReady(instructions = '', tabId = 10, model = undefined) {
  const reply = vi.fn();
  chrome.runtime.onMessage.callListeners(
    { action: 'aiProposalReady', instructions, model },
    { tab: { id: tabId } },
    reply
  );
  return reply;
}

// Flushes pending microtasks (storage.get / tabs.create awaits) so execution
// parks at the pending-run promise before we resolve it.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('handleAiGroupTabs - opening the organize page', () => {
  test('missing key opens the organize page asking for a key, with no network call', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    chrome.tabs.create.mockResolvedValue({ id: 100 });
    global.fetch = vi.fn();

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: true }, sendResponse);
    await flushMicrotasks();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-proposal.html?respectGroups=true&key=missing',
      active: true,
    });
    expect(chrome.tabs.create.mock.calls[0][0].url).not.toContain('ai-setup');
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'setup' });
    expect(chrome.windows.getCurrent).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    // The run waits for the page; closing it ends the run.
    chrome.tabs.onRemoved.callListeners(100, {});
    await promise;
  });

  test('expired key opens the organize page in its expired state', async () => {
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: 'abc', expiresAt: Date.now() - 1000, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.tabs.create.mockResolvedValue({ id: 101 });
    global.fetch = vi.fn();

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: true }, sendResponse);
    await flushMicrotasks();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-proposal.html?respectGroups=true&key=expired',
      active: true,
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'setup' });
    expect(global.fetch).not.toHaveBeenCalled();

    chrome.tabs.onRemoved.callListeners(101, {});
    await promise;
  });

  test('the Flat choice is carried into the organize page URL', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    chrome.tabs.create.mockResolvedValue({ id: 100 });

    const promise = handleAiGroupTabs({ respectGroups: false }, vi.fn());
    await flushMicrotasks();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-proposal.html?respectGroups=false&key=missing',
      active: true,
    });
    chrome.tabs.onRemoved.callListeners(100, {});
    await promise;
  });

  test('a key saved on the page before it starts the run is used for that run', async () => {
    // No key when the popup asked; the page's inline form saves one.
    chrome.storage.local.get.mockResolvedValueOnce({});
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: btoa('sk-or-new'), expiresAt: null, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    chrome.tabs.sendMessage.mockResolvedValue({});
    chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
    chrome.tabGroups.query.mockResolvedValue([]);
    chrome.tabs.query.mockResolvedValue([{ id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 }]);
    const content = JSON.stringify({ groups: [{ name: 'G', color: 'blue', tabIds: [20] }] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content } }] }),
    });

    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-or-new');
    const types = chrome.tabs.sendMessage.mock.calls.map((call) => call[1].type);
    expect(types).toContain('ai-proposal');
  });

  test('a run started while the key is still missing tells the page it needs one', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    chrome.tabs.sendMessage.mockResolvedValue({});
    global.fetch = vi.fn();

    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    expect(global.fetch).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, expect.objectContaining({
      type: 'ai-error',
      needsKey: 'missing',
    }));
  });

  test('a failure before any tab opens still answers the popup with the reason', async () => {
    chrome.storage.local.get.mockRejectedValue(new Error('storage is unavailable'));

    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: true }, sendResponse);

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'storage is unavailable' });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('a failing tabs.create answers the popup with the reason', async () => {
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: 'abc', expiresAt: null, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.tabs.create.mockRejectedValue(new Error('window is closing'));

    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: true }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'window is closing' });
  });
});

describe('handleAiGroupTabs - gathering tabs', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: 'abc', expiresAt: null, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    chrome.tabs.sendMessage.mockResolvedValue({});
    chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
    chrome.tabGroups.query.mockResolvedValue([]);
  });

  test('all-pinned-tabs sends the respectGroups-specific error and skips callOpenRouter', async () => {
    chrome.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://a.com', pinned: true, groupId: -1 },
      { id: 2, url: 'https://b.com', pinned: true, groupId: -1 },
    ]);
    global.fetch = vi.fn();

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: true }, sendResponse);
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    expect(global.fetch).not.toHaveBeenCalled();
    const errorCall = chrome.tabs.sendMessage.mock.calls.find(
      (call) => call[1] && call[1].type === 'ai-error'
    );
    expect(errorCall[1]).toEqual({
      type: 'ai-error',
      error: 'No ungrouped tabs to organize. Switch to Flat to reorganize all tabs.',
    });
  });

  test('individual mode all-pinned-tabs error differs from tab-groups mode', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', pinned: true, groupId: -1 }]);
    global.fetch = vi.fn();

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: false }, sendResponse);
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    const errorCall = chrome.tabs.sendMessage.mock.calls.find(
      (call) => call[1] && call[1].type === 'ai-error'
    );
    expect(errorCall[1]).toEqual({
      type: 'ai-error',
      error: 'No unpinned tabs to organize.',
    });
  });

  test('happy path sends ai-status, ai-debug, then ai-proposal in order', async () => {
    chrome.tabs.query.mockResolvedValue([
      { id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 },
      { id: 21, url: 'https://y.com', title: 'Y', pinned: false, groupId: -1 },
    ]);
    const content = JSON.stringify({
      groups: [{ name: 'Group', color: 'blue', tabIds: [20, 21] }],
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content } }] }),
    });

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: true }, sendResponse);
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    const types = chrome.tabs.sendMessage.mock.calls.map((call) => call[1].type);
    expect(types).not.toContain('ai-error');
    expect(types.indexOf('ai-debug')).toBeGreaterThan(-1);
    expect(types.indexOf('ai-proposal')).toBeGreaterThan(types.indexOf('ai-debug'));
    expect(types[0]).toBe('ai-status');

    const proposalCall = chrome.tabs.sendMessage.mock.calls.find(
      (call) => call[1].type === 'ai-proposal'
    );
    expect(proposalCall[1].groups).toEqual([{ name: 'Group', color: 'blue', tabIds: [20, 21] }]);
    expect(proposalCall[1].windowId).toBe(1);
  });

  // The proposal tab lives at ai-proposal.html?respectGroups=..., so the error
  // must go to the id tabs.create returned. This tabs.query mock behaves like
  // Chrome's exact-URL match (no query string means no match), so a lookup by
  // the bare page URL cannot pass here again.
  function mockProposalTabInQuery() {
    const proposalUrl = 'chrome-extension://test-id/ai-proposal.html?respectGroups=true';
    chrome.tabs.query.mockImplementation(async (query) => {
      if (query && query.url) return query.url === proposalUrl ? [{ id: 10 }] : [];
      return [{ id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 }];
    });
  }

  test('catch path posts ai-error to the proposal tab it opened', async () => {
    chrome.windows.getCurrent.mockRejectedValue(new Error('window fetch failed'));
    mockProposalTabInQuery();

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: true }, sendResponse);
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, {
      type: 'ai-error',
      error: 'window fetch failed',
    });
    // The popup was already answered when the tab opened, and only once.
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'proposal' });
  });

  test('an OpenRouter rejection (invalid key) reaches the proposal tab', async () => {
    mockProposalTabInQuery();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: { message: 'No auth credentials found' } }),
      text: async () => '{"error":{"message":"No auth credentials found"}}',
    });

    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    const errorCall = chrome.tabs.sendMessage.mock.calls.find(
      (call) => call[1] && call[1].type === 'ai-error'
    );
    expect(errorCall).toBeDefined();
    expect(errorCall[0]).toBe(10);
    expect(errorCall[1].error).toMatch(/No auth credentials found/);
  });

  test('a proposal tab closed mid-run does not raise an unhandled rejection', async () => {
    chrome.windows.getCurrent.mockRejectedValue(new Error('window fetch failed'));
    chrome.tabs.sendMessage.mockRejectedValue(new Error('No tab with id: 10'));

    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('');
    await expect(promise).resolves.toBeUndefined();
    await flushMicrotasks();
  });
});

describe('aiProposalReady - runs keyed by proposal tab', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: 'abc', expiresAt: null, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.tabs.sendMessage.mockResolvedValue({});
    chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
    chrome.tabGroups.query.mockResolvedValue([]);
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com', pinned: true, groupId: -1 }]);
  });

  test('replies pending:true to the tab a run is waiting for', async () => {
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();

    const reply = triggerAiProposalReady('', 10);
    await promise;

    expect(reply).toHaveBeenCalledWith({ success: true, pending: true });
  });

  test('replies pending:false when no run is waiting (refresh, restarted worker)', () => {
    const reply = triggerAiProposalReady('', 999);
    expect(reply).toHaveBeenCalledWith({ success: true, pending: false });
  });

  test('a second ready from the same tab gets pending:false', async () => {
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('', 10);
    await promise;

    const again = triggerAiProposalReady('', 10);
    expect(again).toHaveBeenCalledWith({ success: true, pending: false });
  });

  test('two proposal tabs each start only their own run', async () => {
    chrome.tabs.create.mockResolvedValueOnce({ id: 31 }).mockResolvedValueOnce({ id: 32 });
    const runA = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    const runB = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();

    triggerAiProposalReady('', 31);
    await runA;

    const targets = chrome.tabs.sendMessage.mock.calls.map((call) => call[0]);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((id) => id === 31)).toBe(true);

    // Run B is still waiting for tab 32.
    const replyB = triggerAiProposalReady('', 32);
    await runB;
    expect(replyB).toHaveBeenCalledWith({ success: true, pending: true });
    expect(chrome.tabs.sendMessage.mock.calls.some((call) => call[0] === 32)).toBe(true);
  });

  test('closing the proposal tab before it is ready ends its run', async () => {
    chrome.tabs.create.mockResolvedValue({ id: 41 });
    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();

    chrome.tabs.onRemoved.callListeners(41, { windowId: 1, isWindowClosing: false });
    await promise;

    expect(chrome.windows.getCurrent).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    const reply = triggerAiProposalReady('', 41);
    expect(reply).toHaveBeenCalledWith({ success: true, pending: false });
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
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
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

  test('leaves out tabs closed since the proposal was made', async () => {
    await handleApplyAiProposal(
      { groups: [{ name: 'G', color: 'blue', tabIds: [1, 99] }], windowId: 5 },
      {},
      vi.fn()
    );
    expect(chrome.tabs.group).toHaveBeenCalledWith({
      tabIds: [1],
      createProperties: { windowId: 5 },
    });
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

describe('the model for one run, and Run again in the same tab', () => {
  const okResponse = (tabIds) => {
    const content = JSON.stringify({ groups: [{ name: 'G', color: 'blue', tabIds }] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  };

  beforeEach(() => {
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: btoa('sk-or-k'), expiresAt: null, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.storage.local.set.mockResolvedValue();
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    chrome.tabs.sendMessage.mockResolvedValue({});
    chrome.windows.getCurrent.mockResolvedValue({ id: 1 });
    chrome.tabGroups.query.mockResolvedValue([]);
    chrome.tabs.query.mockResolvedValue([{ id: 20, url: 'https://x.com', title: 'X', pinned: false, groupId: -1 }]);
    global.fetch = vi.fn().mockResolvedValue(okResponse([20]));
  });

  const requestedModel = () => JSON.parse(global.fetch.mock.calls[0][1].body).model;

  test('the page\'s model applies to the run without changing the saved default', async () => {
    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('', 10, 'qwen/qwen3.5-flash-20260224');
    await promise;

    expect(requestedModel()).toBe('qwen/qwen3.5-flash-20260224');
    const debug = chrome.tabs.sendMessage.mock.calls.find((call) => call[1].type === 'ai-debug');
    expect(debug[1].model).toBe('qwen/qwen3.5-flash-20260224');
    // Nothing was written: the default stays what it was.
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ aiConfig: expect.anything() })
    );
  });

  test('no model from the page means the saved default', async () => {
    const promise = handleAiGroupTabs({ respectGroups: true }, vi.fn());
    await flushMicrotasks();
    triggerAiProposalReady('', 10, null);
    await promise;

    expect(requestedModel()).toBe('anthropic/claude-haiku-4.5');
  });

  test('aiRestartRun parks a new run for the sender tab, in that tab\'s window', async () => {
    const reply = vi.fn();
    chrome.runtime.onMessage.callListeners(
      { action: 'aiRestartRun', respectGroups: false },
      { tab: { id: 77, windowId: 3 } },
      reply
    );
    expect(reply).toHaveBeenCalledWith({ success: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    const ready = triggerAiProposalReady('by topic', 77, 'google/gemini-3.1-flash-lite-preview-20260303');
    expect(ready).toHaveBeenCalledWith({ success: true, pending: true });
    await vi.waitFor(() => {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(77, expect.objectContaining({ type: 'ai-proposal', windowId: 3 }));
    });
    expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 3 });
    expect(chrome.windows.getCurrent).not.toHaveBeenCalled();
    expect(requestedModel()).toBe('google/gemini-3.1-flash-lite-preview-20260303');
  });

  test('aiRestartRun from outside a tab is refused', () => {
    const reply = vi.fn();
    chrome.runtime.onMessage.callListeners({ action: 'aiRestartRun' }, {}, reply);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('a second restart drops the run the tab was still waiting on', async () => {
    const first = runAiOrganizeInTab(88, true, 1);
    runAiOrganizeInTab(88, true, 1);
    await expect(first).resolves.toBeUndefined();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    // Only one run is left to start.
    expect(triggerAiProposalReady('', 88)).toHaveBeenCalledWith({ success: true, pending: true });
    expect(triggerAiProposalReady('', 88)).toHaveBeenCalledWith({ success: true, pending: false });
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
    stored = { key: btoa('sk-or-k'), model: 'a/one', expiresAt: 12345, expiryDuration: 3600000, setupComplete: true };
    const saved = await saveAiDefaultModel('b/two');
    expect(saved).toMatchObject({ key: btoa('sk-or-k'), model: 'b/two', expiresAt: 12345, expiryDuration: 3600000 });
  });

  test('saveAiDefaultModel works before any key is on file', async () => {
    const saved = await saveAiDefaultModel('b/two');
    expect(saved.model).toBe('b/two');
    expect(saved.key).toBeNull();
    expect(isKeyExpired(saved)).toBe(true);
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
