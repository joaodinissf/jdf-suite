import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  getWindowTabs,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { waitForCondition } from '../helpers/assertions.js';
import { openPopup, clickPopupButton } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

// Compact/Expand need the Split View write API (Chrome 155+). On older
// builds, including Playwright's bundled Chromium until it reaches 155, the
// buttons stay hidden and these tests skip; run them with PW_EXECUTABLE
// pointing at a Chrome for Testing 155+ build.
test.beforeEach(async ({ sw, context }) => {
  const supported = await sw.evaluate(() =>
    typeof chrome.tabs.createSplit === 'function' && typeof chrome.tabs.unsplit === 'function');
  test.skip(!supported, 'chrome.tabs.createSplit/unsplit unavailable (needs Chrome 155+)');
  await resetBrowserState(sw, context);
});

const splitIds = tabs => new Set(tabs.map(t => t.splitViewId).filter(id => id !== -1));

test('1: Compact pairs neighbours and leaves the odd tab; Expand separates them', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.EXAMPLE_C, URLS.TEST_A, URLS.TEST_B]);
  await sleep(300);
  const windowId = await getCurrentWindowId(sw);

  // The popup opens as the window's last tab: with the tab left by the reset
  // that makes seven, so three pairs form and the popup is the odd one out.
  let popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'compactWindow');
  const compacted = await waitForCondition(async () => {
    const tabs = await getWindowTabs(sw, windowId);
    return splitIds(tabs).size === 3 ? tabs : null;
  });
  await popup.close();
  expect(compacted.filter(t => t.splitViewId === -1).map(t => t.index)).toEqual([6]);
  expect(compacted[0].splitViewId).toBe(compacted[1].splitViewId);
  expect(compacted[4].splitViewId).toBe(compacted[5].splitViewId);

  popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'expandWindow');
  await waitForCondition(async () => splitIds(await getWindowTabs(sw, windowId)).size === 0);
  await popup.close();

  const expanded = await getWindowTabs(sw, windowId);
  expect(expanded.map(t => t.id)).toEqual(compacted.slice(0, 6).map(t => t.id));
});
