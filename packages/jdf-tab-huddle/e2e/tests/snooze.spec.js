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
  getSnoozedItems,
  activateTab,
  highlightTabs,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, openSnoozePicker, clickPopupButton } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

// --- local helpers -------------------------------------------------------

// Snooze the active tab of the current window by invoking the background
// handler directly (deterministic — avoids popup focus races).
async function snoozeActiveTabViaSw(sw, tabId, preset = 'tomorrow') {
  await activateTab(sw, tabId);
  return await sw.evaluate(
    ({ wakeAt, preset }) =>
      new Promise((resolve) => {
        handleSnoozeTab({ wakeAt, preset }, (r) => resolve(r && r.record));
      }),
    { wakeAt: Date.now() + 3600000, preset }
  );
}

async function getAllAlarms(sw) {
  return await sw.evaluate(async () => await chrome.alarms.getAll());
}

async function findTabByUrl(sw, url) {
  return await sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => (t.url || t.pendingUrl) === u);
    return match ? { id: match.id, active: match.active, pinned: match.pinned, windowId: match.windowId } : null;
  }, url);
}

// -------------------------------------------------------------------------

test('1: Snooze current tab via preset closes it and records the snooze', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await sleep(300);
  const windowId = await getCurrentWindowId(sw);
  const before = await getWindowTabs(sw, windowId);
  const target = before.find((t) => t.url === URLS.EXAMPLE_A);
  expect(target).toBeTruthy();

  const popup = await openPopup(context, extensionId);
  await sleep(400); // allow presets to load

  await activateTab(sw, target.id);
  await openSnoozePicker(popup, 'tab');
  await activateTab(sw, target.id);
  await clickPopupButton(popup, 'snoozePreset-tomorrow');
  await sleep(800);

  // The tab was closed.
  const after = await getWindowTabs(sw, windowId);
  expect(after.find((t) => t.url === URLS.EXAMPLE_A)).toBeFalsy();

  // Exactly one record with preset "tomorrow".
  const items = await getSnoozedItems(sw);
  expect(items.length).toBe(1);
  expect(items[0].preset).toBe('tomorrow');

  // An alarm was created for it.
  const alarms = await getAllAlarms(sw);
  expect(alarms.some((a) => a.name === 'snooze:' + items[0].id)).toBe(true);

  // The popup shows the sleeping section with one row.
  await expect(popup.locator('#sleepingSection')).toBeVisible();
  expect(await popup.locator('.snoozed-item').count()).toBe(1);

  await popup.close();
});

test('2: Wake now reopens the tab in the background and clears the record', async ({ sw, context, extensionId }) => {
  const [tabId] = await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await sleep(300);
  const record = await snoozeActiveTabViaSw(sw, tabId);
  await sleep(500);
  expect(record).toBeTruthy();

  const popup = await openPopup(context, extensionId);
  await popup.waitForSelector(`.snoozed-item[data-id="${record.id}"]`);
  await popup.click(`.snoozed-item[data-id="${record.id}"] .snoozed-wake`);
  await sleep(800);

  // The tab reopened with the original URL, not focused.
  const restored = await findTabByUrl(sw, URLS.EXAMPLE_A);
  expect(restored).toBeTruthy();
  expect(restored.active).toBe(false);

  // Storage is empty and the section is hidden.
  expect((await getSnoozedItems(sw)).length).toBe(0);
  await expect(popup.locator('#sleepingSection')).toBeHidden();

  await popup.close();
});

test('3: Cancel removes the record and clears the alarm without reopening', async ({ sw, context, extensionId }) => {
  const [tabId] = await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await sleep(300);
  const record = await snoozeActiveTabViaSw(sw, tabId);
  await sleep(500);

  const popup = await openPopup(context, extensionId);
  await popup.waitForSelector(`.snoozed-item[data-id="${record.id}"]`);
  await popup.click(`.snoozed-item[data-id="${record.id}"] .snoozed-cancel`);
  await sleep(600);

  // Storage empty.
  expect((await getSnoozedItems(sw)).length).toBe(0);

  // Alarm cleared.
  const alarms = await getAllAlarms(sw);
  expect(alarms.some((a) => a.name === 'snooze:' + record.id)).toBe(false);

  // The tab was NOT reopened.
  expect(await findTabByUrl(sw, URLS.EXAMPLE_A)).toBeNull();

  await popup.close();
});

test('4: Snooze selected tabs stores one record with all entries in index order', async ({ sw }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A, URLS.TEST_A]);
  await sleep(400);
  const windowId = await getCurrentWindowId(sw);
  const tabs = await getWindowTabs(sw, windowId);
  const targets = tabs.filter((t) => [URLS.EXAMPLE_A, URLS.GITHUB_A, URLS.TEST_A].includes(t.url));
  expect(targets.length).toBe(3);

  await sw.evaluate(async (wid) => {
    await chrome.windows.update(wid, { focused: true });
  }, windowId);
  await highlightTabs(sw, windowId, targets.map((t) => t.index));
  await sleep(200);

  const record = await sw.evaluate(
    (wakeAt) =>
      new Promise((resolve) => {
        handleSnoozeSelected({ wakeAt, preset: 'laterToday' }, (r) => resolve(r && r.record));
      }),
    Date.now() + 3600000
  );
  await sleep(600);

  expect(record.type).toBe('tabs');
  expect(record.tabs.length).toBe(3);
  const indices = record.tabs.map((t) => t.index);
  expect(indices).toEqual([...indices].sort((a, b) => a - b));

  // All three URLs are closed.
  const after = await getWindowTabs(sw, windowId);
  for (const url of [URLS.EXAMPLE_A, URLS.GITHUB_A, URLS.TEST_A]) {
    expect(after.find((t) => t.url === url)).toBeFalsy();
  }
});

test('5: Snooze group and wake recreates the group with title, color and members', async ({ sw }) => {
  const groupTabs = await createTabs(sw, [URLS.MOZILLA_A, URLS.MOZILLA_B]);
  await sleep(300);
  await createTabGroup(sw, groupTabs, 'Research', 'blue');
  await sleep(400);

  await activateTab(sw, groupTabs[0]);
  const record = await sw.evaluate(
    (wakeAt) =>
      new Promise((resolve) => {
        handleSnoozeGroup({ wakeAt, preset: 'nextWeek' }, (r) => resolve(r && r.record));
      }),
    Date.now() + 3600000
  );
  await sleep(500);
  expect(record.type).toBe('group');
  expect(record.group.title).toBe('Research');
  expect(record.group.color).toBe('blue');

  // Simulate the alarm firing.
  await sw.evaluate(async (id) => {
    await wakeSnoozedRecord(id, { notify: true });
  }, record.id);
  await sleep(800);

  // A group named "Research" with color blue was recreated.
  const groups = await getTabGroups(sw);
  const research = groups.find((g) => g.title === 'Research');
  expect(research).toBeTruthy();
  expect(research.color).toBe('blue');

  // Its member URLs are back.
  const groupWindow = await getWindowTabs(sw, research.windowId);
  const groupUrls = groupWindow.filter((t) => t.groupId === research.id).map((t) => t.url);
  expect(groupUrls.sort()).toEqual([URLS.MOZILLA_A, URLS.MOZILLA_B].sort());
});

test('6: Group button is disabled when the active tab is not in a group', async ({ sw, context, extensionId }) => {
  const [tabId] = await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);
  await activateTab(sw, tabId);

  const popup = await openPopup(context, extensionId);
  await sleep(400);
  await expect(popup.locator('#snoozeGroup')).toBeDisabled();

  await popup.close();
});

test('7: Snooze window and wake recreates a background window with pinned tab preserved', async ({ sw }) => {
  const winA = await createWindow(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A, URLS.TEST_A]);
  await sleep(400);
  await pinTab(sw, winA.tabIds[0]); // pin EXAMPLE_A
  await sleep(300);

  await sw.evaluate(async (wid) => {
    await chrome.windows.update(wid, { focused: true });
  }, winA.windowId);

  const record = await sw.evaluate(
    (wakeAt) =>
      new Promise((resolve) => {
        handleSnoozeWindow({ wakeAt, preset: 'tomorrow' }, (r) => resolve(r && r.record));
      }),
    Date.now() + 3600000
  );
  await sleep(700);
  expect(record.type).toBe('window');

  // The original window is gone.
  let windows = await getAllWindows(sw);
  expect(windows.some((w) => w.id === winA.windowId)).toBe(false);

  // Fire the alarm.
  await sw.evaluate(async (id) => {
    await wakeSnoozedRecord(id, { notify: true });
  }, record.id);
  await sleep(900);

  windows = await getAllWindows(sw);
  const restored = windows.find((w) => w.tabs.some((t) => t.url === URLS.EXAMPLE_A));
  expect(restored).toBeTruthy();

  // All URLs present in stored order.
  const urls = restored.tabs.sort((a, b) => a.index - b.index).map((t) => t.url);
  expect(urls).toEqual([URLS.EXAMPLE_A, URLS.GITHUB_A, URLS.TEST_A]);

  // The originally-pinned tab is pinned again.
  const pinned = restored.tabs.find((t) => t.url === URLS.EXAMPLE_A);
  expect(pinned.pinned).toBe(true);
});

test('8: Custom time in the past is rejected in the popup', async ({ sw, context, extensionId }) => {
  const [tabId] = await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);
  const windowId = await getCurrentWindowId(sw);

  const popup = await openPopup(context, extensionId);
  await sleep(400);
  // Snapshot the window's tabs only after the popup is open: openPopup()
  // loads popup.html as a real page/tab (there's no way to drive the actual
  // browser-action popup surface in this harness), so it counts as one of the
  // window's tabs. Taking the "before" baseline here — rather than prior to
  // opening the popup — keeps it on equal footing with the "after" snapshot,
  // so the comparison isolates whether the snooze action itself added a tab.
  const before = await getWindowTabs(sw, windowId);
  await activateTab(sw, tabId);
  await openSnoozePicker(popup, 'tab');

  await popup.fill('#snoozeCustomTime', '2020-01-01T00:00');
  await popup.click('#snoozeCustomConfirm');
  await sleep(400);

  // Error feedback is shown.
  await expect(popup.locator('#snoozeFeedback')).toHaveClass(/visible/);
  await expect(popup.locator('#snoozeFeedback')).toHaveText('Pick a time in the future');

  // Nothing was snoozed and no tab closed.
  expect((await getSnoozedItems(sw)).length).toBe(0);
  const after = await getWindowTabs(sw, windowId);
  expect(after.find((t) => t.url === URLS.EXAMPLE_A)).toBeTruthy();
  expect(after.length).toBe(before.length);

  await popup.close();
});

test('9: Alarm-driven wake reopens without stealing focus from the active tab', async ({ sw }) => {
  const [tabId] = await createTabs(sw, [URLS.EXAMPLE_A, URLS.GITHUB_A]);
  await sleep(300);
  const record = await snoozeActiveTabViaSw(sw, tabId);
  await sleep(500);

  // Some other tab is now active.
  const activeBefore = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ? tabs[0].id : null;
  });

  // Fire the alarm through the real listener entry point.
  await sw.evaluate((id) => {
    handleSnoozeAlarm({ name: 'snooze:' + id });
  }, record.id);
  await sleep(900);

  // The tab reopened but is not active.
  const restored = await findTabByUrl(sw, URLS.EXAMPLE_A);
  expect(restored).toBeTruthy();
  expect(restored.active).toBe(false);

  // Focus was not stolen.
  const activeAfter = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ? tabs[0].id : null;
  });
  expect(activeAfter).toBe(activeBefore);
});

test('10: Snoozing the only tab in the last window keeps a newtab open', async ({ sw }) => {
  const [tabId] = await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);
  const windowId = await getCurrentWindowId(sw);

  // Remove the leftover about:blank so EXAMPLE_A is the only tab.
  const tabs = await getWindowTabs(sw, windowId);
  const blank = tabs.find((t) => t.url === 'about:blank');
  if (blank) {
    await sw.evaluate(async (id) => {
      await chrome.tabs.remove(id);
    }, blank.id);
  }
  await sleep(300);

  const record = await snoozeActiveTabViaSw(sw, tabId);
  await sleep(700);

  // A window with a fresh (newtab) page remains — Chrome did not exit.
  const windows = await getAllWindows(sw);
  expect(windows.length).toBe(1);
  expect(windows[0].tabs.length).toBe(1);
  expect(windows[0].tabs[0].url).not.toBe(URLS.EXAMPLE_A);

  // The record exists.
  const items = await getSnoozedItems(sw);
  expect(items.length).toBe(1);
  expect(items[0].id).toBe(record.id);
});

test('11: A special (chrome://) URL cannot be snoozed and surfaces an error', async ({ sw, context, extensionId }) => {
  const specialId = await sw.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'chrome://version/', active: true });
    return tab.id;
  });
  await sleep(500);

  const popup = await openPopup(context, extensionId);
  await sleep(400);
  await activateTab(sw, specialId);
  await openSnoozePicker(popup, 'tab');
  await activateTab(sw, specialId);
  await clickPopupButton(popup, 'snoozePreset-tomorrow');
  await sleep(600);

  // Error feedback is shown and nothing was snoozed.
  await expect(popup.locator('#snoozeFeedback')).toHaveClass(/visible/);
  await expect(popup.locator('#snoozeFeedback')).toHaveText("This page can't be snoozed");
  expect((await getSnoozedItems(sw)).length).toBe(0);

  // The special tab is still open.
  const still = await sw.evaluate(async (id) => {
    try {
      const tab = await chrome.tabs.get(id);
      return !!tab;
    } catch (_e) {
      return false;
    }
  }, specialId);
  expect(still).toBe(true);

  await popup.close();
});
