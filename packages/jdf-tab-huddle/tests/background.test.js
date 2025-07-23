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