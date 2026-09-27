import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  createWindow,
  getWindowTabs,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { waitForCondition } from '../helpers/assertions.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

// Chrome dissolves a Split View whenever one of its tabs is moved, so Huddle
// records the pairs before operations that move tabs and splits them again
// afterwards (#46). Needs the Split View write API (Chrome 155+); these tests
// skip below that, like split-view-compact.
test.beforeEach(async ({ sw, context }) => {
  const supported = await sw.evaluate(() =>
    typeof chrome.tabs.createSplit === 'function' && typeof chrome.tabs.unsplit === 'function');
  test.skip(!supported, 'chrome.tabs.createSplit/unsplit unavailable (needs Chrome 155+)');
  await resetBrowserState(sw, context);
});

const createSplit = (sw, ids) => sw.evaluate(pair => chrome.tabs.createSplit(pair), ids);

// Both tabs are in one split (any split id), in strip order left → right.
async function waitForSplitPair(sw, windowId, [leftId, rightId], timeout = 10000) {
  return waitForCondition(async () => {
    const tabs = await getWindowTabs(sw, windowId);
    const left = tabs.find(t => t.id === leftId);
    const right = tabs.find(t => t.id === rightId);
    if (!left || !right) throw new Error('pair not in window yet');
    if (left.splitViewId === -1 || left.splitViewId !== right.splitViewId) throw new Error('not split');
    if (right.index !== left.index + 1) throw new Error('not adjacent');
    return tabs;
  }, timeout);
}

for (const mode of ['groups', 'individual']) {
  test(`1: Sort keeps a Split View split (${mode} mode)`, async ({ sw, context, extensionId }) => {
    // Strip: c.example.com/bbb | c.example.com/aaa | a.example.com/aaa = b.example.com/bbb (split).
    // The pair sorts as one unit keyed by its left URL (a.example.com), so the
    // pair's own tabs move from the end to the front. Moving a split tab
    // dissolves the split; moving only the tabs around it would not.
    const [cb, ca, left, right] = await createTabs(sw, [URLS.SO_B, URLS.SO_A, URLS.MOZILLA_A, URLS.WIKI_B]);
    await sleep(300);
    const windowId = await getCurrentWindowId(sw);
    await createSplit(sw, [left, right]);

    const popup = await openPopup(context, extensionId);
    if (mode === 'individual') await switchMode(popup, 'individual');
    await clickPopupButton(popup, 'sortCurrentWindow');
    // Wait for the sort to land (the pair first, then c.example.com/aaa, /bbb), then for the pair.
    await waitForCondition(async () => {
      const order = (await getWindowTabs(sw, windowId)).map(t => t.id).filter(id => [left, right, cb, ca].includes(id));
      return JSON.stringify(order) === JSON.stringify([left, right, ca, cb]);
    }, 10000);
    await waitForSplitPair(sw, windowId, [left, right]);
    await popup.close();
  });
}

test('2: Merge windows keeps a split from the other window', async ({ sw, context, extensionId }) => {
  const mainWindowId = await getCurrentWindowId(sw);
  const { tabIds: [, left, right] } = await createWindow(sw, [URLS.TEST_A, URLS.WIKI_A, URLS.WIKI_B]);
  await sleep(300);
  await createSplit(sw, [left, right]);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'moveAllToSingleWindow');
  await waitForSplitPair(sw, mainWindowId, [left, right]);
  await popup.close();
});

// Extract domain uses the active tab; the e2e popup is itself a tab, so (as in
// extract-domain.spec) the handler is invoked directly with the tab to extract.
const extractDomain = (sw, tabId, url) => sw.evaluate(params => new Promise(resolve => {
  handleExtractDomain(params, resolve);
}), { tabId, url, respectGroups: true });

const tabWindow = (sw, id) => sw.evaluate(i => chrome.tabs.get(i).then(t => t.windowId), id);

test('3: Extract domain re-splits a pair that moved together', async ({ sw }) => {
  // Both halves are on example.com, so they move into the new window together.
  const mainWindowId = await getCurrentWindowId(sw);
  const [anchor, left, right] = await createTabs(sw, [URLS.EXAMPLE_C, URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await sleep(300);
  await createSplit(sw, [left, right]);

  await extractDomain(sw, anchor, URLS.EXAMPLE_C);
  const newWindowId = await waitForCondition(async () => {
    const id = await tabWindow(sw, anchor);
    return id !== mainWindowId ? id : null;
  }, 10000);
  await waitForSplitPair(sw, newWindowId, [left, right]);
});

test('4: A split whose halves are separated stays unsplit (no forced pairing)', async ({ sw }) => {
  // Only the left half is on example.com, so Extract domain takes it away from
  // its partner: Huddle must not move tabs to recreate the pair.
  const [left, right] = await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
  await sleep(300);
  await createSplit(sw, [left, right]);

  await extractDomain(sw, left, URLS.EXAMPLE_A);
  await waitForCondition(async () => (await tabWindow(sw, left)) !== (await tabWindow(sw, right)), 10000);
  // This checks that nothing re-pairs later, so a fixed settle is correct here.
  await sleep(1000);
  const tabs = await Promise.all([left, right].map(id => sw.evaluate(i => chrome.tabs.get(i), id)));
  expect(tabs.map(t => t.splitViewId ?? -1)).toEqual([-1, -1]);
});
