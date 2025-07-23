// Background service worker for persistent logging
console.log('Tab Organizer service worker starting...');

// Tab Groups Helper Functions
async function getTabGroupsInfo(windowId = null) {
  try {
    const query = windowId ? { windowId } : {};
    const groups = await chrome.tabGroups.query(query);
    const groupsMap = new Map();
    
    for (const group of groups) {
      groupsMap.set(group.id, group);
    }
    
    return groupsMap;
  } catch (error) {
    console.error('[Tab Organizer] Error getting tab groups info:', error);
    return new Map();
  }
}

async function getTabsWithGroupInfo(windowId = null) {
  try {
    const query = windowId ? { windowId } : {};
    const tabs = await chrome.tabs.query(query);
    const groupsMap = await getTabGroupsInfo(windowId);
    
    return tabs.map(tab => ({
      ...tab,
      groupInfo: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupsMap.get(tab.groupId) : null
    }));
  } catch (error) {
    console.error('[Tab Organizer] Error getting tabs with group info:', error);
    return [];
  }
}

// Helper function to recreate tab groups when moving tabs between windows
async function recreateTabGroup(groupInfo, tabIds, targetWindowId) {
  try {
    if (!groupInfo || tabIds.length === 0) {
      return null;
    }
    
    // Create new group with the tabs
    const newGroupId = await chrome.tabs.group({
      tabIds: tabIds,
      createProperties: {
        windowId: targetWindowId
      }
    });
    
    // Update the group with the original properties
    await chrome.tabGroups.update(newGroupId, {
      title: groupInfo.title || '',
      color: groupInfo.color || 'grey',
      collapsed: groupInfo.collapsed || false
    });
    
    return newGroupId;
  } catch (error) {
    console.error('[Tab Organizer] Error recreating tab group:', error);
    return null;
  }
}

// Helper function to move tabs while preserving group structure
async function moveTabsWithGroups(tabsToMove, targetWindowId) {
  try {
    // Group tabs by their original group
    const tabsByGroup = new Map();
    
    for (const tab of tabsToMove) {
      const groupKey = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tab.groupId : 'ungrouped';
      if (!tabsByGroup.has(groupKey)) {
        tabsByGroup.set(groupKey, []);
      }
      tabsByGroup.get(groupKey).push(tab);
    }
    
    // Move ungrouped tabs first
    if (tabsByGroup.has('ungrouped')) {
      const ungroupedTabs = tabsByGroup.get('ungrouped');
      await chrome.tabs.move(
        ungroupedTabs.map(tab => tab.id),
        { windowId: targetWindowId, index: -1 }
      );
      tabsByGroup.delete('ungrouped');
    }
    
    // Move and recreate grouped tabs
    for (const [_originalGroupId, groupTabs] of tabsByGroup.entries()) {
      const tabIds = groupTabs.map(tab => tab.id);
      
      // Move tabs to target window first (they lose their group membership)
      await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
      
      // Recreate the group if we have group info
      if (groupTabs[0].groupInfo) {
        await recreateTabGroup(groupTabs[0].groupInfo, tabIds, targetWindowId);
      }
    }
    
  } catch (error) {
    console.error('[Tab Organizer] Error moving tabs with groups:', error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Tab Organizer]', message.data.message, ...message.data.args);
    sendResponse({ success: true });
  } else if (message.action === 'sortAllWindows') {
    handleSortAllWindows(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'sortCurrentWindow') {
    handleSortCurrentWindow(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesWindow') {
    handleRemoveDuplicatesWindow(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesAllWindows') {
    handleRemoveDuplicatesAllWindows(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'removeDuplicatesGlobally') {
    handleRemoveDuplicatesGlobally(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractDomain') {
    handleExtractDomain(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomains') {
    handleExtractAllDomains(message.respectGroups, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'extractAllDomainsConfirmation') {
    // This will be handled by the confirmation dialog listener
    sendResponse({ success: true });
  } else if (message.action === 'moveAllToSingleWindow') {
    handleMoveAllToSingleWindow(message, sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleSortAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Sorting tabs in', windows.length, 'windows', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Sort tabs within each window
    for (const window of windows) {
      await sortWindowTabs(window.id, respectGroups);
    }

    console.log('[Tab Organizer] Completed sortAllWindows');
    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in sortAllWindows:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSortCurrentWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Sorting tabs in current window', respectGroups ? '(preserving groups)' : '(individual tabs)');

    await sortWindowTabs(tabs[0].windowId, respectGroups);

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
  } catch (_e) {
    return url || '';
  }
}

async function handleExtractDomain(message, sendResponse) {
  try {
    const targetDomain = lexHost(message.url);
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    console.log('[Tab Organizer] Extracting domain:', targetDomain, respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Create a window with the active tab in it
    const newWindow = await chrome.windows.create({
      tabId: message.tabId,
      focused: true
    });

    // Query tabs based on mode
    const allTabs = respectGroups ? await getTabsWithGroupInfo() : await chrome.tabs.query({});

    const tabsToMove = [];
    for (const tab of allTabs) {
      const tabDomain = lexHost(tab.url);
      // Skip pinned tabs and the active tab that's already in the new window
      if (tabDomain === targetDomain && tab.id !== message.tabId && !tab.pinned) {
        tabsToMove.push(tab);
      }
    }

    // Move matching tabs to the new window
    if (tabsToMove.length > 0) {
      if (respectGroups) {
        await moveTabsWithGroups(tabsToMove, newWindow.id);
      } else {
        // Simple move for individual mode
        const tabIds = tabsToMove.map(tab => tab.id);
        await chrome.tabs.move(tabIds, { windowId: newWindow.id, index: -1 });
      }
      console.log('[Tab Organizer] Moved', tabsToMove.length, 'tabs to new window');
    }

    // Wait a moment for tabs to settle, then sort
    setTimeout(async () => {
      await sortWindowTabs(newWindow.id, respectGroups);

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
async function handleRemoveDuplicatesWindow(respectGroups = true, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('[Tab Organizer] Removing duplicates in current window', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const { tabsToRemove } = findDuplicateTabs([tabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs from current window');
    }

    // Sort remaining tabs in the current window
    setTimeout(async () => {
      await sortWindowTabs(tabs[0].windowId, respectGroups);
      console.log('[Tab Organizer] Completed removeDuplicatesWindow');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Remove duplicates within each window separately
async function handleRemoveDuplicatesAllWindows(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates in', windows.length, 'windows separately', respectGroups ? '(respecting groups)' : '(individual tabs)');

    const windowTabArrays = windows.map(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs(windowTabArrays, respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs across all windows');
    }

    // Sort all windows
    setTimeout(async () => {
      for (const window of windows) {
        await sortWindowTabs(window.id, respectGroups);
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
async function handleRemoveDuplicatesGlobally(respectGroups = true, sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Removing duplicates globally across all windows', respectGroups ? '(respecting groups)' : '(individual tabs)');

    // Flatten all tabs from all windows for global deduplication
    const allTabs = windows.flatMap(window => window.tabs);
    const { tabsToRemove } = findDuplicateTabs([allTabs], respectGroups);

    if (tabsToRemove.length > 0) {
      await chrome.tabs.remove(tabsToRemove);
      console.log('[Tab Organizer] Removed', tabsToRemove.length, 'duplicate tabs globally');
    }

    // Sort all windows
    setTimeout(async () => {
      for (const window of windows) {
        await sortWindowTabs(window.id, respectGroups);
      }
      console.log('[Tab Organizer] Completed removeDuplicatesGlobally');
    }, 200);

    sendResponse({ success: true });

  } catch (error) {
    console.error('[Tab Organizer] Error in removeDuplicatesGlobally:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Helper function to find duplicate tabs while considering tab groups
function findDuplicateTabs(tabArrays, respectGroups = true) {
  const urlSeen = new Map();
  const tabsToRemove = [];

  // Process each array of tabs (either per window or globally)
  for (const tabs of tabArrays) {
    const localUrlSeen = new Map();

    // Group tabs by their group membership if respecting groups
    const tabsByGroup = new Map();
    if (respectGroups) {
      for (const tab of tabs) {
        const groupKey = tab.groupId || 'ungrouped';
        if (!tabsByGroup.has(groupKey)) {
          tabsByGroup.set(groupKey, []);
        }
        tabsByGroup.get(groupKey).push(tab);
      }
    } else {
      // Treat all tabs as one group if not respecting groups
      tabsByGroup.set('all', tabs);
    }

    // Process each group separately
    for (const [_groupKey, groupTabs] of tabsByGroup.entries()) {
      const groupUrlSeen = new Map();
      
      for (const tab of groupTabs) {
        // Never remove pinned tabs
        if (tab.pinned) {
          continue;
        }

        const url = tab.pendingUrl || tab.url;

        // For per-window deduplication, track within each window/group
        // For global deduplication, track across all windows but respect groups if enabled
        const seenMap = respectGroups 
          ? (tabArrays.length === 1 ? urlSeen : groupUrlSeen)
          : (tabArrays.length === 1 ? urlSeen : localUrlSeen);

        if (seenMap.has(url)) {
          // This is a duplicate - mark for removal
          tabsToRemove.push(tab.id);
        } else {
          // First occurrence - keep it
          seenMap.set(url, tab.id);
          if (tabArrays.length === 1) {
            // For global deduplication, also track in the global map
            urlSeen.set(url, tab.id);
          }
        }
      }
    }
  }

  return { tabsToRemove };
}

// Analyze all domains and their tab counts
async function analyzeDomainDistribution() {
  try {
    const allTabsWithGroups = await getTabsWithGroupInfo();
    const domainTabCounts = new Map();
    const domainTabs = new Map();

    // Count tabs per domain (exclude pinned tabs from extraction consideration)
    for (const tab of allTabsWithGroups) {
      if (tab.pinned) {continue;}

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
async function handleExtractAllDomains(respectGroups = true, sendResponse) {
  try {
    console.log('[Tab Organizer] Starting Extract All Domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

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
    await performExtractAllDomains(domainAnalysis, respectGroups);

    // Sort all windows after operations
    setTimeout(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      for (const window of windows) {
        await sortWindowTabs(window.id, respectGroups);
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
async function performExtractAllDomains(domainAnalysis, respectGroups = true) {
  try {
    console.log('[Tab Organizer] Performing extraction for', domainAnalysis.extractableDomains.length, 'domains', respectGroups ? '(preserving groups)' : '(individual tabs)');

    // Phase 1: Create one window per domain with ≥2 tabs
    for (const domain of domainAnalysis.extractableDomains) {
      const domainTabs = domainAnalysis.domainTabs.get(domain);

      if (domainTabs.length < 2) {continue;}

      // Use the first tab as the anchor for the new window
      const anchorTab = domainTabs[0];

      // Create new window with the anchor tab
      const newWindow = await chrome.windows.create({
        tabId: anchorTab.id,
        focused: false // Don't focus individual domain windows
      });

      // Move other tabs from this domain to the new window
      const tabsToMove = domainTabs.slice(1);
      if (tabsToMove.length > 0) {
        if (respectGroups) {
          await moveTabsWithGroups(tabsToMove, newWindow.id);
        } else {
          const tabIds = tabsToMove.map(tab => tab.id);
          await chrome.tabs.move(tabIds, { windowId: newWindow.id, index: -1 });
        }
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
        singleTabsToMove.push(tab);
      }

      if (singleTabsToMove.length > 0) {
        if (respectGroups) {
          await moveTabsWithGroups(singleTabsToMove, miscWindow.id);
        } else {
          const tabIds = singleTabsToMove.map(tab => tab.id);
          await chrome.tabs.move(tabIds, { windowId: miscWindow.id, index: -1 });
        }
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
async function sortWindowTabs(windowId, respectGroups = true) {
  try {
    const tabsWithGroups = respectGroups ? await getTabsWithGroupInfo(windowId) : await chrome.tabs.query({ windowId });
    
    // Separate pinned tabs (never move these)
    const pinnedTabs = tabsWithGroups.filter(tab => tab.pinned);
    const unpinnedTabs = tabsWithGroups.filter(tab => !tab.pinned);
    
    if (!respectGroups) {
      // Simple sort for individual mode
      unpinnedTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });
      
      // Move tabs to sorted positions
      for (let i = 0; i < unpinnedTabs.length; i++) {
        await chrome.tabs.move(unpinnedTabs[i].id, {
          windowId,
          index: pinnedTabs.length + i
        });
      }
      return;
    }
    
    // Group-aware sorting logic
    const ungroupedTabs = [];
    const groupedTabsMap = new Map();
    
    for (const tab of unpinnedTabs) {
      if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        ungroupedTabs.push(tab);
      } else {
        if (!groupedTabsMap.has(tab.groupId)) {
          groupedTabsMap.set(tab.groupId, []);
        }
        groupedTabsMap.get(tab.groupId).push(tab);
      }
    }
    
    // Sort ungrouped tabs by URL
    ungroupedTabs.sort((a, b) => {
      const urlA = a.pendingUrl || a.url;
      const urlB = b.pendingUrl || b.url;
      return urlA.localeCompare(urlB);
    });
    
    // Sort tabs within each group by URL
    for (const [_groupId, groupTabs] of groupedTabsMap.entries()) {
      groupTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });
    }
    
    // Determine the final order: pinned tabs, then ungrouped tabs, then grouped tabs
    let currentIndex = pinnedTabs.length;
    
    // Move ungrouped tabs first
    for (let i = 0; i < ungroupedTabs.length; i++) {
      await chrome.tabs.move(ungroupedTabs[i].id, {
        windowId,
        index: currentIndex + i
      });
    }
    currentIndex += ungroupedTabs.length;
    
    // Move grouped tabs while maintaining group boundaries
    for (const [_groupId, groupTabs] of groupedTabsMap.entries()) {
      for (let i = 0; i < groupTabs.length; i++) {
        await chrome.tabs.move(groupTabs[i].id, {
          windowId,
          index: currentIndex + i
        });
      }
      currentIndex += groupTabs.length;
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

    // Find the target window containing the active tab
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

    const tabsToMove = [];

    // Collect all unpinned tabs from other windows with their group info
    for (const window of windows) {
      if (window.id !== targetWindow.id) {
        const windowTabsWithGroups = await getTabsWithGroupInfo(window.id);
        for (const tab of windowTabsWithGroups) {
          if (!tab.pinned) {
            tabsToMove.push(tab);
          }
        }
      }
    }

    if (tabsToMove.length === 0) {
      console.log('[Tab Organizer] No unpinned tabs to move');
      sendResponse({ success: true });
      return;
    }

    // Move tabs based on mode
    const respectGroups = message.respectGroups !== undefined ? message.respectGroups : true;
    if (respectGroups) {
      await moveTabsWithGroups(tabsToMove, targetWindow.id);
    } else {
      const tabIds = tabsToMove.map(tab => tab.id);
      await chrome.tabs.move(tabIds, { windowId: targetWindow.id, index: -1 });
    }

    console.log('[Tab Organizer] Moved', tabsToMove.length, 'unpinned tabs to single window');

    // Wait a moment for tabs to settle, then sort tabs in the target window
    setTimeout(async () => {
      await sortWindowTabs(targetWindow.id, respectGroups);

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