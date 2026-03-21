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
import {
  waitForWindowCount,
  waitForCondition,
  assertTabsSorted,
} from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('47: All tabs consolidated', async ({ sw, context }) => {
  // Setup: 3 windows with various tabs
  const windowId = await getCurrentWindowId(sw);
  const tabIds1 = await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);

  const win2 = await createWindow(sw, [URLS.TEST_A, URLS.MOZILLA_A]);
  const win3 = await createWindow(sw, [URLS.WIKI_A, URLS.SO_A]);

  // Close about:blank in window 1
  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Use first tab in window 1 as active tab
  const activeTabId = tabIds1[0];

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: true });
  await sleep(1500);

  // Should have 1 window with all 6 unpinned tabs
  // (source windows may close if empty)
  const allWindows = await getAllWindows(sw);
  const targetWindow = allWindows.find(w => w.tabs.some(t => t.id === activeTabId));
  expect(targetWindow).toBeTruthy();

  const unpinnedTabs = targetWindow.tabs.filter(t => !t.pinned);
  expect(unpinnedTabs.length).toBe(6);

  // Target window should be sorted
  await assertTabsSorted(sw, targetWindow.id);
});

test('48: Pinned not moved from other windows', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds1 = await createTabs(sw, [URLS.EXAMPLE_A]);

  // Create second window with a pinned tab and an unpinned tab
  const win2 = await createWindow(sw, [URLS.GITHUB_A, URLS.TEST_A]);
  await pinTab(sw, win2.tabIds[0]); // pin github.com/aaa

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const activeTabId = tabIds1[0];

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: true });
  await sleep(1500);

  const allWindows = await getAllWindows(sw);
  const targetWindow = allWindows.find(w => w.tabs.some(t => t.id === activeTabId));
  expect(targetWindow).toBeTruthy();

  // Target window should have the original tab + the unpinned tab from win2
  const unpinnedTarget = targetWindow.tabs.filter(t => !t.pinned);
  expect(unpinnedTarget.length).toBe(2);

  // The pinned tab should remain in its original window (win2)
  const otherWindow = allWindows.find(w =>
    w.id !== targetWindow.id && w.tabs.some(t => t.pinned)
  );
  expect(otherWindow).toBeTruthy();
  const pinnedTabs = otherWindow.tabs.filter(t => t.pinned);
  expect(pinnedTabs.length).toBe(1);
  expect(pinnedTabs[0].url).toBe(URLS.GITHUB_A);
});

test('49: Groups recreated in target window', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds1 = await createTabs(sw, [URLS.EXAMPLE_A]);

  // Create second window with grouped tabs
  const win2 = await createWindow(sw, [URLS.GITHUB_A, URLS.GITHUB_B]);
  await createTabGroup(sw, win2.tabIds, 'GitGroup', 'red');

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const activeTabId = tabIds1[0];

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: true });
  await sleep(1500);

  const allWindows = await getAllWindows(sw);
  const targetWindow = allWindows.find(w => w.tabs.some(t => t.id === activeTabId));
  expect(targetWindow).toBeTruthy();

  // Check that groups are recreated in the target window
  const groups = await getTabGroups(sw, targetWindow.id);
  const gitGroup = groups.find(g => g.title === 'GitGroup');
  expect(gitGroup).toBeTruthy();
});

test('50: Individual mode drops groups', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds1 = await createTabs(sw, [URLS.EXAMPLE_A]);

  // Create second window with grouped tabs
  const win2 = await createWindow(sw, [URLS.GITHUB_A, URLS.GITHUB_B]);
  await createTabGroup(sw, win2.tabIds, 'GitGroup', 'red');

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const activeTabId = tabIds1[0];

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: false });
  await sleep(1500);

  const allWindows = await getAllWindows(sw);
  const targetWindow = allWindows.find(w => w.tabs.some(t => t.id === activeTabId));
  expect(targetWindow).toBeTruthy();

  // All 3 tabs should be in target window
  const unpinnedTabs = targetWindow.tabs.filter(t => !t.pinned);
  expect(unpinnedTabs.length).toBe(3);

  // No groups should exist in the target window
  const groups = await getTabGroups(sw, targetWindow.id);
  const targetGroups = groups.filter(g => g.windowId === targetWindow.id);
  expect(targetGroups.length).toBe(0);
});

test('51: Single window - no-op', async ({ sw, context }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const tabsBefore = await getWindowTabs(sw, windowId);
  const activeTabId = tabIds[0];

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: true });
  await sleep(1000);

  // Still 1 window
  await waitForWindowCount(sw, 1);

  // Same number of tabs
  const tabsAfter = await getWindowTabs(sw, windowId);
  expect(tabsAfter.length).toBe(tabsBefore.length);
});

test('52: Target = window with active tab', async ({ sw, context }) => {
  // Window 1 (initial)
  const windowId1 = await getCurrentWindowId(sw);
  await createTabs(sw, [URLS.EXAMPLE_A]);

  // Window 2
  const win2 = await createWindow(sw, [URLS.GITHUB_A, URLS.GITHUB_B]);

  // Window 3
  const win3 = await createWindow(sw, [URLS.TEST_A]);

  const initialTabs = await getWindowTabs(sw, windowId1);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Use a tab from window 2 as the active tab
  const activeTabId = win2.tabIds[0];

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: true });
  await sleep(1500);

  const allWindows = await getAllWindows(sw);
  const targetWindow = allWindows.find(w => w.tabs.some(t => t.id === activeTabId));
  expect(targetWindow).toBeTruthy();

  // The target window should be window 2 (the one containing the active tab)
  expect(targetWindow.id).toBe(win2.windowId);

  // All unpinned tabs should now be in window 2
  const unpinnedTabs = targetWindow.tabs.filter(t => !t.pinned);
  // Window 1 had 1 tab (EXAMPLE_A), Window 2 had 2, Window 3 had 1 = 4 total
  expect(unpinnedTabs.length).toBe(4);
});

test('53: Source windows close after move', async ({ sw, context }) => {
  const windowId1 = await getCurrentWindowId(sw);
  await createTabs(sw, [URLS.EXAMPLE_A]);

  // Create windows with only unpinned tabs (they should close after move)
  const win2 = await createWindow(sw, [URLS.GITHUB_A]);
  const win3 = await createWindow(sw, [URLS.TEST_A]);

  const initialTabs = await getWindowTabs(sw, windowId1);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  await waitForWindowCount(sw, 3);

  const activeTabId = (await getWindowTabs(sw, windowId1))[0].id;

  await sw.evaluate(async (params) => {
    await new Promise((resolve) => {
      handleMoveAllToSingleWindow(params, resolve);
    });
  }, { activeTabId, respectGroups: true });
  await sleep(1500);

  // Source windows with no remaining tabs should be closed by Chrome
  // Only the target window should remain
  await waitForWindowCount(sw, 1);

  const allWindows = await getAllWindows(sw);
  expect(allWindows.length).toBe(1);
  expect(allWindows[0].id).toBe(windowId1);
});
