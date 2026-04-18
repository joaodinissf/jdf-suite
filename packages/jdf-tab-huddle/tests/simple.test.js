describe('Chrome Extension Testing Framework', () => {
  test('chrome APIs are properly mocked', () => {
    expect(chrome).toBeDefined();
    expect(chrome.tabs).toBeDefined();
    expect(chrome.windows).toBeDefined();
    expect(chrome.storage).toBeDefined();
    expect(chrome.runtime).toBeDefined();
    expect(chrome.tabGroups).toBeDefined();
  });

  test('chrome.tabs API mock works', async () => {
    const mockTabs = [
      { id: 1, url: 'https://example.com', title: 'Test Tab' }
    ];
    
    chrome.tabs.query.mockImplementation((query, callback) => {
      callback(mockTabs);
    });
    
    chrome.tabs.query({}, (tabs) => {
      expect(tabs).toEqual(mockTabs);
    });
    
    expect(chrome.tabs.query).toHaveBeenCalled();
  });

  test('chrome.storage API mock works', () => {
    const testData = { selectedMode: 'groups' };
    
    chrome.storage.local.set.mockImplementation((data, callback) => {
      if (callback) callback();
    });
    
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback(testData);
    });
    
    chrome.storage.local.set(testData);
    chrome.storage.local.get(['selectedMode'], (result) => {
      expect(result).toEqual(testData);
    });
    
    expect(chrome.storage.local.set).toHaveBeenCalledWith(testData);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['selectedMode'], expect.any(Function));
  });

  test('chrome.runtime.onMessage mock works', () => {
    const mockListener = vi.fn();
    const mockMessage = { action: 'test' };
    const mockSender = {};
    const mockSendResponse = vi.fn();
    
    chrome.runtime.onMessage.addListener(mockListener);
    expect(chrome.runtime.onMessage.hasListener(mockListener)).toBe(true);
    
    chrome.runtime.onMessage.callListeners(mockMessage, mockSender, mockSendResponse);
    expect(mockListener).toHaveBeenCalledWith(mockMessage, mockSender, mockSendResponse);
  });

  test('chrome.tabGroups API mock works', async () => {
    const mockGroups = [
      { id: 1, title: 'Test Group', color: 'blue' }
    ];
    
    chrome.tabGroups.query.mockResolvedValue(mockGroups);
    
    const result = await chrome.tabGroups.query({});
    expect(result).toEqual(mockGroups);
    expect(chrome.tabGroups.query).toHaveBeenCalled();
  });

  test('URL parsing utility works', () => {
    expect(lexHost('https://example.com/path')).toBe('example.com');
    expect(lexHost('chrome://settings/')).toBe('settings');
    expect(lexHost('file:///path/file.html')).toBe('file');
    expect(lexHost('chrome-extension://abc123/popup.html')).toBe('abc123');
  });
});