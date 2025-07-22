// Background service worker for persistent logging
console.log('Tab Organizer service worker starting...');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Tab Organizer]', message.data.message, ...message.data.args);
    sendResponse({ success: true });
  } else if (message.action === 'sortAllWindows') {
    handleSortAllWindows(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'sortCurrentWindow') {
    handleSortCurrentWindow(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesWindow') {
    handleRemoveDuplicatesWindow(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesAllWindows') {
    handleRemoveDuplicatesAllWindows(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesGlobally') {
    handleRemoveDuplicatesGlobally(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractDomain') {
    handleExtractDomain(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomains') {
    handleExtractAllDomains(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomainsConfirmation') {
    // This will be handled by the confirmation dialog listener
    sendResponse({ success: true });
  } else if (message.action === 'moveAllToSingleWindow') {
    handleMoveAllToSingleWindow(message, sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleSortAllWindows(sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Sorting tabs in', windows.length, 'windows');

    // Sort tabs within each window
    for (const window of windows) {
      await sortWindowTabs(window.id);
    }

    console.log('[Tab Organizer] Completed sortAllWindows');
    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSortCurrentWindow(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Sorting tabs in current window');

    await sortWindowTabs(tabs[0].windowId);

    console.log('[Tab Organizer] Completed sortCurrentWindow');
    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortCurrentWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Extract domain from URL with better handling for sleeping tabs
function lexHost(url) {
  try {
    var u = new URL(url);

    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') {
      return u.host;
    }

    if (u.protocol === 'file:') {
      return 'file';
    }

    if (u.protocol === 'data:') {
      return 'data';
    }

    if (u.protocol === 'about:' || u.protocol === 'chrome:') {
      return u.host || u.pathname.split('/')[0];
    }

    return u.hostname;
  } catch (e) {
    return url || '';
  }
}

async function handleExtractDomain(message, sendResponse) {
  try {
    const targetDomain = lexHost(message.url);
    console.log('[Tab Organizer] Extracting domain:', targetDomain);

    // Create a window with the active tab in it
    const newWindow = await chrome.windows.create({
      tabId: message.tabId,
      focused: true
    });

    // Query all tabs to find matching domain tabs
    const allTabs = await chrome.tabs.query({});

    const tabsToMove = [];
    for (const tab of allTabs) {
      const tabDomain = lexHost(tab.url);
      // Skip pinned tabs - they cannot be moved between windows
      if (tabDomain === targetDomain && tab.id !== message.tabId && !tab.pinned) {
        tabsToMove.push(tab.id);
      }
    }

    // Move matching tabs to the new window
    if (tabsToMove.length > 0) {
      await chrome.tabs.move(tabsToMove, {
        windowId: newWindow.id,
        index: -1
      });
      console.log('[Tab Organizer] Moved', tabsToMove.length, 'tabs to new window');
    }

    // Wait a moment for tabs to settle, then sort
    setTimeout(async () => {
      const windowTabs = await chrome.tabs.query({ windowId: newWindow.id });

      // Filter out pinned tabs for sorting
      const unpinnedTabs = windowTabs.filter(tab => !tab.pinned);

      // Sort unpinned tabs by URL
      unpinnedTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });

      // Move unpinned tabs to sorted positions (starting after any pinned tabs)
      const pinnedCount = windowTabs.filter(tab => tab.pinned).length;
      for (let i = 0; i < unpinnedTabs.length; i++) {
        await chrome.tabs.move(unpinnedTabs[i].id, { index: pinnedCount + i });
      }

      // Activate the original active tab
      await chrome.tabs.update(message.tabId, { active: true });

      console.log('[Tab Organizer] Completed extractDomain');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in extractDomain:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within current window only
async function handleRemoveDuplicatesWindow(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Removing duplicates in current window');

    const { tabsToRemove } = findDuplicateTabs([tabs]);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs from current window');
    }

    // Sort remaining tabs in the current window
    setTimeout(async () => {
      await sortWindowTabs(tabs[0].windowId);
      console.log('[Tab Organizer] Completed removeDuplicatesWindow');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within each window separately
async function handleRemoveDuplicatesAllWindows(sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates in', windows.length, 'windows separately');

    const windowTabs = windows.map(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs(windowTabs);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs across all windows');
    }

    // Sort all windows
    setTimeout(async () => {
      for (const window of windows) {
        await sortWindowTabs(window.id);
      }
      console.log('[Tab Organizer] Completed removeDuplicatesAllWindows');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates across all windows globally
async function handleRemoveDuplicatesGlobally(sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates globally across all windows');

    // Flatten all tabs from all windows for global deduplication
    const allTabs = windows.flatMap(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs([allTabs]);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs globally');
    }

    // Sort all windows
    setTimeout(async () => {
      for (const window of windows) {
        await sortWindowTabs(window.id);
      }
      console.log('[Tab Organizer] Completed removeDuplicatesGlobally');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesGlobally:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Helper function to find duplicate tabs
function findDuplicateTabs(tabGroups) {
  const urlSeen = new Map();
  const tabsToRemove = [];

  // Process each group of tabs (either per window or globally)
  for (const tabs of tabGroups) {
    const localUrlSeen = new Map();

    for (const tab of tabs) {
      // Never remove pinned tabs
      if (tab.pinned) {
        continue;
      }

      const url = tab.pendingUrl || tab.url;

      // For per-window deduplication, track within each window
      // For global deduplication, track across all windows
      const seenMap = tabGroups.length === 1 ? urlSeen : localUrlSeen;

      if (seenMap.has(url)) {
        // This is a duplicate - mark for removal
        tabsToRemove.push(tab.id);
      } else {
        // First occurrence - keep it
        seenMap.set(url, tab.id);
        if (tabGroups.length === 1) {
          // For global deduplication, also track in the global map
          urlSeen.set(url, tab.id);
        }
      }
    }
  }

  return { tabsToRemove };
}

// Analyze all domains and their tab counts
async function analyzeDomainDistribution() {
  try {
    const allTabs = await chrome.tabs.query({});
    const domainTabCounts = new Map();
    const domainTabs = new Map();

    // Count tabs per domain (exclude pinned tabs from extraction consideration)
    for (const tab of allTabs) {
      if (tab.pinned) continue;

      const domain = lexHost(tab.url);
      if (!domainTabCounts.has(domain)) {
        domainTabCounts.set(domain, 0);
        domainTabs.set(domain, []);
      }
      domainTabCounts.set(domain, domainTabCounts.get(domain) + 1);
      domainTabs.get(domain).push(tab);
    }

    // Separate domains by tab count
    const extractableDomains = [];
    const singleTabDomains = [];

    for (const [domain, count] of domainTabCounts.entries()) {
      if (count >= 2) {
        extractableDomains.push(domain);
      } else {
        singleTabDomains.push(domain);
      }
    }

    return {
      extractableDomains,
      singleTabDomains,
      domainTabCounts,
      domainTabs
    };
  } catch (error) {
    console.error('[Tab Organizer] Error analyzing domain distribution:', error);
    return {
      extractableDomains: [],
      singleTabDomains: [],
      domainTabCounts: new Map(),
      domainTabs: new Map()
    };
  }
}

// Create confirmation dialog URL with parameters
function createConfirmationDialogUrl(domainAnalysis) {
  const extractableCount = domainAnalysis.extractableDomains.length;
  const singleTabCount = domainAnalysis.singleTabDomains.length;

  const params = new URLSearchParams({
    extractable: extractableCount.toString(),
    single: singleTabCount.toString()
  });

  return chrome.runtime.getURL(`confirmation-dialog.html?${params.toString()}`);
}

// Handle Extract All Domains functionality
async function handleExtractAllDomains(sendResponse) {
  try {
    console.log('[Tab Organizer] Starting Extract All Domains');

    // Analyze all domains and their tab counts
    const domainAnalysis = await analyzeDomainDistribution();

    // Check if confirmation is needed (more than 5 total windows would be created)
    const totalWindowsToCreate = domainAnalysis.extractableDomains.length + (domainAnalysis.singleTabDomains.length > 0 ? 1 : 0);
    const needsConfirmation = totalWindowsToCreate > 5;

    if (needsConfirmation) {
      console.log('[Tab Organizer] Many windows would be created, requesting confirmation');

      // Create a confirmation dialog using the separate HTML file
      const confirmationUrl = createConfirmationDialogUrl(domainAnalysis);
      const confirmTab = await chrome.tabs.create({
        url: confirmationUrl,
        active: true
      });

      // Set up a one-time listener for the confirmation response
      const confirmationPromise = new Promise((resolve) => {
        const messageListener = (confirmMessage, sender, confirmSendResponse) => {
          if (confirmMessage.action === 'extractAllDomainsConfirmation' && sender.tab.id === confirmTab.id) {
            chrome.runtime.onMessage.removeListener(messageListener);
            chrome.tabs.remove(confirmTab.id);
            confirmSendResponse({ success: true });
            resolve(confirmMessage.confirmed);
          }
        };
        chrome.runtime.onMessage.addListener(messageListener);
      });

      const confirmed = await confirmationPromise;
      if (!confirmed) {
        console.log('[Tab Organizer] User cancelled Extract All Domains');
        sendResponse({ success: true, cancelled: true });
        return;
      }
    }

    // Proceed with extraction
    await performExtractAllDomains(domainAnalysis);

    // Sort all windows after operations
    setTimeout(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      for (const window of windows) {
        await sortWindowTabs(window.id);
      }
      console.log('[Tab Organizer] Completed Extract All Domains');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in Extract All Domains:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Perform the actual extraction logic
async function performExtractAllDomains(domainAnalysis) {
  try {
    console.log('[Tab Organizer] Performing extraction for', domainAnalysis.extractableDomains.length, 'domains');

    // Phase 1: Create one window per domain with ≥2 tabs
    for (const domain of domainAnalysis.extractableDomains) {
      const domainTabs = domainAnalysis.domainTabs.get(domain);

      if (domainTabs.length < 2) continue;

      // Use the first tab as the anchor for the new window
      const anchorTab = domainTabs[0];

      // Create new window with the anchor tab
      const newWindow = await chrome.windows.create({
        tabId: anchorTab.id,
        focused: false // Don't focus individual domain windows
      });

      // Move other tabs from this domain to the new window
      const tabsToMove = domainTabs.slice(1).map(tab => tab.id);
      if (tabsToMove.length > 0) {
        await chrome.tabs.move(tabsToMove, {
          windowId: newWindow.id,
          index: -1
        });
      }

      console.log('[Tab Organizer] Created window for domain:', domain, 'with', domainTabs.length, 'tabs');
    }

    // Phase 2: Create one "Miscellaneous" window for all single-tab domains
    if (domainAnalysis.singleTabDomains.length > 0) {
      console.log('[Tab Organizer] Creating miscellaneous window for', domainAnalysis.singleTabDomains.length, 'single-tab domains');

      // Use the first single-tab domain as the anchor
      const firstSingleDomain = domainAnalysis.singleTabDomains[0];
      const firstTab = domainAnalysis.domainTabs.get(firstSingleDomain)[0];

      const miscWindow = await chrome.windows.create({
        tabId: firstTab.id,
        focused: false
      });

      // Move all other single tabs to the miscellaneous window
      const singleTabsToMove = [];
      for (let i = 1; i < domainAnalysis.singleTabDomains.length; i++) {
        const domain = domainAnalysis.singleTabDomains[i];
        const tab = domainAnalysis.domainTabs.get(domain)[0];
        singleTabsToMove.push(tab.id);
      }

      if (singleTabsToMove.length > 0) {
        await chrome.tabs.move(singleTabsToMove, {
          windowId: miscWindow.id,
          index: -1
        });
      }

      console.log('[Tab Organizer] Created miscellaneous window with', domainAnalysis.singleTabDomains.length, 'single-tab domains');
    }

    console.log('[Tab Organizer] Extract All Domains extraction phase completed');

  } catch (error) {
    console.error('[Tab Organizer] Error in performExtractAllDomains:', error);
    throw error;
  }
}

// Helper function to sort tabs within a specific window
async function sortWindowTabs(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    // Separate pinned and unpinned tabs
    const pinnedTabs = tabs.filter(tab => tab.pinned);
    const unpinnedTabs = tabs.filter(tab => !tab.pinned);
    // Sort unpinned tabs by URL
    unpinnedTabs.sort((a, b) => {
      const urlA = a.pendingUrl || a.url;
      const urlB = b.pendingUrl || b.url;
      return urlA.localeCompare(urlB);
    });

    // Move unpinned tabs to their sorted positions (starting after pinned tabs)
    for (let i = 0; i < unpinnedTabs.length; i++) {
      await chrome.tabs.move(unpinnedTabs[i].id, {
        windowId,
        index: pinnedTabs.length + i
      });
    }
  } catch (error) {
    console.error('[Tab Organizer] Error sorting window tabs:', error);
  }
}

async function handleMoveAllToSingleWindow(message, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Moving tabs from', windows.length, 'windows to single window');

    if (windows.length <= 1) {
      console.log('[Tab Organizer] Only one window exists, nothing to move');
      sendResponse({ success: true });
      return;
    }

    // Find the window containing the active tab to use as the target
    let targetWindow = null;
    if (message.activeTabId) {
      targetWindow = windows.find(w => w.tabs.some(tab => tab.id === message.activeTabId));
    }

    if (!targetWindow) {
      // If no active tab provided or found, use the focused window
      targetWindow = windows.find(w => w.focused);
      if (!targetWindow) {
        // If no focused window, use the first window as target
        targetWindow = windows[0];
      }
    }

    const allTabsToMove = [];

    // Collect all unpinned tabs from other windows (pinned tabs cannot be moved between windows)
    for (const window of windows) {
      if (window.id !== targetWindow.id) {
        for (const tab of window.tabs) {
          if (!tab.pinned) {
            allTabsToMove.push(tab.id);
          }
        }
      }
    }

    if (allTabsToMove.length === 0) {
      console.log('[Tab Organizer] No unpinned tabs to move');
      sendResponse({ success: true });
      return;
    }

    // Move all unpinned tabs to the target window
    await chrome.tabs.move(allTabsToMove, {
      windowId: targetWindow.id,
      index: -1
    });

    console.log('[Tab Organizer] Moved', allTabsToMove.length, 'unpinned tabs to single window');

    // Wait a moment for tabs to settle, then sort unpinned tabs in the target window
    setTimeout(async () => {
      await sortWindowTabs(targetWindow.id);

      console.log('[Tab Organizer] Completed moveAllToSingleWindow');

      // Bring the target window into focus
      await chrome.windows.update(targetWindow.id, { focused: true });

      // If we have an active tab ID, make sure it stays active
      if (message.activeTabId) {
        await chrome.tabs.update(message.activeTabId, { active: true });
      }
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in moveAllToSingleWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}