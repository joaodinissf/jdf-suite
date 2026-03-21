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
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import {
  waitForWindowCount,
  waitForCondition,
  assertTabsSorted,
} from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('20: One window per domain (>=2 tabs)', async ({ sw, context, extensionId }) => {
  // Setup: 3 domains, 2+ tabs each
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,
    URLS.GITHUB_A, URLS.GITHUB_B,
    URLS.TEST_A, URLS.TEST_B,
  ]);

  // Close the about:blank tab
  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'extractAllDomains-groups');
  await sleep(2000);

  // 3 domains -> 3 windows (no confirmation since <=5)
  const allWindows = await getAllWindows(sw);
  // Filter out the popup window (which has the popup.html page)
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  expect(nonPopupWindows.length).toBe(3);

  // Each window should have 2 tabs of the same domain
  for (const win of nonPopupWindows) {
    const tabs = win.tabs.filter(t => !t.pinned);
    expect(tabs.length).toBe(2);
    // All tabs in each window should share the same domain
    const domains = tabs.map(t => new URL(t.url).hostname);
    expect(new Set(domains).size).toBe(1);
  }

  await popup.close();
});

test('21: Single-tab domains in misc window', async ({ sw, context, extensionId }) => {
  // 2 multi-tab domains + 3 single-tab domains
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,   // 2 example.com
    URLS.GITHUB_A, URLS.GITHUB_B,     // 2 github.com
    URLS.TEST_A,                        // 1 test.org
    URLS.MOZILLA_A,                     // 1 mozilla.org
    URLS.WIKI_A,                        // 1 wikipedia.org
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'extractAllDomains-groups');
  await sleep(2000);

  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  // 2 domain windows + 1 misc window = 3 windows
  expect(nonPopupWindows.length).toBe(3);

  // Find the misc window (has tabs from different domains)
  const miscWindow = nonPopupWindows.find(w => {
    const tabs = w.tabs.filter(t => !t.pinned);
    const domains = new Set(tabs.map(t => new URL(t.url).hostname));
    return domains.size > 1;
  });
  expect(miscWindow).toBeTruthy();

  // Misc window should have 3 tabs (one from each single-tab domain)
  const miscTabs = miscWindow.tabs.filter(t => !t.pinned);
  expect(miscTabs.length).toBe(3);

  await popup.close();
});

test('22: Confirmation >5 windows - confirm', async ({ sw, context, extensionId }) => {
  // Need 6+ extractable domains (each with 2+ tabs) to trigger confirmation
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,
    URLS.GITHUB_A, URLS.GITHUB_B,
    URLS.TEST_A, URLS.TEST_B,
    URLS.MOZILLA_A, URLS.MOZILLA_B,
    URLS.WIKI_A, URLS.WIKI_B,
    URLS.SO_A, URLS.SO_B,
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);

  // Trigger extraction and wait for confirmation dialog
  const [dialogPage] = await Promise.all([
    context.waitForEvent('page'),
    clickPopupButton(popup, 'extractAllDomains-groups'),
  ]);

  await dialogPage.waitForSelector('#confirmButton');
  await dialogPage.click('#confirmButton');
  await sleep(2000);

  // After confirmation, 6 domain windows should be created
  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  expect(nonPopupWindows.length).toBe(6);

  await popup.close();
});

test('23: Confirmation >5 windows - cancel', async ({ sw, context, extensionId }) => {
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,
    URLS.GITHUB_A, URLS.GITHUB_B,
    URLS.TEST_A, URLS.TEST_B,
    URLS.MOZILLA_A, URLS.MOZILLA_B,
    URLS.WIKI_A, URLS.WIKI_B,
    URLS.SO_A, URLS.SO_B,
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  // Count tabs before to compare after cancel
  const tabsBefore = await getWindowTabs(sw, windowId);
  const tabCountBefore = tabsBefore.length;

  const popup = await openPopup(context, extensionId);

  const [dialogPage] = await Promise.all([
    context.waitForEvent('page'),
    clickPopupButton(popup, 'extractAllDomains-groups'),
  ]);

  await dialogPage.waitForSelector('#cancelButton');
  await dialogPage.click('#cancelButton');
  await sleep(1000);

  // After cancel, should still have roughly the same window structure
  // The dialog tab gets closed by the extension, but no extraction happens
  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  // Should still be 1 main window (no extraction happened)
  expect(nonPopupWindows.length).toBe(1);

  await popup.close();
});

test('24: No confirmation when <=5 windows', async ({ sw, context, extensionId }) => {
  // 3 domains with 2+ tabs = 3 windows, no confirmation needed
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,
    URLS.GITHUB_A, URLS.GITHUB_B,
    URLS.TEST_A, URLS.TEST_B,
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);

  // Track if a new page (confirmation dialog) opens
  let dialogOpened = false;
  context.on('page', () => { dialogOpened = true; });

  await clickPopupButton(popup, 'extractAllDomains-groups');
  await sleep(2000);

  // No confirmation dialog should have appeared
  expect(dialogOpened).toBe(false);

  // Extraction should have happened directly
  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );
  expect(nonPopupWindows.length).toBe(3);

  await popup.close();
});

test('25: Pinned excluded from extraction', async ({ sw, context, extensionId }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,
    URLS.GITHUB_A, URLS.GITHUB_B,
  ]);

  // Pin one tab from each domain
  await pinTab(sw, tabIds[0]); // pin example.com/aaa
  await pinTab(sw, tabIds[2]); // pin github.com/aaa

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'extractAllDomains-groups');
  await sleep(2000);

  // With 1 unpinned tab per domain, they all become single-tab domains
  // so we should get 1 misc window + the original with pinned tabs
  const allWindows = await getAllWindows(sw);

  // Find the window with pinned tabs
  const windowWithPinned = allWindows.find(w =>
    w.tabs.some(t => t.pinned) && !w.tabs.some(t => t.url.includes('popup.html'))
  );
  expect(windowWithPinned).toBeTruthy();

  const pinnedTabs = windowWithPinned.tabs.filter(t => t.pinned);
  expect(pinnedTabs.length).toBe(2);

  await popup.close();
});

test('26: All tabs same domain', async ({ sw, context, extensionId }) => {
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A,
    URLS.EXAMPLE_B,
    URLS.EXAMPLE_C,
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'extractAllDomains-groups');
  await sleep(2000);

  // All example.com => 1 domain window
  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  expect(nonPopupWindows.length).toBe(1);

  const tabs = nonPopupWindows[0].tabs.filter(t => !t.pinned);
  expect(tabs.length).toBe(3);
  for (const tab of tabs) {
    expect(tab.url).toContain('example.com');
  }

  await popup.close();
});

test('27: Groups preserved across domain windows', async ({ sw, context, extensionId }) => {
  const windowId = await getCurrentWindowId(sw);
  const tabIds = await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,
    URLS.GITHUB_A, URLS.GITHUB_B,
  ]);

  // Create a group for the example.com tabs
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Examples', 'green');
  // Create a group for the github.com tabs
  await createTabGroup(sw, [tabIds[2], tabIds[3]], 'GitHub', 'red');

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'extractAllDomains-groups');
  await sleep(2000);

  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  // Check that groups are preserved in the domain windows
  const exampleWindow = nonPopupWindows.find(w =>
    w.tabs.some(t => t.url.includes('example.com'))
  );
  expect(exampleWindow).toBeTruthy();
  const exampleGroups = await getTabGroups(sw, exampleWindow.id);
  expect(exampleGroups.some(g => g.title === 'Examples')).toBe(true);

  const githubWindow = nonPopupWindows.find(w =>
    w.tabs.some(t => t.url.includes('github.com'))
  );
  expect(githubWindow).toBeTruthy();
  const githubGroups = await getTabGroups(sw, githubWindow.id);
  expect(githubGroups.some(g => g.title === 'GitHub')).toBe(true);

  await popup.close();
});
