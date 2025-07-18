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
  } else if (message.action === 'extractDomain') {
    handleExtractDomain(message, sendResponse);
    return true; // Keep message channel open for async response
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
      // Separate pinned and unpinned tabs
      const pinnedTabs = window.tabs.filter(tab => tab.pinned);
      const unpinnedTabs = window.tabs.filter(tab => !tab.pinned);
      
      // Sort unpinned tabs by URL
      unpinnedTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });

      // Move unpinned tabs to their sorted positions (starting after pinned tabs)
      for (let i = 0; i < unpinnedTabs.length; i++) {
        await chrome.tabs.move(unpinnedTabs[i].id, {
          windowId: window.id,
          index: pinnedTabs.length + i
        });
      }
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
      await chrome.tabs.move(unpinnedTabs[i].id, { index: pinnedTabs.length + i });
    }
    
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
      const windowTabs = await chrome.tabs.query({ windowId: targetWindow.id });
      
      // Separate pinned and unpinned tabs
      const pinnedTabs = windowTabs.filter(tab => tab.pinned);
      const unpinnedTabs = windowTabs.filter(tab => !tab.pinned);
      
      // Sort unpinned tabs by URL
      unpinnedTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });
      
      // Move unpinned tabs to sorted positions (starting after pinned tabs)
      for (let i = 0; i < unpinnedTabs.length; i++) {
        await chrome.tabs.move(unpinnedTabs[i].id, { 
          windowId: targetWindow.id,
          index: pinnedTabs.length + i 
        });
      }
      
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