// Tests for background.js functionality
describe('Background Script', () => {
  beforeEach(() => {
    // Reset chrome API mocks
    jest.clearAllMocks();
  });

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

    test('should handle group-aware duplicate detection', () => {
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
  });

  describe('analyzeDomainDistribution', () => {
    test('should return valid structure', async () => {
      // Test the return structure rather than complex mocking
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

    test('should group tabs with headers when groups exist', () => {
      const tabs = [
        { id: 1, url: 'https://example.com/b', groupId: 1, groupInfo: { title: 'Work' } },
        { id: 2, url: 'https://example.com/a', groupId: 1, groupInfo: { title: 'Work' } },
        { id: 3, url: 'https://other.com/x', groupId: 2, groupInfo: { title: 'Fun' } },
        { id: 4, url: 'https://misc.com/z', groupId: -1, groupInfo: null },
      ];
      const result = formatTabsAsText(tabs, true);
      expect(result).toBe(
        'Work\nhttps://example.com/a\nhttps://example.com/b\n\n' +
        'Fun\nhttps://other.com/x\n\n' +
        'Ungrouped\nhttps://misc.com/z'
      );
    });

    test('should use "Untitled Group" for groups with empty title', () => {
      const tabs = [
        { id: 1, url: 'https://example.com/a', groupId: 1, groupInfo: { title: '' } },
        { id: 2, url: 'https://test.com/b', groupId: -1, groupInfo: null },
      ];
      const result = formatTabsAsText(tabs, true);
      expect(result).toContain('Untitled Group');
      expect(result).toContain('https://example.com/a');
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
      const mockSendResponse = jest.fn();
      const message = { type: 'log', data: { message: 'test', args: [] } };
      
      chrome.runtime.onMessage.callListeners(message, {}, mockSendResponse);
      
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('should have message listeners registered', () => {
      expect(chrome.runtime.onMessage.hasListeners()).toBe(true);
    });
  });
});