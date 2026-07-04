// Tests for handleAiGroupTabs / handleApplyAiProposal (src/background.js).
// These orchestrate the AI grouping flow against chrome.* APIs.
// Exposed globally by tests/setup.js.

// handleAiGroupTabs awaits `new Promise(resolve => { aiProposalReadyResolve = resolve; })`
// which is only resolved once the proposal tab posts an 'aiProposalReady' message.
// That message is normally sent by ai-proposal.js; here we simulate it by driving
// the same chrome.runtime.onMessage listener background.js itself registered.
function triggerAiProposalReady(instructions = '') {
  chrome.runtime.onMessage.callListeners(
    { action: 'aiProposalReady', instructions },
    {},
    vi.fn()
  );
}

// Flushes pending microtasks (storage.get / tabs.create awaits) so execution
// parks at the `aiProposalReadyResolve` promise before we resolve it.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('handleAiGroupTabs - setup / expiry routing', () => {
  test('missing key routes to ai-setup.html?mode=setup and makes no network call', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    chrome.tabs.create.mockResolvedValue({ id: 100 });
    global.fetch = vi.fn();

    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: true }, sendResponse);

    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-setup.html?mode=setup',
      active: true,
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'setup' });
    expect(chrome.windows.getCurrent).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('expired key routes to ai-setup.html?mode=expired and makes no network call', async () => {
    chrome.storage.local.get.mockResolvedValue({
      aiConfig: { key: 'abc', expiresAt: Date.now() - 1000, model: 'anthropic/claude-haiku-4.5' },
    });
    chrome.tabs.create.mockResolvedValue({ id: 101 });
    global.fetch = vi.fn();

    const sendResponse = vi.fn();
    await handleAiGroupTabs({ respectGroups: true }, sendResponse);

    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-setup.html?mode=expired',
      active: true,
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, action: 'setup' });
    expect(chrome.windows.getCurrent).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
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
      error: 'No ungrouped tabs to organize. Switch to Individual Mode to reorganize all tabs.',
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

  test('catch path posts ai-error to the proposal tab', async () => {
    chrome.windows.getCurrent.mockRejectedValue(new Error('window fetch failed'));
    chrome.tabs.query.mockImplementation(async (query) => {
      if (query && query.url) {
        return [{ id: 77 }];
      }
      return [];
    });

    const sendResponse = vi.fn();
    const promise = handleAiGroupTabs({ respectGroups: true }, sendResponse);
    await flushMicrotasks();
    triggerAiProposalReady('');
    await promise;

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(77, {
      type: 'ai-error',
      error: 'window fetch failed',
    });
  });
});

describe('handleApplyAiProposal', () => {
  beforeEach(() => {
    chrome.tabs.remove.mockResolvedValue();
    chrome.tabs.group.mockResolvedValue(123);
    chrome.tabGroups.update.mockResolvedValue();
    chrome.tabs.query.mockResolvedValue([]);
    chrome.tabGroups.query.mockResolvedValue([]);
    chrome.tabs.move.mockResolvedValue();
  });

  test('closes the sender proposal tab first', async () => {
    const sendResponse = vi.fn();
    await handleApplyAiProposal(
      { groups: [], windowId: 5 },
      { tab: { id: 55 } },
      sendResponse
    );
    expect(chrome.tabs.remove).toHaveBeenCalledWith(55);
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

    const groupOrder = chrome.tabs.group.mock.invocationCallOrder[0];
    const sortQueryOrder = chrome.tabs.query.mock.invocationCallOrder[0];
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
