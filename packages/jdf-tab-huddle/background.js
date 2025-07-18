// Background service worker for persistent logging
console.log('Tab Organizer service worker starting...');

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Tab Organizer]', message.data.message, ...message.data.args);
    sendResponse({ success: true });
  } else if (message.action === 'extractDomain') {
    handleExtractDomain(message, sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'sortAllWindows') {
    handleSortAllWindows(sendResponse);
    return true; // Keep message channel open for async response
  } else if (message.action === 'moveAllToSingleWindow') {
    handleMoveAllToSingleWindow(sendResponse);
    return true; // Keep message channel open for async response
  }
});

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
      if (tabDomain === targetDomain && tab.id !== message.tabId) {
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
      
      // Sort tabs by URL
      windowTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });
      
      // Move tabs to sorted positions
      for (let i = 0; i < windowTabs.length; i++) {
        await chrome.tabs.move(windowTabs[i].id, { index: i });
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

async function handleSortAllWindows(sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Sorting tabs in', windows.length, 'windows');

    // Sort tabs within each window
    for (const window of windows) {
      // Sort this window's tabs by URL
      const windowTabs = window.tabs.slice(); // Create copy to avoid mutating original
      windowTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });

      // Move tabs to their sorted positions within the window
      for (let i = 0; i < windowTabs.length; i++) {
        await chrome.tabs.move(windowTabs[i].id, {
          windowId: window.id,
          index: i
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

async function handleMoveAllToSingleWindow(sendResponse) {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    console.log('[Tab Organizer] Moving tabs from', windows.length, 'windows to single window');

    if (windows.length <= 1) {
      console.log('[Tab Organizer] Only one window exists, nothing to move');
      sendResponse({ success: true });
      return;
    }

    // Find the current window (focused window) to use as the target
    let targetWindow = windows.find(w => w.focused);
    if (!targetWindow) {
      // If no focused window, use the first window as target
      targetWindow = windows[0];
    }

    const allTabsToMove = [];
    
    // Collect all tabs from other windows
    for (const window of windows) {
      if (window.id !== targetWindow.id) {
        for (const tab of window.tabs) {
          allTabsToMove.push(tab.id);
        }
      }
    }

    if (allTabsToMove.length === 0) {
      console.log('[Tab Organizer] No tabs to move');
      sendResponse({ success: true });
      return;
    }

    // Move all tabs to the target window
    await chrome.tabs.move(allTabsToMove, {
      windowId: targetWindow.id,
      index: -1
    });

    console.log('[Tab Organizer] Moved', allTabsToMove.length, 'tabs to single window');

    // Wait a moment for tabs to settle, then sort all tabs in the target window
    setTimeout(async () => {
      const windowTabs = await chrome.tabs.query({ windowId: targetWindow.id });
      
      // Sort tabs by URL
      windowTabs.sort((a, b) => {
        const urlA = a.pendingUrl || a.url;
        const urlB = b.pendingUrl || b.url;
        return urlA.localeCompare(urlB);
      });
      
      // Move tabs to sorted positions
      for (let i = 0; i < windowTabs.length; i++) {
        await chrome.tabs.move(windowTabs[i].id, { 
          windowId: targetWindow.id,
          index: i 
        });
      }
      
      console.log('[Tab Organizer] Completed moveAllToSingleWindow');
    }, 200);
    
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('[Tab Organizer] Error in moveAllToSingleWindow:', error);
    sendResponse({ success: false, error: error.message });
  }
}