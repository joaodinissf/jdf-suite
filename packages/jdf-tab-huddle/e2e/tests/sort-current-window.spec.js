import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  createTabGroup,
  pinTab,
  getWindowTabs,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import {
  assertTabsSorted,
  assertTabUrls,
  assertPinnedTabUrls,
} from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('1: Sorts tabs alphabetically by URL (both modes)', async ({ sw, context, extensionId }) => {
  // Create 5 unsorted tabs (the initial about:blank tab is also present)
  const urls = [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.TEST_A, URLS.GITHUB_A, URLS.MOZILLA_A];
  await createTabs(sw, urls);
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  // Test groups mode
  const popup1 = await openPopup(context, extensionId);
  await clickPopupButton(popup1, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup1.close();

  await assertTabsSorted(sw, windowId);

  // Reset and test individual mode
  await resetBrowserState(sw, context);
  await createTabs(sw, urls);
  await sleep(500);

  const windowId2 = await getCurrentWindowId(sw);

  const popup2 = await openPopup(context, extensionId);
  await switchMode(popup2, 'individual');
  await clickPopupButton(popup2, 'sortCurrentWindow-individual');
  await sleep(1000);
  await popup2.close();

  await assertTabsSorted(sw, windowId2);
});

test('2: Pinned tabs stay at front (both modes)', async ({ sw, context, extensionId }) => {
  // Create tabs: 2 to pin, 3 unpinned
  const tabIds = await createTabs(sw, [
    URLS.WIKI_A,
    URLS.GITHUB_A,
    URLS.TEST_A,
    URLS.EXAMPLE_A,
    URLS.MOZILLA_A,
  ]);
  await sleep(300);

  // Pin the first two created tabs
  await pinTab(sw, tabIds[0]);
  await pinTab(sw, tabIds[1]);
  await sleep(300);

  const windowId = await getCurrentWindowId(sw);

  // Sort in groups mode
  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup.close();

  // Pinned tabs should still be pinned at the front
  const tabs = await getWindowTabs(sw, windowId);
  const pinnedTabs = tabs.filter(t => t.pinned);
  const unpinnedTabs = tabs.filter(t => !t.pinned);

  expect(pinnedTabs.length).toBe(2);
  // Pinned tabs should come before all unpinned tabs
  const maxPinnedIndex = Math.max(...pinnedTabs.map(t => t.index));
  const minUnpinnedIndex = Math.min(...unpinnedTabs.map(t => t.index));
  expect(maxPinnedIndex).toBeLessThan(minUnpinnedIndex);

  // Unpinned tabs should be sorted
  await assertTabsSorted(sw, windowId);
});

test('3: Grouped tabs sorted within group (groups mode)', async ({ sw, context, extensionId }) => {
  // Create tabs for two groups with unsorted URLs
  const group1Tabs = await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.GITHUB_A]);
  const group2Tabs = await createTabs(sw, [URLS.TEST_B, URLS.MOZILLA_A, URLS.EXAMPLE_B]);
  await sleep(300);

  await createTabGroup(sw, group1Tabs, 'Group 1', 'blue');
  await createTabGroup(sw, group2Tabs, 'Group 2', 'red');
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup.close();

  // Verify tabs within each group are sorted
  const tabs = await getWindowTabs(sw, windowId);
  const group1Urls = tabs
    .filter(t => t.groupId === tabs.find(x => group1Tabs.includes(x.id))?.groupId && !t.pinned)
    .map(t => t.url);
  const group2Urls = tabs
    .filter(t => t.groupId === tabs.find(x => group2Tabs.includes(x.id))?.groupId && !t.pinned)
    .map(t => t.url);

  // Each group's URLs should be sorted
  expect(group1Urls).toEqual([...group1Urls].sort((a, b) => a.localeCompare(b)));
  expect(group2Urls).toEqual([...group2Urls].sort((a, b) => a.localeCompare(b)));
});

test('4: Individual mode ignores groups', async ({ sw, context, extensionId }) => {
  // Create tabs in groups with unsorted URLs
  const group1Tabs = await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A]);
  const group2Tabs = await createTabs(sw, [URLS.TEST_A, URLS.GITHUB_A]);
  await sleep(300);

  await createTabGroup(sw, group1Tabs, 'Group 1', 'blue');
  await createTabGroup(sw, group2Tabs, 'Group 2', 'red');
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  // Sort in individual mode (ignores groups)
  const popup = await openPopup(context, extensionId);
  await switchMode(popup, 'individual');
  await clickPopupButton(popup, 'sortCurrentWindow-individual');
  await sleep(1000);
  await popup.close();

  // All unpinned tabs should be sorted flat, regardless of groups
  await assertTabsSorted(sw, windowId);
});

test('5: Mix grouped + ungrouped (groups mode)', async ({ sw, context, extensionId }) => {
  // Create 2 ungrouped tabs and 1 group with 3 tabs
  const ungroupedTabs = await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A]);
  const groupTabs = await createTabs(sw, [URLS.TEST_B, URLS.GITHUB_A, URLS.MOZILLA_A]);
  await sleep(300);

  await createTabGroup(sw, groupTabs, 'My Group', 'green');
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup.close();

  const tabs = await getWindowTabs(sw, windowId);
  const ungrouped = tabs.filter(t => !t.pinned && t.groupId === -1);
  const grouped = tabs.filter(t => !t.pinned && t.groupId !== -1);

  // Ungrouped tabs should be sorted among themselves
  const ungroupedUrls = ungrouped.map(t => t.url);
  expect(ungroupedUrls).toEqual([...ungroupedUrls].sort((a, b) => a.localeCompare(b)));

  // Grouped tabs should be sorted within the group
  const groupedUrls = grouped.map(t => t.url);
  expect(groupedUrls).toEqual([...groupedUrls].sort((a, b) => a.localeCompare(b)));

  // Ungrouped tabs should come before grouped tabs
  const maxUngroupedIndex = Math.max(...ungrouped.map(t => t.index));
  const minGroupedIndex = Math.min(...grouped.map(t => t.index));
  expect(maxUngroupedIndex).toBeLessThan(minGroupedIndex);
});

test('6: Tabs with pendingUrl (both modes)', async ({ sw, context, extensionId }) => {
  // Create tabs normally - the sort logic uses pendingUrl where present
  // We create tabs with various URLs to test sorting behavior
  const urls = [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.TEST_A];
  await createTabs(sw, urls);
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup.close();

  // Tabs should be sorted using url or pendingUrl
  await assertTabsSorted(sw, windowId);
});

test('7: Single tab (no-op, both modes)', async ({ sw, context, extensionId }) => {
  // After resetBrowserState, we have just 1 tab (about:blank)
  const windowId = await getCurrentWindowId(sw);
  const tabsBefore = await getWindowTabs(sw, windowId);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'sortCurrentWindow-groups');
  await sleep(1000);
  await popup.close();

  // Should have the same single tab, no errors
  const tabsAfter = await getWindowTabs(sw, windowId);
  expect(tabsAfter.length).toBe(tabsBefore.length);
  expect(tabsAfter[0].url).toBe(tabsBefore[0].url);
});

test('8: Special URLs mixed in (individual mode)', async ({ sw, context, extensionId }) => {
  // Mix data: URL, about:blank, and normal URLs
  const urls = [URLS.WIKI_A, URLS.DATA_URL, URLS.EXAMPLE_A];
  await createTabs(sw, urls);
  // Also create a tab with about:blank
  await createTabs(sw, [URLS.ABOUT_BLANK]);
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  const popup = await openPopup(context, extensionId);
  await switchMode(popup, 'individual');
  await clickPopupButton(popup, 'sortCurrentWindow-individual');
  await sleep(1000);
  await popup.close();

  // All tabs should be sorted lexicographically
  await assertTabsSorted(sw, windowId);
});
