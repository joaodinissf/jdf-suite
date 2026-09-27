describe('Background Script', () => {

  describe('lexHost function', () => {
    test('should extract hostname from regular URL', () => {
      expect(lexHost('https://example.com/path')).toBe('example.com');
    });

    test('should handle chrome-extension URLs', () => {
      expect(lexHost('chrome-extension://abc123/popup.html')).toBe('abc123');
    });

    test('should handle file URLs', () => {
      expect(lexHost('file:///path/to/file.html')).toBe('file');
    });

    test('should handle data URLs', () => {
      expect(lexHost('data:text/html,<h1>Test</h1>')).toBe('data');
    });

    test('should handle chrome URLs', () => {
      expect(lexHost('chrome://settings/')).toBe('settings');
    });

    test('should handle invalid URLs gracefully', () => {
      expect(lexHost('invalid-url')).toBe('invalid-url');
      expect(lexHost('')).toBe('');
      expect(lexHost(null)).toBe('');
      expect(lexHost(undefined)).toBe('');
    });
  });

  describe('getTabGroupsInfo', () => {
    test('should return empty map when no groups exist', async () => {
      chrome.tabGroups.query.mockResolvedValue([]);
      
      const result = await getTabGroupsInfo();
      
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test('should return map with groups', async () => {
      const mockGroups = [
        { id: 1, title: 'Group 1', color: 'blue' },
        { id: 2, title: 'Group 2', color: 'red' }
      ];
      chrome.tabGroups.query.mockResolvedValue(mockGroups);
      
      const result = await getTabGroupsInfo();
      
      expect(result.size).toBe(2);
      expect(result.get(1)).toEqual(mockGroups[0]);
      expect(result.get(2)).toEqual(mockGroups[1]);
    });

    test('should handle errors gracefully', async () => {
      chrome.tabGroups.query.mockRejectedValue(new Error('API Error'));
      
      const result = await getTabGroupsInfo();
      
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('getTabsWithGroupInfo', () => {
    test('should return tabs with group info', async () => {
      const mockTabs = [
        { id: 1, url: 'https://example.com', groupId: 1 },
        { id: 2, url: 'https://test.com', groupId: -1 }
      ];
      const mockGroups = [{ id: 1, title: 'Group 1' }];
      
      chrome.tabs.query.mockResolvedValue(mockTabs);
      chrome.tabGroups.query.mockResolvedValue(mockGroups);
      
      const result = await getTabsWithGroupInfo();
      
      expect(result).toHaveLength(2);
      expect(result[0].groupInfo).toEqual(mockGroups[0]);
      expect(result[1].groupInfo).toBeNull();
    });
  });

  describe('findDuplicateTabs', () => {
    test('should identify duplicate tabs', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: -1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: -1 },
          { id: 3, url: 'https://test.com', pinned: false, groupId: -1 }
        ]
      ];
      
      const result = findDuplicateTabs(tabs, false);
      
      expect(result.tabsToRemove).toEqual([2]);
    });

    test('should not remove pinned tabs', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: true, groupId: -1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: -1 }
        ]
      ];
      
      const result = findDuplicateTabs(tabs, false);
      
      expect(result.tabsToRemove).toEqual([]);
    });

    test('should handle group-aware duplicate detection (same group is a duplicate)', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: 1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: 1 }, // Same group - duplicate
          { id: 3, url: 'https://unique.com', pinned: false, groupId: 2 }
        ]
      ];

      const result = findDuplicateTabs(tabs, true);

      expect(result.tabsToRemove).toContain(2);
      expect(result.tabsToRemove).not.toContain(3);
    });

    test('single window, same URL in two different groups, respectGroups=true -> neither flagged', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: 1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: 2 } // different group - not a duplicate
        ]
      ];

      const result = findDuplicateTabs(tabs, true);

      expect(result.tabsToRemove).toEqual([]);
    });

    test('single window, same URL twice in the SAME group, respectGroups=true -> one flagged', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: 1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: 1 } // same group - duplicate
        ]
      ];

      const result = findDuplicateTabs(tabs, true);

      expect(result.tabsToRemove).toEqual([2]);
    });

    test('single window, same URL in different groups, respectGroups=false -> cross-group duplicate IS flagged', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: 1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: 2 }
        ]
      ];

      const result = findDuplicateTabs(tabs, false);

      expect(result.tabsToRemove).toEqual([2]);
    });

    test('two windows, same URL in different groups across windows, respectGroups=true -> neither flagged (unchanged multi-window behavior)', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: 1 }
        ],
        [
          { id: 2, url: 'https://example.com', pinned: false, groupId: 1 }
        ]
      ];

      const result = findDuplicateTabs(tabs, true);

      expect(result.tabsToRemove).toEqual([]);
    });

    test('two windows, same URL in the same group id repeated within one window, respectGroups=true -> duplicate within that window flagged', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: false, groupId: 1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: 1 }
        ],
        [
          { id: 3, url: 'https://example.com', pinned: false, groupId: 1 }
        ]
      ];

      const result = findDuplicateTabs(tabs, true);

      expect(result.tabsToRemove).toEqual([2]);
    });

    test('pinned tabs are never removed and are not counted as the "seen" occurrence', () => {
      const tabs = [
        [
          { id: 1, url: 'https://example.com', pinned: true, groupId: 1 },
          { id: 2, url: 'https://example.com', pinned: false, groupId: 1 },
          { id: 3, url: 'https://example.com', pinned: false, groupId: 1 }
        ]
      ];

      const result = findDuplicateTabs(tabs, true);

      // Pinned tab (id 1) is skipped entirely and never marked "seen", so
      // the first unpinned tab (id 2) becomes the kept occurrence and only
      // the second unpinned duplicate (id 3) is flagged for removal.
      expect(result.tabsToRemove).toEqual([3]);
    });
  });

  describe('analyzeDomainDistribution', () => {
    test('should return valid structure', async () => {
      chrome.tabs.query.mockResolvedValue([]);
      chrome.tabGroups.query.mockResolvedValue([]);
      const result = await analyzeDomainDistribution();
      
      expect(result).toHaveProperty('extractableDomains');
      expect(result).toHaveProperty('singleTabDomains');
      expect(result).toHaveProperty('domainTabCounts');
      expect(result).toHaveProperty('domainTabs');
      expect(result.domainTabCounts).toBeInstanceOf(Map);
      expect(result.domainTabs).toBeInstanceOf(Map);
      expect(Array.isArray(result.extractableDomains)).toBe(true);
      expect(Array.isArray(result.singleTabDomains)).toBe(true);
    });
  });

  describe('formatTabsAsText', () => {
    test('should return empty string for empty tab list', () => {
      expect(formatTabsAsText([], true)).toBe('');
      expect(formatTabsAsText([], false)).toBe('');
    });

    test('should return flat URL list when respectGroups is false', () => {
      const tabs = [
        { id: 1, url: 'https://example.com/b', groupId: 1, groupInfo: { title: 'Group' } },
        { id: 2, url: 'https://example.com/a', groupId: -1, groupInfo: null },
      ];
      const result = formatTabsAsText(tabs, false);
      expect(result).toBe('https://example.com/b\nhttps://example.com/a');
    });

    test('should return URLs without headers when no groups exist and respectGroups is true', () => {
      const tabs = [
        { id: 1, url: 'https://example.com/a', groupId: -1, groupInfo: null },
        { id: 2, url: 'https://test.com/b', groupId: -1, groupInfo: null },
      ];
      const result = formatTabsAsText(tabs, true);
      expect(result).toBe('https://example.com/a\nhttps://test.com/b');
    });

    test('should paragraph-separate groups without headers when groups exist', () => {
      const tabs = [
        { id: 1, url: 'https://example.com/b', groupId: 1, groupInfo: { title: 'Work' } },
        { id: 2, url: 'https://example.com/a', groupId: 1, groupInfo: { title: 'Work' } },
        { id: 3, url: 'https://other.com/x', groupId: 2, groupInfo: { title: 'Fun' } },
        { id: 4, url: 'https://misc.com/z', groupId: -1, groupInfo: null },
      ];
      const result = formatTabsAsText(tabs, true);
      expect(result).toBe(
        'https://example.com/a\nhttps://example.com/b\n\n' +
        'https://other.com/x\n\n' +
        'https://misc.com/z'
      );
      // Should not contain group names
      expect(result).not.toContain('Work');
      expect(result).not.toContain('Fun');
      expect(result).not.toContain('Ungrouped');
    });

    test('should use pendingUrl when url is not available', () => {
      const tabs = [
        { id: 1, pendingUrl: 'https://pending.com/a', url: undefined, groupId: -1, groupInfo: null },
      ];
      const result = formatTabsAsText(tabs, false);
      expect(result).toBe('https://pending.com/a');
    });
  });

  describe('Message handling', () => {
    test('should handle log message correctly', () => {
      const mockSendResponse = vi.fn();
      const message = { type: 'log', data: { message: 'test', args: [] } };
      
      chrome.runtime.onMessage.callListeners(message, {}, mockSendResponse);
      
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('should have message listeners registered', () => {
      expect(chrome.runtime.onMessage.hasListeners()).toBe(true);
    });
  });
});
describe('sortWindowTabs when a tab closes mid-sort', () => {
  const tab = (id, url) => ({ id, url, pinned: false, groupId: -1, windowId: 101 });

  beforeEach(() => {
    chrome.tabs.query.mockReset();
    chrome.tabs.move.mockReset();
  });

  test('re-queries and retries once, without the closed tab', async () => {
    chrome.tabs.query
      .mockResolvedValueOnce([tab(1, 'https://c.test'), tab(2, 'https://a.test'), tab(3, 'https://b.test')])
      .mockResolvedValueOnce([tab(1, 'https://c.test'), tab(3, 'https://b.test')]);
    chrome.tabs.move
      .mockRejectedValueOnce(new Error('No tab with id: 2.'))
      .mockResolvedValue([]);

    await expect(sortWindowTabs(101, false)).resolves.toBe(true);

    expect(chrome.tabs.query).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.move).toHaveBeenLastCalledWith([3, 1], { index: 0 });
  });

  test('resolves false after a second failure', async () => {
    chrome.tabs.query.mockResolvedValue([tab(1, 'https://c.test'), tab(2, 'https://a.test')]);
    chrome.tabs.move.mockRejectedValue(new Error('Tabs cannot be edited right now.'));

    await expect(sortWindowTabs(101, false)).resolves.toBe(false);
    expect(chrome.tabs.move).toHaveBeenCalledTimes(2);
  });

  test('Sort this window reports the failure instead of success', async () => {
    chrome.tabs.query.mockResolvedValue([tab(1, 'https://c.test'), tab(2, 'https://a.test')]);
    chrome.tabs.move.mockRejectedValue(new Error('Tabs cannot be edited right now.'));
    const sendResponse = vi.fn();

    await handleSortCurrentWindow(false, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "The window couldn't be sorted. Try again.",
    });
  });
});

describe('Results say what actually happened (moves and follow-up sorts)', () => {
  const tab = (id, url, windowId, groupId = -1) => ({ id, url, pinned: false, groupId, windowId, index: id });
  let allTabs;

  beforeEach(() => {
    chrome.tabs.query.mockReset();
    chrome.tabs.move.mockReset();
    chrome.tabs.remove.mockReset().mockResolvedValue(undefined);
    chrome.tabs.update.mockReset().mockResolvedValue({});
    chrome.tabs.group.mockReset().mockResolvedValue(50);
    chrome.tabGroups.query.mockReset().mockResolvedValue([{ id: 9, title: 'G', color: 'blue' }]);
    chrome.tabGroups.update.mockReset().mockResolvedValue({});
    chrome.windows.update.mockReset().mockResolvedValue({});
    // Answer each query with the tabs it actually asks for, not every tab.
    chrome.tabs.query.mockImplementation(async (q) => allTabs.filter((t) =>
      (q.windowId === undefined || t.windowId === q.windowId) &&
      (!q.currentWindow || t.windowId === 1)));
  });

  test('moveTabsWithGroups returns how many tabs moved, skipping a rejected batch', async () => {
    chrome.tabs.move.mockImplementation(async (ids) => {
      if (ids.includes(3)) throw new Error('No tab with id: 3.');
      return [];
    });
    const moved = await moveTabsWithGroups([
      tab(1, 'https://a.test', 2),
      tab(2, 'https://a.test', 2, 9),
      tab(3, 'https://a.test', 2, 8),
    ].map((t) => ({ ...t, groupInfo: t.groupId === -1 ? null : { title: 'G' } })), 1);
    expect(moved).toBe(2);
    // The group after the rejected one still moved.
    expect(chrome.tabs.move).toHaveBeenCalledTimes(3);
  });

  test('Deduplicate does not claim a sort that failed', async () => {
    allTabs = [tab(1, 'https://b.test', 1), tab(2, 'https://a.test', 1), tab(3, 'https://a.test', 1)];
    chrome.tabs.move.mockRejectedValue(new Error('Tabs cannot be edited right now.'));
    const sendResponse = vi.fn();
    await handleRemoveDuplicatesWindow(false, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, removed: 1, sortFailed: true });
  });

  test.each([
    ['handleRemoveDuplicatesAllWindows'],
    ['handleRemoveDuplicatesGlobally'],
  ])('%s reports a window that could not be sorted', async (handler) => {
    allTabs = [tab(1, 'https://b.test', 1), tab(2, 'https://a.test', 1), tab(3, 'https://a.test', 2)];
    chrome.windows.getAll.mockResolvedValue([
      { id: 1, tabs: allTabs.filter((t) => t.windowId === 1) },
      { id: 2, tabs: allTabs.filter((t) => t.windowId === 2) },
    ]);
    chrome.tabs.move.mockImplementation(async (ids) => {
      if (ids.includes(1)) throw new Error('Tabs cannot be edited right now.');
      return [];
    });
    const sendResponse = vi.fn();
    await globalThis[handler](false, sendResponse);
    expect(sendResponse.mock.calls[0][0]).toMatchObject({ success: true, sortFailed: true });
  });

  test('Merge windows reports the tabs that really moved', async () => {
    allTabs = [tab(1, 'https://a.test', 1), tab(2, 'https://b.test', 2, 9), tab(3, 'https://c.test', 2)];
    chrome.windows.getAll.mockResolvedValue([
      { id: 1, focused: true, tabs: [allTabs[0]] },
      { id: 2, tabs: [allTabs[1], allTabs[2]] },
    ]);
    chrome.tabs.move.mockImplementation(async (ids) => {
      if (ids.includes(2)) throw new Error('Tabs cannot be edited right now.');
      return [];
    });
    const sendResponse = vi.fn();
    await handleMoveAllToSingleWindow({ activeTabId: 1, respectGroups: true }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, moved: 1, notMoved: 1, sortFailed: false });
  });

  test('Extract domain counts the tabs that really moved', async () => {
    allTabs = [tab(1, 'https://a.test/1', 1), tab(2, 'https://a.test/2', 1, 9), tab(3, 'https://a.test/3', 1)];
    chrome.windows.create.mockResolvedValue({ id: 200 });
    chrome.tabs.move.mockImplementation(async (ids) => {
      if (ids.includes(2)) throw new Error('No tab with id: 2.');
      return [];
    });
    const sendResponse = vi.fn();
    await handleExtractDomain({ tabId: 1, url: 'https://a.test/1', respectGroups: true }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      success: true, moved: 2, notMoved: 1, domain: 'a.test', sortFailed: false,
    });
  });

  test('Split domains counts the windows it made and the tabs left behind', async () => {
    allTabs = [
      tab(1, 'https://a.test/1', 1), tab(2, 'https://a.test/2', 1), tab(3, 'https://a.test/3', 1, 9),
      tab(4, 'https://b.test', 1), tab(5, 'https://c.test', 1),
    ];
    let nextWindow = 100;
    chrome.windows.create.mockImplementation(async () => ({ id: nextWindow++ }));
    chrome.windows.getAll.mockResolvedValue([]);
    chrome.tabs.move.mockImplementation(async (ids) => {
      if (ids.includes(3)) throw new Error('Tabs cannot be edited right now.');
      return [];
    });
    const sendResponse = vi.fn();
    await handleExtractAllDomains(true, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, windows: 2, notMoved: 1, sortFailed: false });
  });

  test('Split domains reports a failed tab query instead of "Split into 0 windows"', async () => {
    chrome.tabs.query.mockRejectedValue(new Error('Tabs cannot be queried right now.'));
    const sendResponse = vi.fn();
    await handleExtractAllDomains(true, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Tabs cannot be queried right now.' });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });
});

describe('Split domains confirmation survives a worker restart', () => {
  const DIALOG_TAB = 900;
  const KEY = `splitConfirm:${DIALOG_TAB}`;
  const domains = ['a', 'b', 'c', 'd', 'e', 'f'];
  // Six domains with two tabs each: six windows, so the dialog is needed.
  const allTabs = domains.flatMap((d, i) => [1, 2].map((n) => ({
    id: i * 10 + n, url: `https://${d}.test/${n}`, pinned: false, groupId: -1, windowId: 1, index: i * 2 + n,
  })));
  const dialogSender = { tab: { id: DIALOG_TAB } };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Opens the dialog through the real handler; returns the popup's sendResponse.
  async function openDialog(respectGroups) {
    const popupResponse = vi.fn();
    handleExtractAllDomains(respectGroups, popupResponse);
    await vi.waitFor(() => expect(chrome.storage.session.set).toHaveBeenCalled());
    return popupResponse;
  }

  // What a restarted worker has: the listeners, none of the in-memory waiters.
  const restartWorker = () => splitConfirmWaiters.clear();

  beforeEach(() => {
    splitConfirmWaiters.clear();
    chrome.tabs.query.mockReset().mockImplementation(async (q) =>
      allTabs.filter((t) => q.windowId === undefined || t.windowId === q.windowId));
    chrome.tabs.move.mockReset().mockResolvedValue([]);
    chrome.tabs.remove.mockReset().mockResolvedValue(undefined);
    chrome.tabs.create.mockReset().mockResolvedValue({ id: DIALOG_TAB });
    chrome.tabGroups.query.mockReset().mockResolvedValue([]);
    let nextWindow = 100;
    chrome.windows.create.mockReset().mockImplementation(async () => ({ id: nextWindow++ }));
    chrome.windows.getAll.mockReset().mockResolvedValue([]);
  });

  test('the request is saved in storage.session under the dialog tab', async () => {
    await openDialog(false);
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('confirmation-dialog.html'),
    }));
    expect(await chrome.storage.session.get(KEY)).toEqual({ [KEY]: { respectGroups: false } });
  });

  test('Confirm before any restart still splits and answers the popup', async () => {
    const popupResponse = await openDialog(true);
    const dialogResponse = vi.fn();
    chrome.runtime.onMessage.callListeners(
      { action: 'extractAllDomainsConfirmation', confirmed: true }, dialogSender, dialogResponse);

    await vi.waitFor(() => expect(popupResponse).toHaveBeenCalled(), { timeout: 2000 });
    expect(popupResponse).toHaveBeenCalledWith({ success: true, windows: 6, notMoved: 0, sortFailed: false });
    expect(dialogResponse).toHaveBeenCalledWith({ success: true });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(DIALOG_TAB);
    expect(await chrome.storage.session.get(KEY)).toEqual({});
  });

  test('Confirm after a restart splits with the saved setting and closes the dialog', async () => {
    await openDialog(false);
    restartWorker();
    const dialogResponse = vi.fn();
    chrome.runtime.onMessage.callListeners(
      { action: 'extractAllDomainsConfirmation', confirmed: true }, dialogSender, dialogResponse);

    await vi.waitFor(() => expect(dialogResponse).toHaveBeenCalled(), { timeout: 2000 });
    expect(dialogResponse).toHaveBeenCalledWith({ success: true, windows: 6, notMoved: 0, sortFailed: false });
    expect(chrome.windows.create).toHaveBeenCalledTimes(6);
    // respectGroups false moves plain tab-id lists, not group by group.
    expect(chrome.tabs.move).toHaveBeenCalledWith([2], { windowId: 100, index: -1 });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(DIALOG_TAB);
    expect(await chrome.storage.session.get(KEY)).toEqual({});
  });

  test('Confirm after a restart leaves the open dialog tab out of the split', async () => {
    await openDialog(false);
    restartWorker();
    // The restarted worker analyses afresh, and the dialog's tab is open then.
    const dialogTab = {
      id: DIALOG_TAB, url: 'chrome-extension://huddle/confirmation-dialog.html',
      pinned: false, groupId: -1, windowId: 1, index: 99,
    };
    chrome.tabs.query.mockImplementation(async (q) =>
      [...allTabs, dialogTab].filter((t) => q.windowId === undefined || t.windowId === q.windowId));
    const dialogResponse = vi.fn();
    chrome.runtime.onMessage.callListeners(
      { action: 'extractAllDomainsConfirmation', confirmed: true }, dialogSender, dialogResponse);

    await vi.waitFor(() => expect(dialogResponse).toHaveBeenCalled(), { timeout: 2000 });
    // Six domain windows, and no Miscellaneous window holding only the dialog.
    expect(dialogResponse).toHaveBeenCalledWith({ success: true, windows: 6, notMoved: 0, sortFailed: false });
    expect(chrome.windows.create).toHaveBeenCalledTimes(6);
    for (const [arg] of chrome.windows.create.mock.calls) {
      expect(arg && arg.tabId).not.toBe(DIALOG_TAB);
    }
    for (const [ids] of chrome.tabs.move.mock.calls) {
      expect([].concat(ids)).not.toContain(DIALOG_TAB);
    }
  });

  test('Cancel after a restart closes the dialog and splits nothing', async () => {
    await openDialog(true);
    restartWorker();
    const dialogResponse = vi.fn();
    await handleExtractAllDomainsConfirmation({ confirmed: false }, dialogSender, dialogResponse);

    expect(dialogResponse).toHaveBeenCalledWith({ success: true, cancelled: true });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(DIALOG_TAB);
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(await chrome.storage.session.get(KEY)).toEqual({});
  });

  test('Confirm with the request gone says so and splits nothing', async () => {
    const dialogResponse = vi.fn();
    await handleExtractAllDomainsConfirmation({ confirmed: true }, dialogSender, dialogResponse);

    expect(dialogResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false, expired: true }));
    expect(dialogResponse.mock.calls[0][0].error).toContain('run Split domains again');
    expect(chrome.windows.create).not.toHaveBeenCalled();
    // The tab stays open so the message can be read; Close then removes it.
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('Cancel with the request gone still closes the dialog', async () => {
    const dialogResponse = vi.fn();
    await handleExtractAllDomainsConfirmation({ confirmed: false }, dialogSender, dialogResponse);

    expect(dialogResponse).toHaveBeenCalledWith({ success: true, cancelled: true });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(DIALOG_TAB);
  });

  test("closing the dialog with its tab's X cancels and forgets the request", async () => {
    const popupResponse = await openDialog(true);
    chrome.tabs.onRemoved.callListeners(DIALOG_TAB, { windowId: 1, isWindowClosing: false });
    await flush();

    expect(popupResponse).toHaveBeenCalledWith({ success: true, cancelled: true });
    expect(await chrome.storage.session.get(KEY)).toEqual({});
    expect(splitConfirmWaiters.has(DIALOG_TAB)).toBe(false);
  });
});
