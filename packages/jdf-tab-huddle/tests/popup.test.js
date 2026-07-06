describe('Popup Script', () => {
  beforeEach(() => {
    // Setup DOM for popup tests
    document.body.innerHTML = `
      <button id="modeGroups" aria-pressed="true">Groups</button>
      <button id="modeFlat" aria-pressed="false">Flat</button>
      <small id="modeSubtitle"></small>
      <button id="sortAllWindows">Sort All Windows</button>
      <button id="sortCurrentWindow">Sort Current Window</button>
      <button id="removeDuplicatesWindow">Remove Duplicates</button>
      <button id="removeDuplicatesAllWindows">Remove Duplicates (All Windows)</button>
      <button id="removeDuplicatesGlobally">Remove Duplicates (Globally)</button>
      <button id="extractDomain">Extract Domain</button>
      <button id="extractAllDomains">Extract All Domains</button>
      <button id="moveAllToSingleWindow">Move All To Single Window</button>
      <button id="copyAllTabs">Copy All Tabs</button>
      <button id="flattenWindow">Ungroup</button>
      <div id="copyFeedback" class="copy-feedback">Copied!</div>
      <button id="aiOrganize">Organize with AI</button>
      <button id="aiSettings" style="display: none;">⚙️</button>
      <span id="statusThisWindow"></span>
      <span id="statusAllWindows"></span>
    `;

    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({ respectGroups: true });
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

  describe('getRespectGroups / setRespectGroups', () => {
    test('setRespectGroups(false) flips the toggle state and DOM', () => {
      setRespectGroups(false);
      expect(getRespectGroups()).toBe(false);
      expect(document.getElementById('modeGroups').getAttribute('aria-pressed')).toBe('false');
      expect(document.getElementById('modeFlat').getAttribute('aria-pressed')).toBe('true');
      expect(document.getElementById('modeSubtitle').textContent).toBe('flat mode');
    });

    test('setRespectGroups(true) restores the Groups state', () => {
      setRespectGroups(false);
      setRespectGroups(true);
      expect(getRespectGroups()).toBe(true);
      expect(document.getElementById('modeGroups').getAttribute('aria-pressed')).toBe('true');
      expect(document.getElementById('modeFlat').getAttribute('aria-pressed')).toBe('false');
      expect(document.getElementById('modeSubtitle').textContent).toBe('respecting groups');
    });

    test('persists to chrome.storage.local under "respectGroups" by default', () => {
      setRespectGroups(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ respectGroups: false });
    });

    test('does not persist when { persist: false } is passed', () => {
      setRespectGroups(false, { persist: false });
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('saveUserPreference function', () => {
    test('should save preference to chrome storage', () => {
      saveUserPreference('respectGroups', false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ respectGroups: false });
    });
  });

  describe('loadUserPreferences function', () => {
    test('should load and apply an existing respectGroups preference without re-persisting', () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ respectGroups: false });
      });

      loadUserPreferences();
      expect(chrome.storage.local.get).toHaveBeenCalledWith(
        ['respectGroups', 'selectedMode'],
        expect.any(Function)
      );
      expect(getRespectGroups()).toBe(false);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('migrates the legacy selectedMode="individual" preference to respectGroups=false', () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ selectedMode: 'individual' });
      });

      loadUserPreferences();
      expect(getRespectGroups()).toBe(false);
      // The migrated value is persisted under the new key.
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ respectGroups: false });
    });

    test('migrates a missing/legacy "groups" preference to respectGroups=true', () => {
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({});
      });

      loadUserPreferences();
      expect(getRespectGroups()).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ respectGroups: true });
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
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'extractDomain', tabId: 1, url: 'https://example.com', respectGroups: true },
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
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'moveAllToSingleWindow', activeTabId: 1, respectGroups: true },
        expect.any(Function)
      );
    });

    test('flattenWindow should send correct message (background action name unchanged)', () => {
      flattenWindow();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'flattenWindow' },
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

  describe('updateStatusBar', () => {
    test('singular counts: "1 tab" / "1 tab · 1 window" (no groups)', () => {
      chrome.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 1, windowId: 10 }]);
      });
      chrome.windows.getAll.mockImplementation((options, callback) => {
        callback([{ id: 10, tabs: [{ id: 1 }] }]);
      });
      chrome.tabGroups.query.mockImplementation((query, callback) => {
        callback([]);
      });

      updateStatusBar();

      expect(document.getElementById('statusThisWindow').textContent).toBe('1 tab');
      expect(document.getElementById('statusAllWindows').textContent).toBe('1 tab · 1 window');
    });

    test('plural counts with groups: "N tabs, M groups" style summaries', () => {
      chrome.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 1, windowId: 10 }, { id: 2, windowId: 10 }, { id: 3, windowId: 10 }]);
      });
      chrome.windows.getAll.mockImplementation((options, callback) => {
        callback([
          { id: 10, tabs: [{ id: 1 }, { id: 2 }, { id: 3 }] },
          { id: 20, tabs: [{ id: 4 }, { id: 5 }] },
        ]);
      });
      chrome.tabGroups.query.mockImplementation((query, callback) => {
        callback([{ id: 100, windowId: 10 }, { id: 101, windowId: 10 }, { id: 102, windowId: 20 }]);
      });

      updateStatusBar();

      expect(document.getElementById('statusThisWindow').textContent).toBe('3 tabs · 2 groups');
      expect(document.getElementById('statusAllWindows').textContent).toBe('5 tabs · 2 windows · 3 groups');
    });
  });

  describe('AI wiring — click-driven', () => {
    beforeEach(() => {
      popupSetupEventListeners();
    });

    test('clicking #aiOrganize sends aiGroupTabs with the current respectGroups toggle (Groups mode)', () => {
      setRespectGroups(true, { persist: false });
      document.getElementById('aiOrganize').click();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'aiGroupTabs', respectGroups: true },
        expect.any(Function)
      );
    });

    test('clicking #aiOrganize sends aiGroupTabs with the current respectGroups toggle (Flat mode)', () => {
      setRespectGroups(false, { persist: false });
      document.getElementById('aiOrganize').click();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'aiGroupTabs', respectGroups: false },
        expect.any(Function)
      );
    });

    test('clicking #aiSettings sends openAiSettings', () => {
      document.getElementById('aiSettings').click();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'openAiSettings' },
        expect.any(Function)
      );
    });
  });

  describe('updateAiButtonState', () => {
    test('shows the AI settings cog when a key is configured', () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'loadAiConfig') {
          callback({ config: { key: 'encoded-key' } });
        }
      });

      updateAiButtonState();

      expect(document.getElementById('aiSettings').style.display).toBe('flex');
    });

    test('hides the AI settings cog when no key is configured', () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'loadAiConfig') {
          callback({ config: null });
        }
      });

      updateAiButtonState();

      expect(document.getElementById('aiSettings').style.display).toBe('none');
    });
  });
});
