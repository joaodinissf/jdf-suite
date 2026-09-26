import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  getWindowTabs,
  getCurrentWindowId,
  pinTab,
  createTabGroup,
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

test('2: Compact pairs only within pinned/group runs, skips existing splits, never moves tabs; Expand clears every split', async ({ sw, context, extensionId }) => {
  const [p1, p2, p3, u1, g1, g2, g3, s1, s2, u2] = await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.EXAMPLE_C,
    URLS.TEST_A,
    URLS.GITHUB_A, URLS.GITHUB_B, URLS.MOZILLA_A,
    URLS.WIKI_A, URLS.WIKI_B,
    URLS.SO_A,
  ]);
  await sleep(300);
  const windowId = await getCurrentWindowId(sw);
  for (const id of [p1, p2, p3]) await pinTab(sw, id);
  const groupId = await createTabGroup(sw, [g1, g2, g3], 'grp');
  const existingSplit = await sw.evaluate(ids => chrome.tabs.createSplit(ids), [s1, s2]);

  // Strip: [p1 p2 p3] pinned | reset tab, u1 | [g1 g2 g3] group | s1=s2 split | u2 | popup
  const before = await getWindowTabs(sw, windowId);
  const byId = tabs => Object.fromEntries(tabs.map(t => [t.id, t]));

  const popup = await openPopup(context, extensionId);
  const popupTab = (await getWindowTabs(sw, windowId)).find(t => !before.some(b => b.id === t.id));
  await clickPopupButton(popup, 'compactWindow');
  // Expected new splits: (p1,p2), (reset,u1), (g1,g2), (u2,popup); plus the existing s1=s2.
  const after = await waitForCondition(async () => {
    const tabs = await getWindowTabs(sw, windowId);
    return splitIds(tabs).size === 5 ? tabs : null;
  });
  const t = byId(after);
  const reset = before.find(b => !b.pinned && b.groupId === -1 && b.splitViewId === -1 && ![u1, u2].includes(b.id));

  expect(t[p1].splitViewId).not.toBe(-1);
  expect(t[p1].splitViewId).toBe(t[p2].splitViewId);
  expect(t[p3].splitViewId).toBe(-1); // odd tab at the end of the pinned run
  expect(t[reset.id].splitViewId).not.toBe(-1);
  expect(t[reset.id].splitViewId).toBe(t[u1].splitViewId); // p3 never pairs across the pinned boundary
  expect(t[g1].splitViewId).not.toBe(-1);
  expect(t[g1].splitViewId).toBe(t[g2].splitViewId);
  expect(t[g3].splitViewId).toBe(-1); // odd tab at the end of the group run
  expect(t[s1].splitViewId).toBe(existingSplit); // an existing split is left as it is
  expect(t[s2].splitViewId).toBe(existingSplit);
  expect(t[u2].splitViewId).not.toBe(-1);
  expect(t[u2].splitViewId).toBe(t[popupTab.id].splitViewId);

  // Nothing moved, and pinned state and grouping are unchanged.
  const withoutPopup = after.filter(x => x.id !== popupTab.id);
  expect(withoutPopup.map(x => x.id)).toEqual(before.map(x => x.id));
  expect(withoutPopup.map(x => [x.pinned, x.groupId])).toEqual(before.map(x => [x.pinned, x.groupId]));
  expect([g1, g2, g3].every(id => t[id].groupId === groupId)).toBe(true);

  await clickPopupButton(popup, 'expandWindow');
  await waitForCondition(async () => splitIds(await getWindowTabs(sw, windowId)).size === 0);
  await popup.close();

  // Expand separates every split in the window, including the one Huddle didn't make.
  const expanded = await getWindowTabs(sw, windowId);
  expect(expanded.map(x => x.id)).toEqual(before.map(x => x.id));
  expect(expanded.map(x => [x.pinned, x.groupId])).toEqual(before.map(x => [x.pinned, x.groupId]));
});
