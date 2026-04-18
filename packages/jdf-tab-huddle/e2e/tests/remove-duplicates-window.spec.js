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
  waitForTabCount,
  assertTabsSorted,
  assertTabUrls,
  assertPinnedTabUrls,
  assertNoDuplicates,
} from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

/**
 * Helper: runs a dedup-window test in both groups and individual modes.
 */
async function runInBothModes(sw, context, extensionId, setupFn, assertFn) {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);
    await setupFn(mode);
    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();
    await assertFn(mode);
  }
}

// #28 - Removes duplicates, keeps first
test('removes duplicates in current window, keeps first occurrence', async ({
  sw,
  context,
  extensionId,
}) => {
  const windowId = await getCurrentWindowId(sw);

  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    // Create tabs: A, A, B (plus about:blank from reset)
    const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A, URLS.TEST_A]);
    // Close the initial about:blank tab
    const tabsBefore = await getWindowTabs(sw, await getCurrentWindowId(sw));
    const blankTab = tabsBefore.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    const wid = await getCurrentWindowId(sw);
    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();

    // Should have 2 tabs: A and B, sorted
    await waitForTabCount(sw, wid, 2);
    await assertNoDuplicates(sw, wid);
    await assertTabsSorted(sw, wid);
  }
});

// #29 - No duplicates, no removal
test('no duplicates present - all tabs remain', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A, URLS.GITHUB_A]);
    const wid = await getCurrentWindowId(sw);
    const tabsBefore = await getWindowTabs(sw, wid);
    const blankTab = tabsBefore.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();

    // All 3 unique tabs remain
    await waitForTabCount(sw, wid, 3);
    await assertNoDuplicates(sw, wid);
  }
});

// #30 - All identical tabs
test('all identical tabs reduced to one', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A, URLS.EXAMPLE_A]);
    const wid = await getCurrentWindowId(sw);
    const tabsBefore = await getWindowTabs(sw, wid);
    const blankTab = tabsBefore.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();

    await waitForTabCount(sw, wid, 1);
    const tabs = await getWindowTabs(sw, wid);
    expect(tabs[0].url).toBe(URLS.EXAMPLE_A);
  }
});

// #31 - Pinned duplicates not removed
test('pinned duplicates are not removed', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A]);
    const wid = await getCurrentWindowId(sw);
    const tabsBefore = await getWindowTabs(sw, wid);
    const blankTab = tabsBefore.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // Pin the first duplicate
    await pinTab(sw, tabIds[0]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();

    // Both should remain: one pinned + one unpinned
    await waitForTabCount(sw, wid, 2);
    await assertPinnedTabUrls(sw, wid, [URLS.EXAMPLE_A]);
  }
});

// #32 - Same URL in different groups kept (groups mode)
test('same URL in different groups is kept in groups mode', async ({
  sw,
  context,
  extensionId,
}) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A]);
  const wid = await getCurrentWindowId(sw);
  const tabsBefore = await getWindowTabs(sw, wid);
  const blankTab = tabsBefore.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
  }
  await sleep(200);

  // Put each tab in a different group
  await createTabGroup(sw, [tabIds[0]], 'Group1', 'blue');
  await createTabGroup(sw, [tabIds[1]], 'Group2', 'red');
  await sleep(200);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'removeDuplicatesWindow-groups');
  await sleep(1000);
  await popup.close();

  // In groups mode with single-window dedup (tabArrays.length === 1),
  // findDuplicateTabs uses a shared urlSeen map across groups,
  // so same URL in different groups IS still deduped.
  await waitForTabCount(sw, wid, 1);
  const tabs = await getWindowTabs(sw, wid);
  expect(tabs.length).toBe(1);
  expect(tabs[0].url).toBe(URLS.EXAMPLE_A);
});

// #33 - Same URL in same group removed (groups mode)
test('same URL in same group is removed in groups mode', async ({
  sw,
  context,
  extensionId,
}) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A, URLS.TEST_A]);
  const wid = await getCurrentWindowId(sw);
  const tabsBefore = await getWindowTabs(sw, wid);
  const blankTab = tabsBefore.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
  }
  await sleep(200);

  // Put both EXAMPLE_A tabs in the same group
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Group1', 'blue');
  await sleep(200);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'removeDuplicatesWindow-groups');
  await sleep(1000);
  await popup.close();

  // One duplicate removed, so 2 tabs remain: 1 EXAMPLE_A in group + 1 TEST_A ungrouped
  await waitForTabCount(sw, wid, 2);
  await assertNoDuplicates(sw, wid);
});

// #34 - Individual mode: cross-group dupes removed
test('individual mode removes cross-group duplicates', async ({
  sw,
  context,
  extensionId,
}) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A]);
  const wid = await getCurrentWindowId(sw);
  const tabsBefore = await getWindowTabs(sw, wid);
  const blankTab = tabsBefore.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
  }
  await sleep(200);

  // Put each tab in a different group
  await createTabGroup(sw, [tabIds[0]], 'Group1', 'blue');
  await createTabGroup(sw, [tabIds[1]], 'Group2', 'red');
  await sleep(200);

  const popup = await openPopup(context, extensionId);
  await switchMode(popup, 'individual');
  await clickPopupButton(popup, 'removeDuplicatesWindow-individual');
  await sleep(1000);
  await popup.close();

  // Individual mode treats all tabs as one pool, so duplicate removed
  await waitForTabCount(sw, wid, 1);
  const tabs = await getWindowTabs(sw, wid);
  expect(tabs[0].url).toBe(URLS.EXAMPLE_A);
});

// #35 - Uses pendingUrl for comparison
test('uses pendingUrl for duplicate comparison', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const wid = await getCurrentWindowId(sw);

    // Create one tab that has fully loaded
    const tabIds = await createTabs(sw, [URLS.EXAMPLE_A]);

    // Create a tab that might still be loading (pendingUrl)
    // We create it with the same URL - Chrome will set pendingUrl while loading
    const [pendingTabId] = await createTabs(sw, [URLS.EXAMPLE_A]);
    await sleep(200);

    const tabsBefore = await getWindowTabs(sw, wid);
    const blankTab = tabsBefore.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();

    // Duplicate should be detected even if one tab uses pendingUrl
    await waitForTabCount(sw, wid, 1);
    const tabs = await getWindowTabs(sw, wid);
    expect(tabs[0].url).toBe(URLS.EXAMPLE_A);
  }
});

// #36 - Tabs sorted after dedup
test('tabs are sorted after dedup', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    // Create tabs in non-sorted order with a duplicate
    await createTabs(sw, [URLS.TEST_A, URLS.EXAMPLE_A, URLS.TEST_A, URLS.GITHUB_A]);
    const wid = await getCurrentWindowId(sw);
    const tabsBefore = await getWindowTabs(sw, wid);
    const blankTab = tabsBefore.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesWindow-${mode}`);
    await sleep(1000);
    await popup.close();

    // After dedup, duplicate TEST_A removed, remaining 3 tabs sorted
    await waitForTabCount(sw, wid, 3);
    await assertNoDuplicates(sw, wid);
    await assertTabsSorted(sw, wid);
  }
});
