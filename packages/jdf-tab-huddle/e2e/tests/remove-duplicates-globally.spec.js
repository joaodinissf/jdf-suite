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
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import {
  waitForTabCount,
  waitForWindowCount,
  assertTabsSorted,
  assertNoDuplicates,
  getTotalTabCount,
} from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

// #41 - Cross-window duplicates removed
test('cross-window duplicates are removed globally', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: A, B
    await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: A, C (A is duplicate of W1)
    const { windowId: w2Id } = await createWindow(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesGlobally-${mode}`);
    await sleep(1500);
    await popup.close();

    // Global dedup: only one EXAMPLE_A should remain across all windows
    const allWindows = await getAllWindows(sw);
    const allUrls = allWindows.flatMap(w => w.tabs.filter(t => !t.pinned).map(t => t.url));
    const exampleACount = allUrls.filter(u => u === URLS.EXAMPLE_A).length;
    expect(exampleACount).toBe(1);
  }
});

// #42 - First occurrence kept
test('first occurrence is kept during global dedup', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: B, A
    await createTabs(sw, [URLS.TEST_A, URLS.EXAMPLE_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: A, C (A is a duplicate)
    const { windowId: w2Id } = await createWindow(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesGlobally-${mode}`);
    await sleep(1500);
    await popup.close();

    // W1 should keep A (first occurrence), W2's A should be removed
    const w1TabsAfter = await getWindowTabs(sw, w1Id);
    const w1Urls = w1TabsAfter.filter(t => !t.pinned).map(t => t.url);
    expect(w1Urls).toContain(URLS.EXAMPLE_A);

    const w2TabsAfter = await getWindowTabs(sw, w2Id);
    const w2Urls = w2TabsAfter.filter(t => !t.pinned).map(t => t.url);
    expect(w2Urls).not.toContain(URLS.EXAMPLE_A);
  }
});

// #43 - Pinned duplicates preserved
test('pinned duplicate tabs are preserved in global dedup', async ({
  sw,
  context,
  extensionId,
}) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: pinned A
    const [pinnedTabId] = await createTabs(sw, [URLS.EXAMPLE_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await pinTab(sw, pinnedTabId);
    await sleep(200);

    // W2: unpinned A
    const { windowId: w2Id } = await createWindow(sw, [URLS.EXAMPLE_A]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesGlobally-${mode}`);
    await sleep(1500);
    await popup.close();

    // Pinned tab in W1 must remain
    const w1TabsAfter = await getWindowTabs(sw, w1Id);
    const pinnedTabs = w1TabsAfter.filter(t => t.pinned);
    expect(pinnedTabs.length).toBe(1);
    expect(pinnedTabs[0].url).toBe(URLS.EXAMPLE_A);
  }
});

// #44 - Group-aware global dedup (groups mode)
test('group-aware global dedup deduplicates within same group across windows', async ({
  sw,
  context,
  extensionId,
}) => {
  const w1Id = await getCurrentWindowId(sw);

  // W1: A in group "News"
  const [tabId1] = await createTabs(sw, [URLS.EXAMPLE_A]);
  const w1Tabs = await getWindowTabs(sw, w1Id);
  const blankTab = w1Tabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
  }
  await createTabGroup(sw, [tabId1], 'News', 'blue');
  await sleep(200);

  // W2: A in group "News" (same group title, same URL => should be deduped)
  const { windowId: w2Id, tabIds: w2TabIds } = await createWindow(sw, [URLS.EXAMPLE_A]);
  await createTabGroup(sw, [w2TabIds[0]], 'News', 'blue');
  await sleep(200);

  // Invoke handler directly (multi-window buttons may be hidden in popup)
  await sw.evaluate(async (respectGroups) => {
    await new Promise((resolve) => handleRemoveDuplicatesGlobally(respectGroups, resolve));
  }, true);
  await sleep(1500);

  // Global dedup with single array: seenMap is shared urlSeen, so same URL
  // across different groups (even different windows) IS deduped.
  const allWindows = await getAllWindows(sw);
  const allUrls = allWindows.flatMap(w => w.tabs.filter(t => !t.pinned).map(t => t.url));
  const exampleACount = allUrls.filter(u => u === URLS.EXAMPLE_A).length;
  expect(exampleACount).toBe(1);
});

// #45 - Windows sorted after dedup
test('all windows are sorted after global dedup', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: unsorted tabs with duplicate
    await createTabs(sw, [URLS.TEST_A, URLS.EXAMPLE_A, URLS.TEST_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: unsorted tabs
    const { windowId: w2Id } = await createWindow(sw, [URLS.GITHUB_A, URLS.EXAMPLE_B]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesGlobally-${mode}`);
    await sleep(1500);
    await popup.close();

    // Both windows should be sorted
    await assertTabsSorted(sw, w1Id);
    await assertTabsSorted(sw, w2Id);
  }
});

// #46 - Window left empty after dedup
test('window left empty after global dedup gets new tab page', async ({
  sw,
  context,
  extensionId,
}) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: A, B
    await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: only A (duplicate of W1's A) - W2 should end up empty after dedup
    const { windowId: w2Id } = await createWindow(sw, [URLS.EXAMPLE_A]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesGlobally-${mode}`);
    await sleep(1500);
    await popup.close();

    // W1 should keep A and B
    const w1TabsAfter = await getWindowTabs(sw, w1Id);
    const w1Urls = w1TabsAfter.filter(t => !t.pinned).map(t => t.url);
    expect(w1Urls).toContain(URLS.EXAMPLE_A);
    expect(w1Urls).toContain(URLS.TEST_A);

    // W2: all tabs were duplicates, so Chrome should auto-create a new tab page
    // or the window may have been closed. Check either scenario.
    const allWindows = await getAllWindows(sw);
    const w2 = allWindows.find(w => w.id === w2Id);
    if (w2) {
      // If window still exists, it should have a new tab page (chrome://newtab or about:blank)
      expect(w2.tabs.length).toBeGreaterThanOrEqual(1);
      const w2Urls = w2.tabs.map(t => t.url);
      const hasNewTabPage = w2Urls.some(
        u => u === 'chrome://newtab/' || u === 'about:blank' || u === 'chrome://new-tab-page/'
      );
      expect(hasNewTabPage).toBe(true);
    }
    // If window was closed by Chrome (no tabs left), that's also acceptable
  }
});
