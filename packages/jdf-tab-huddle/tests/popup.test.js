describe('Popup Script', () => {
  beforeEach(() => {
    // Setup DOM for popup tests
    document.body.innerHTML = `
      <div class="tab-button active" data-tab="groups">Groups</div>
      <div class="tab-button" data-tab="individual">Individual</div>
      <div id="groups-content" class="tab-content active"></div>
      <div id="individual-content" class="tab-content"></div>
      <button id="sortAllWindows-groups">Sort All Windows</button>
      <button id="sortCurrentWindow-groups">Sort Current Window</button>
      <button id="removeDuplicatesWindow-groups">Remove Duplicates</button>
      <button id="extractDomain-groups">Extract Domain</button>
      <button id="copyAllTabs-groups">Copy All Tabs</button>
      <div id="copyFeedback-groups" class="copy-feedback">Copied!</div>
    `;

    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({ selectedMode: 'groups' });
    });
    chrome.storage.local.set.mockImplementation(() => {});
    chrome.tabs.query.mockImplementation((query, callback) => {
      callback([{ id: 1, url: 'https://example.com', active: true }]);
    });
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (callback) callback({ success: true });
      return Promise.resolve();
    });
  });

  describe('getCurrentMode function', () => {
    test('should return active tab mode', () => {
      expect(getCurrentMode()).toBe('groups');

      document.querySelector('.tab-button.active').classList.remove('active');
      document.querySelector('[data-tab="individual"]').classList.add('active');

      expect(getCurrentMode()).toBe('individual');
    });

    test('should default to groups if no active tab', () => {
      document.querySelector('.tab-button.active').classList.remove('active');
      expect(getCurrentMode()).toBe('groups');
    });
  });

  describe('saveUserPreference function', () => {
    test('should save preference to chrome storage', () => {
      saveUserPreference('selectedMode', 'individual');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ selectedMode: 'individual' });
    });
  });

  describe('loadUserPreferences function', () => {
    test('should load and apply saved preferences', () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ selectedMode: 'individual' });
      });

      loadUserPreferences();
      expect(chrome.storage.local.get).toHaveBeenCalledWith(['selectedMode'], expect.any(Function));
    });
  });

  describe('Action functions', () => {
    test('sortAllWindows should send correct message', () => {
      sortAllWindows(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'sortAllWindows', respectGroups: true },
        expect.any(Function)
      );
    });

    test('sortCurrentWindow should send correct message', () => {
      sortCurrentWindow(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'sortCurrentWindow', respectGroups: false },
        expect.any(Function)
      );
    });

    test('extractDomain should query active tab and send message', () => {
      extractDomain(true);
      expect(chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function)
      );
    });

    test('removeDuplicatesWindow should send correct message', () => {
      removeDuplicatesWindow(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'removeDuplicatesWindow', respectGroups: true },
        expect.any(Function)
      );
    });

    test('removeDuplicatesAllWindows should send correct message', () => {
      removeDuplicatesAllWindows(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'removeDuplicatesAllWindows', respectGroups: false },
        expect.any(Function)
      );
    });

    test('removeDuplicatesGlobally should send correct message', () => {
      removeDuplicatesGlobally(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'removeDuplicatesGlobally', respectGroups: true },
        expect.any(Function)
      );
    });

    test('extractAllDomains should send correct message', () => {
      extractAllDomains(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'extractAllDomains', respectGroups: false },
        expect.any(Function)
      );
    });

    test('moveAllToSingleWindow should query active tab and send message', () => {
      moveAllToSingleWindow(true);
      expect(chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function)
      );
    });
  });

  describe('Copy All Tabs', () => {
    test('copyAllTabs should send correct message with respectGroups true', () => {
      copyAllTabs(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'copyAllTabs', respectGroups: true },
        expect.any(Function)
      );
    });

    test('copyAllTabs should send correct message with respectGroups false', () => {
      copyAllTabs(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'copyAllTabs', respectGroups: false },
        expect.any(Function)
      );
    });
  });

  describe('Error handling', () => {
    test('should handle chrome.runtime.lastError in callbacks', () => {
      chrome.runtime.lastError = { message: 'Test error' };
      const consoleSpy = vi.spyOn(console, 'log');

      sortAllWindows(true);

      const callback = chrome.runtime.sendMessage.mock.calls[0][1];
      callback({ success: false, error: 'Background error' });

      expect(consoleSpy).toHaveBeenCalled();

      delete chrome.runtime.lastError;
    });
  });
});
