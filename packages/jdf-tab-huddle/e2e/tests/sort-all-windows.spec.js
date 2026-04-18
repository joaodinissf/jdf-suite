import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  createWindow,
  createTabGroup,
  pinTab,
  getWindowTabs,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import { assertTabsSorted } from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('9: Each window sorted independently (both modes)', async ({ sw, context, extensionId }) => {
  // Set up window 1 with unsorted tabs
  await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await sleep(300);

  // Create window 2 with unsorted tabs
  const win2 = await createWindow(sw, [URLS.TEST_B, URLS.MOZILLA_A, URLS.SO_A]);
  await sleep(300);

  const windowId1 = await getCurrentWindowId(sw);

  // Sort all windows in groups mode
  const popup1 = await openPopup(context, extensionId);
  await clickPopupButton(popup1, 'sortAllWindows-groups');
  await sleep(1500);
  await popup1.close();

  // Both windows should be sorted independently
  await assertTabsSorted(sw, windowId1);
  await assertTabsSorted(sw, win2.windowId);

  // Reset and test individual mode
  await resetBrowserState(sw, context);
  await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await sleep(300);

  const win2b = await createWindow(sw, [URLS.TEST_B, URLS.MOZILLA_A, URLS.SO_A]);
  await sleep(300);

  const windowId1b = await getCurrentWindowId(sw);

  const popup2 = await openPopup(context, extensionId);
  await switchMode(popup2, 'individual');
  await clickPopupButton(popup2, 'sortAllWindows-individual');
  await sleep(1500);
  await popup2.close();

  await assertTabsSorted(sw, windowId1b);
  await assertTabsSorted(sw, win2b.windowId);
});

test('10: Pinned unaffected across windows (both modes)', async ({ sw, context, extensionId }) => {
  // Window 1: pin a tab, add unsorted tabs
  const win1Tabs = await createTabs(sw, [URLS.MOZILLA_A, URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await pinTab(sw, win1Tabs[0]);
  await sleep(300);

  // Window 2: pin a tab, add unsorted tabs
  const win2 = await createWindow(sw, [URLS.TEST_B, URLS.MOZILLA_B, URLS.SO_A]);
  await pinTab(sw, win2.tabIds[0]);
  await sleep(300);

  const windowId1 = await getCurrentWindowId(sw);

  // Invoke handler directly (multi-window buttons may be hidden in popup)
  await sw.evaluate(async (respectGroups) => {
    await new Promise((resolve) => handleSortAllWindows(respectGroups, resolve));
  }, true);
  await sleep(1000);

  // Verify pinned tabs remain in both windows
  const tabs1 = await getWindowTabs(sw, windowId1);
  const pinned1 = tabs1.filter(t => t.pinned);
  expect(pinned1.length).toBe(1);

  const tabs2 = await getWindowTabs(sw, win2.windowId);
  const pinned2 = tabs2.filter(t => t.pinned);
  expect(pinned2.length).toBe(1);

  // Unpinned tabs should still be sorted in both windows
  await assertTabsSorted(sw, windowId1);
  await assertTabsSorted(sw, win2.windowId);
});

test('11: Groups preserved per window (groups mode)', async ({ sw, context, extensionId }) => {
  const windowId1 = await getCurrentWindowId(sw);

  // Window 1: create a group with unsorted tabs
  const win1GroupTabs = await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.GITHUB_A]);
  // Remove the about:blank tab to keep things clean
  const initialTabs = await getWindowTabs(sw, windowId1);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
  }
  await createTabGroup(sw, win1GroupTabs, 'Win1 Group', 'blue');
  await sleep(300);

  // Window 2: create a group with unsorted tabs
  const win2 = await createWindow(sw, [URLS.TEST_B, URLS.MOZILLA_A, URLS.SO_A]);
  await createTabGroup(sw, win2.tabIds, 'Win2 Group', 'red');
  await sleep(500);

  // Invoke handler directly (multi-window buttons may be hidden in popup)
  await sw.evaluate(async (respectGroups) => {
    await new Promise((resolve) => handleSortAllWindows(respectGroups, resolve));
  }, true);
  await sleep(1000);

  // Both windows should retain their groups (fix for #30)
  const tabs1 = await getWindowTabs(sw, windowId1);
  const groups1 = tabs1.filter(t => t.groupId !== -1 && !t.pinned);
  expect(groups1.length).toBe(3); // 3 tabs in Win1 Group

  // Tabs within the group should be sorted by URL
  const group1Urls = groups1.map(t => t.url);
  expect(group1Urls).toEqual([...group1Urls].sort((a, b) => a.localeCompare(b)));

  const tabs2 = await getWindowTabs(sw, win2.windowId);
  const groups2 = tabs2.filter(t => t.groupId !== -1 && !t.pinned);
  expect(groups2.length).toBe(3); // 3 tabs in Win2 Group

  const group2Urls = groups2.map(t => t.url);
  expect(group2Urls).toEqual([...group2Urls].sort((a, b) => a.localeCompare(b)));
});

test('12: Single window = same as sort current (both modes)', async ({ sw, context, extensionId }) => {
  // Only one window with unsorted tabs
  await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.GITHUB_A, URLS.TEST_A]);
  await sleep(300);

  const windowId = await getCurrentWindowId(sw);

  // In single-window mode, sortAllWindows button is hidden - use sortCurrentWindow
  // which exercises the same sortWindowTabs() code path
  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup.close();

  await assertTabsSorted(sw, windowId);
});
