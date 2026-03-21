import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import {
  resetBrowserState,
  createTabs,
  getWindowTabs,
  getAllWindows,
  getCurrentWindowId,
  sleep,
} from '../helpers/tabs.js';
import { openPopup, clickPopupButton } from '../helpers/popup.js';
import { waitForWindowCount } from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('60: Shows correct window count', async ({ sw, context, extensionId }) => {
  // 6 domains with 2+ tabs each = 6 windows total
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

  const [dialogPage] = await Promise.all([
    context.waitForEvent('page'),
    clickPopupButton(popup, 'extractAllDomains-groups'),
  ]);

  await dialogPage.waitForSelector('#windowCount');
  const windowCountText = await dialogPage.textContent('#windowCount');

  // Should say "This will create 6 new browser windows."
  expect(windowCountText).toContain('6');
  expect(windowCountText).toContain('windows');

  // Cancel to clean up
  await dialogPage.click('#cancelButton');
  await popup.close();
});

test('61: Confirm proceeds', async ({ sw, context, extensionId }) => {
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

  const [dialogPage] = await Promise.all([
    context.waitForEvent('page'),
    clickPopupButton(popup, 'extractAllDomains-groups'),
  ]);

  await dialogPage.waitForSelector('#confirmButton');
  await dialogPage.click('#confirmButton');
  await sleep(2000);

  // Extraction should have happened - 6 domain windows
  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  expect(nonPopupWindows.length).toBe(6);

  // Each domain window should have 2 tabs of the same domain
  for (const win of nonPopupWindows) {
    const tabs = win.tabs.filter(t => !t.pinned);
    expect(tabs.length).toBe(2);
    const domains = tabs.map(t => new URL(t.url).hostname);
    expect(new Set(domains).size).toBe(1);
  }

  await popup.close();
});

test('62: Cancel stops', async ({ sw, context, extensionId }) => {
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

  const tabCountBefore = (await getWindowTabs(sw, windowId)).length;

  const popup = await openPopup(context, extensionId);

  const [dialogPage] = await Promise.all([
    context.waitForEvent('page'),
    clickPopupButton(popup, 'extractAllDomains-groups'),
  ]);

  await dialogPage.waitForSelector('#cancelButton');
  await dialogPage.click('#cancelButton');
  await sleep(1000);

  // No extraction should have happened - still 1 main window
  const allWindows = await getAllWindows(sw);
  const nonPopupWindows = allWindows.filter(w =>
    !w.tabs.some(t => t.url.includes('popup.html'))
  );

  expect(nonPopupWindows.length).toBe(1);

  // Tab count should remain the same
  const tabCountAfter = nonPopupWindows[0].tabs.filter(t => !t.pinned).length;
  expect(tabCountAfter).toBe(tabCountBefore);

  await popup.close();
});

test('63: Operation summary correct', async ({ sw, context, extensionId }) => {
  // Setup: 6 domains with 2+ tabs + 2 single-tab domains
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,     // domain 1
    URLS.GITHUB_A, URLS.GITHUB_B,       // domain 2
    URLS.TEST_A, URLS.TEST_B,           // domain 3
    URLS.MOZILLA_A, URLS.MOZILLA_B,     // domain 4
    URLS.WIKI_A, URLS.WIKI_B,           // domain 5
    URLS.SO_A, URLS.SO_B,               // domain 6
  ]);

  // Add single-tab domain pages via data URLs which won't group with others
  // We use unique data URLs so they are their own domains
  const singleTabUrls = [
    'https://single1.example.net/page',
    'https://single2.example.net/page',
  ];
  await createTabs(sw, singleTabUrls);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => {
      await chrome.tabs.remove(tabId);
    }, blankTab.id);
  }
  await sleep(300);

  const popup = await openPopup(context, extensionId);

  const [dialogPage] = await Promise.all([
    context.waitForEvent('page'),
    clickPopupButton(popup, 'extractAllDomains-groups'),
  ]);

  await dialogPage.waitForSelector('#operationList');
  const operationHtml = await dialogPage.innerHTML('#operationList');

  // Should mention the number of domain windows (6 domains with 2+ tabs)
  expect(operationHtml).toContain('6 windows');
  expect(operationHtml).toContain('one for each domain with 2+ tabs');

  // Should mention 1 miscellaneous window for 2 single-tab domains
  expect(operationHtml).toContain('miscellaneous window');
  expect(operationHtml).toContain('2 single-tab domains');

  // The window count should show total: 6 + 1 = 7
  const windowCountText = await dialogPage.textContent('#windowCount');
  expect(windowCountText).toContain('7');

  // Cancel to clean up
  await dialogPage.click('#cancelButton');
  await popup.close();
});
