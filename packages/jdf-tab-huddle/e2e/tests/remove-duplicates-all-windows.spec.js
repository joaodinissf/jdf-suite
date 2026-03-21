import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  createWindow,
  pinTab,
  getWindowTabs,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import {
  waitForTabCount,
  assertTabsSorted,
  assertNoDuplicates,
} from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

// #37 - Each window deduped independently
test('each window is deduped independently', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: A, A, B (plus about:blank)
    await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A, URLS.TEST_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: A, C, C
    const { windowId: w2Id } = await createWindow(sw, [
      URLS.EXAMPLE_A,
      URLS.GITHUB_A,
      URLS.GITHUB_A,
    ]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesAllWindows-${mode}`);
    await sleep(1500);
    await popup.close();

    // W1: A, B (duplicate A removed)
    await waitForTabCount(sw, w1Id, 2);
    await assertNoDuplicates(sw, w1Id);

    // W2: A, C (duplicate C removed)
    await waitForTabCount(sw, w2Id, 2);
    await assertNoDuplicates(sw, w2Id);
  }
});

// #38 - No cross-window dedup
test('no cross-window deduplication occurs', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: A only
    await createTabs(sw, [URLS.EXAMPLE_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: A only (same URL as W1)
    const { windowId: w2Id } = await createWindow(sw, [URLS.EXAMPLE_A]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesAllWindows-${mode}`);
    await sleep(1500);
    await popup.close();

    // Both windows should still have EXAMPLE_A - no cross-window dedup
    await waitForTabCount(sw, w1Id, 1);
    await waitForTabCount(sw, w2Id, 1);

    const w1TabsAfter = await getWindowTabs(sw, w1Id);
    const w2TabsAfter = await getWindowTabs(sw, w2Id);
    expect(w1TabsAfter[0].url).toBe(URLS.EXAMPLE_A);
    expect(w2TabsAfter[0].url).toBe(URLS.EXAMPLE_A);
  }
});

// #39 - Pinned preserved
test('pinned duplicate tabs are preserved', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: pinned A + unpinned A
    const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    await pinTab(sw, tabIds[0]);
    await sleep(200);

    // Need a second window so the removeDuplicatesAllWindows button is visible
    await createWindow(sw, [URLS.TEST_A, URLS.GITHUB_A]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesAllWindows-${mode}`);
    await sleep(1500);
    await popup.close();

    // Pinned tab must not be removed, so both remain
    await waitForTabCount(sw, w1Id, 2);
    const tabs = await getWindowTabs(sw, w1Id);
    const pinned = tabs.filter(t => t.pinned);
    expect(pinned.length).toBe(1);
    expect(pinned[0].url).toBe(URLS.EXAMPLE_A);
  }
});

// #40 - Each window sorted after dedup
test('each window is sorted after dedup', async ({ sw, context, extensionId }) => {
  for (const mode of ['groups', 'individual']) {
    await resetBrowserState(sw, context);

    const w1Id = await getCurrentWindowId(sw);

    // W1: unsorted with duplicates
    await createTabs(sw, [URLS.TEST_A, URLS.EXAMPLE_A, URLS.TEST_A]);
    const w1Tabs = await getWindowTabs(sw, w1Id);
    const blankTab = w1Tabs.find(t => t.url === 'about:blank');
    if (blankTab) {
      await sw.evaluate(async (id) => chrome.tabs.remove(id), blankTab.id);
    }
    await sleep(200);

    // W2: unsorted with duplicates
    const { windowId: w2Id } = await createWindow(sw, [
      URLS.GITHUB_A,
      URLS.EXAMPLE_A,
      URLS.GITHUB_A,
    ]);
    await sleep(200);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') {
      await switchMode(popup, 'individual');
    }
    await clickPopupButton(popup, `removeDuplicatesAllWindows-${mode}`);
    await sleep(1500);
    await popup.close();

    // Both windows should be sorted after dedup
    await waitForTabCount(sw, w1Id, 2);
    await assertTabsSorted(sw, w1Id);

    await waitForTabCount(sw, w2Id, 2);
    await assertTabsSorted(sw, w2Id);
  }
});
