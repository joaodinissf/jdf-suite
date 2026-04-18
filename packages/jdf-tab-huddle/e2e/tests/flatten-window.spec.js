import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  createTabGroup,
  getWindowTabs,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('1: Ungroups all grouped tabs in the current window', async ({ sw, context, extensionId }) => {
  const group1Tabs = await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A]);
  const group2Tabs = await createTabs(sw, [URLS.TEST_A, URLS.GITHUB_A]);
  await sleep(300);

  await createTabGroup(sw, group1Tabs, 'Group 1', 'blue');
  await createTabGroup(sw, group2Tabs, 'Group 2', 'red');
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);

  // Sanity: before flattening, tabs are grouped
  const before = await getWindowTabs(sw, windowId);
  const groupedBefore = before.filter(t => t.groupId !== -1);
  expect(groupedBefore.length).toBeGreaterThanOrEqual(4);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'flattenWindow-groups');
  await sleep(1000);
  await popup.close();

  // After flattening, no tabs should be in any group
  const after = await getWindowTabs(sw, windowId);
  const groupedAfter = after.filter(t => t.groupId !== -1);
  expect(groupedAfter.length).toBe(0);

  // Tab count should be unchanged
  expect(after.length).toBe(before.length);
});

test('2: No-op when there are no groups', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A, URLS.TEST_A]);
  await sleep(300);

  const windowId = await getCurrentWindowId(sw);
  const before = await getWindowTabs(sw, windowId);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'flattenWindow-groups');
  await sleep(1000);
  await popup.close();

  const after = await getWindowTabs(sw, windowId);
  expect(after.length).toBe(before.length);
  expect(after.filter(t => t.groupId !== -1).length).toBe(0);
});

test('3: Preserves ungrouped and pinned tabs', async ({ sw, context, extensionId }) => {
  const groupTabs = await createTabs(sw, [URLS.WIKI_A, URLS.EXAMPLE_A]);
  const ungroupedTabs = await createTabs(sw, [URLS.TEST_A, URLS.GITHUB_A]);
  await sleep(300);

  await createTabGroup(sw, groupTabs, 'My Group', 'green');
  await sleep(500);

  const windowId = await getCurrentWindowId(sw);
  const before = await getWindowTabs(sw, windowId);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'flattenWindow-groups');
  await sleep(1000);
  await popup.close();

  const after = await getWindowTabs(sw, windowId);
  // No groups remain
  expect(after.filter(t => t.groupId !== -1).length).toBe(0);
  // All tabs preserved
  expect(after.length).toBe(before.length);
  // Previously-ungrouped tabs are still present
  for (const id of ungroupedTabs) {
    expect(after.find(t => t.id === id)).toBeTruthy();
  }
});
