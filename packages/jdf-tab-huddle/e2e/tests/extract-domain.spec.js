import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  createWindow,
  createTabGroup,
  pinTab,
  getWindowTabs,
  getAllWindows,
  getTabGroups,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup } from '../helpers/popup.js';
import { waitForWindowCount, assertTabsSorted } from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('13: Extracts matching domain tabs to new window', async ({ sw, context }) => {
  // Setup: active on example.com + 3 more example.com + 2 other domain
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.EXAMPLE_B,
    URLS.EXAMPLE_C,
    URLS.GITHUB_A,
    URLS.GITHUB_B,
  ]);

  // Close the initial about:blank tab
  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Use EXAMPLE_A as the active tab for extraction
  const targetTabId = tabIds[0];
  const targetUrl = URLS.EXAMPLE_A;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: true });
  await sleep(1000);

  // Expect 2 windows: original (github tabs) and new (example.com tabs)
  await waitForWindowCount(sw, 2);

  const allWindows = await getAllWindows(sw);
  // Find the window with the target tab
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // New window should have all 3 example.com tabs (A, B, C) - the active one was already there
  const newWindowTabs = newWindow.tabs.filter(t => !t.pinned);
  expect(newWindowTabs.length).toBe(3);

  // All tabs in new window should be example.com
  for (const tab of newWindowTabs) {
    expect(tab.url).toContain('example.com');
  }

  // New window should be sorted
  await assertTabsSorted(sw, newWindow.id);
});

test('14: Pinned tabs not extracted', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.EXAMPLE_B,
    URLS.EXAMPLE_C,
  ]);

  // Wait for tabs to finish loading
  await sleep(500);

  // Pin the first example.com tab
  await pinTab(sw, tabIds[0]);

  // Close the initial about:blank tab
  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Extract using EXAMPLE_B as active tab
  const targetTabId = tabIds[1];
  const targetUrl = URLS.EXAMPLE_B;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: true });

  await waitForWindowCount(sw, 2);
  // Wait for the internal setTimeout(200) sort to complete
  await sleep(2000);

  // Re-query windows to get updated tab positions
  const allWindows = await getAllWindows(sw);
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // New window should only have the 2 unpinned example.com tabs (B, C)
  const newWindowTabs = newWindow.tabs.filter(t => !t.pinned);
  expect(newWindowTabs.length).toBe(2);

  // The pinned tab should remain in the original window
  const originalWindow = allWindows.find(w => w.id !== newWindow.id);
  const pinnedTabs = originalWindow.tabs.filter(t => t.pinned);
  expect(pinnedTabs.length).toBe(1);
  expect(pinnedTabs[0].url).toBe(URLS.EXAMPLE_A);
});

test('15: No other tabs on same domain', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.GITHUB_A,
    URLS.TEST_A,
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Extract example.com - only one tab on that domain
  const targetTabId = tabIds[0];
  const targetUrl = URLS.EXAMPLE_A;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: true });
  await sleep(1000);

  await waitForWindowCount(sw, 2);

  const allWindows = await getAllWindows(sw);
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // New window should have just the one active tab
  const newWindowTabs = newWindow.tabs.filter(t => !t.pinned);
  expect(newWindowTabs.length).toBe(1);
  expect(newWindowTabs[0].url).toBe(URLS.EXAMPLE_A);
});

test('16: Extracts from multiple source windows', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds1 = await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.GITHUB_A,
  ]);

  // Create second window with example.com tabs
  const win2 = await createWindow(sw, [URLS.EXAMPLE_B, URLS.EXAMPLE_C]);

  // Close the about:blank tab from the first window
  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Extract using EXAMPLE_A as active tab (in window 1)
  const targetTabId = tabIds1[0];
  const targetUrl = URLS.EXAMPLE_A;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: true });
  await sleep(1000);

  const allWindows = await getAllWindows(sw);
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // New window should have all 3 example.com tabs from both windows
  const exampleTabs = newWindow.tabs.filter(t => t.url.includes('example.com'));
  expect(exampleTabs.length).toBe(3);

  await assertTabsSorted(sw, newWindow.id);
});

test('17: Groups preserved during extraction', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.EXAMPLE_B,
    URLS.EXAMPLE_C,
    URLS.GITHUB_A,
  ]);

  // Group the last two example.com tabs
  await createTabGroup(sw, [tabIds[1], tabIds[2]], 'ExGroup', 'blue');

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Extract domain in groups mode
  const targetTabId = tabIds[0];
  const targetUrl = URLS.EXAMPLE_A;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: true });
  await sleep(1500);

  const allWindows = await getAllWindows(sw);
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // Check that groups exist in the new window
  const groups = await getTabGroups(sw, newWindow.id);
  const exGroup = groups.find(g => g.title === 'ExGroup');
  expect(exGroup).toBeTruthy();
});

test('18: Individual mode drops groups', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.EXAMPLE_B,
    URLS.EXAMPLE_C,
    URLS.GITHUB_A,
  ]);

  // Wait for tabs to finish loading
  await sleep(500);

  // Group example.com tabs
  await createTabGroup(sw, [tabIds[1], tabIds[2]], 'ExGroup', 'blue');

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Extract domain in individual mode (respectGroups: false)
  const targetTabId = tabIds[0];
  const targetUrl = URLS.EXAMPLE_A;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: false });

  await waitForWindowCount(sw, 2);
  await sleep(1500);

  const allWindows = await getAllWindows(sw);
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // All 3 example.com tabs should be in the new window
  const exampleTabs = newWindow.tabs.filter(t => t.url.includes('example.com'));
  expect(exampleTabs.length).toBe(3);

  // No groups should exist in the new window
  const groups = await getTabGroups(sw, newWindow.id);
  const newWindowGroups = groups.filter(g => g.windowId === newWindow.id);
  expect(newWindowGroups.length).toBe(0);
});

test('19: Extension URL domain extraction', async ({ sw, context, extensionId }) => {
  // Open multiple popup pages (chrome-extension:// URLs with the same extension ID)
  const extUrl1 = `chrome-extension://${extensionId}/popup.html?a=1`;
  const extUrl2 = `chrome-extension://${extensionId}/popup.html?a=2`;

  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    extUrl1,
    extUrl2,
    URLS.GITHUB_A,
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Extract using the first extension URL as active
  const targetTabId = tabIds[0];
  const targetUrl = extUrl1;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleExtractDomain(params, resolve);
    });
  }, { tabId: targetTabId, url: targetUrl, respectGroups: true });
  await sleep(1000);

  await waitForWindowCount(sw, 2);

  const allWindows = await getAllWindows(sw);
  const newWindow = allWindows.find(w => w.tabs.some(t => t.id === targetTabId));
  expect(newWindow).toBeTruthy();

  // Both extension URL tabs should be in the new window
  const extTabs = newWindow.tabs.filter(t => t.url.includes(`chrome-extension://${extensionId}`));
  expect(extTabs.length).toBe(2);
});
