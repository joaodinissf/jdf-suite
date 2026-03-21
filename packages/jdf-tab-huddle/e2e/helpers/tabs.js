/**
 * Helper functions for creating and querying tabs/windows via the service worker.
 */

/**
 * Reset browser to a clean state: close all windows except one, close extra tabs.
 */
export async function resetBrowserState(sw, context) {
  await sw.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    // Keep the first window, close the rest
    for (let i = 1; i < windows.length; i++) {
      await chrome.windows.remove(windows[i].id);
    }
    // In the remaining window, close all tabs except one, then navigate it to about:blank
    const tabs = await chrome.tabs.query({ windowId: windows[0].id });
    if (tabs.length > 1) {
      const tabIdsToClose = tabs.slice(1).map(t => t.id);
      await chrome.tabs.remove(tabIdsToClose);
    }
    await chrome.tabs.update(tabs[0].id, { url: 'about:blank' });
  });
  // Small delay for state to settle
  await sleep(200);
}

/**
 * Create tabs in the current window with given URLs. Returns tab IDs.
 */
export async function createTabs(sw, urls) {
  return await sw.evaluate(async (urls) => {
    const ids = [];
    for (const url of urls) {
      const tab = await chrome.tabs.create({ url, active: false });
      ids.push(tab.id);
    }
    return ids;
  }, urls);
}

/**
 * Create a new window with the given URLs. Returns { windowId, tabIds }.
 */
export async function createWindow(sw, urls) {
  return await sw.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls[0], focused: false });
    const tabIds = [win.tabs[0].id];
    for (let i = 1; i < urls.length; i++) {
      const tab = await chrome.tabs.create({ url: urls[i], windowId: win.id, active: false });
      tabIds.push(tab.id);
    }
    return { windowId: win.id, tabIds };
  }, urls);
}

/**
 * Create a tab group from the given tab IDs. Returns group ID.
 */
export async function createTabGroup(sw, tabIds, title, color = 'blue') {
  return await sw.evaluate(async ({ tabIds, title, color }) => {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title, color });
    return groupId;
  }, { tabIds, title, color });
}

/**
 * Pin a tab by ID.
 */
export async function pinTab(sw, tabId) {
  await sw.evaluate(async (tabId) => {
    await chrome.tabs.update(tabId, { pinned: true });
  }, tabId);
}

/**
 * Get all tabs in a specific window, sorted by index.
 */
export async function getWindowTabs(sw, windowId) {
  return await sw.evaluate(async (windowId) => {
    const tabs = await chrome.tabs.query({ windowId });
    tabs.sort((a, b) => a.index - b.index);
    return tabs.map(t => ({
      id: t.id,
      url: t.url || t.pendingUrl || '',
      index: t.index,
      pinned: t.pinned,
      groupId: t.groupId,
      windowId: t.windowId,
    }));
  }, windowId);
}

/**
 * Get all windows with their tabs.
 */
export async function getAllWindows(sw) {
  return await sw.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    return windows.map(w => ({
      id: w.id,
      focused: w.focused,
      tabs: w.tabs.sort((a, b) => a.index - b.index).map(t => ({
        id: t.id,
        url: t.url || t.pendingUrl || '',
        index: t.index,
        pinned: t.pinned,
        groupId: t.groupId,
        windowId: t.windowId,
      })),
    }));
  });
}

/**
 * Get tab group info for a window.
 */
export async function getTabGroups(sw, windowId) {
  return await sw.evaluate(async (windowId) => {
    const groups = await chrome.tabGroups.query(windowId ? { windowId } : {});
    return groups.map(g => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
      windowId: g.windowId,
    }));
  }, windowId);
}

/**
 * Get the current window ID.
 */
export async function getCurrentWindowId(sw) {
  return await sw.evaluate(async () => {
    const win = await chrome.windows.getCurrent();
    return win.id;
  });
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
