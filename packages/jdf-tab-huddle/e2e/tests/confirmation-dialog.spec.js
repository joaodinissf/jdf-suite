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
import { waitForCondition, waitForWindowCount } from '../helpers/assertions.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

// Helper to find the confirmation dialog page among open pages
async function findDialogPage(context, timeout = 10000) {
  return waitForCondition(async () => {
    const pages = context.pages();
    const dialog = pages.find(p => p.url().includes('confirmation-dialog.html'));
    if (dialog) return dialog;
    throw new Error('Dialog page not found');
  }, timeout);
}

test('60: Shows correct window count', async ({ sw, context, extensionId }) => {
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
    await sw.evaluate(async (tabId) => chrome.tabs.remove(tabId), blankTab.id);
  }
  await sleep(300);

  // Invoke handler directly to trigger confirmation dialog
  sw.evaluate(async (respectGroups) => {
    handleExtractAllDomains(respectGroups, () => {});
  }, true);

  const dialogPage = await findDialogPage(context);
  await dialogPage.waitForSelector('#windowCount');
  const windowCountText = await dialogPage.textContent('#windowCount');

  // 6 domains with 2+ tabs = 6 windows
  expect(windowCountText).toContain('6');
  expect(windowCountText).toContain('windows');

  // Cancel to clean up
  await dialogPage.click('#cancelButton');
  await sleep(500);
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
    await sw.evaluate(async (tabId) => chrome.tabs.remove(tabId), blankTab.id);
  }
  await sleep(300);

  // Invoke handler directly
  sw.evaluate(async (respectGroups) => {
    handleExtractAllDomains(respectGroups, () => {});
  }, true);

  const dialogPage = await findDialogPage(context);
  await dialogPage.waitForSelector('#confirmButton');
  await dialogPage.click('#confirmButton');
  await sleep(3000);

  // Extraction should have happened - 6 domain windows
  const allWindows = await getAllWindows(sw);
  // Filter out any window that has the popup or dialog
  const domainWindows = allWindows.filter(w =>
    !w.tabs.some(t =>
      t.url.includes('popup.html') ||
      t.url.includes('confirmation-dialog.html')
    )
  );

  expect(domainWindows.length).toBe(6);

  // Each domain window should have 2 tabs of the same domain
  for (const win of domainWindows) {
    const tabs = win.tabs.filter(t => !t.pinned);
    expect(tabs.length).toBe(2);
  }
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
    await sw.evaluate(async (tabId) => chrome.tabs.remove(tabId), blankTab.id);
  }
  await sleep(300);

  const tabCountBefore = (await getWindowTabs(sw, windowId)).length;

  // Invoke handler directly
  sw.evaluate(async (respectGroups) => {
    handleExtractAllDomains(respectGroups, () => {});
  }, true);

  const dialogPage = await findDialogPage(context);
  await dialogPage.waitForSelector('#cancelButton');
  await dialogPage.click('#cancelButton');
  await sleep(1000);

  // No extraction should have happened - still 1 window with our tabs
  const tabCountAfter = (await getWindowTabs(sw, windowId)).length;
  expect(tabCountAfter).toBe(tabCountBefore);
});

test('63: Operation summary correct', async ({ sw, context, extensionId }) => {
  const windowId = await getCurrentWindowId(sw);
  await createTabs(sw, [
    URLS.EXAMPLE_A, URLS.EXAMPLE_B,     // domain 1: example.com
    URLS.GITHUB_A, URLS.GITHUB_B,       // domain 2: example.net
    URLS.TEST_A, URLS.TEST_B,           // domain 3: example.org
    URLS.MOZILLA_A, URLS.MOZILLA_B,     // domain 4: a.example.com
    URLS.WIKI_A, URLS.WIKI_B,           // domain 5: b.example.com
    URLS.SO_A, URLS.SO_B,               // domain 6: c.example.com
  ]);

  // Add single-tab domains
  await createTabs(sw, [
    'https://single1.example.net/page',
    'https://single2.example.net/page',
  ]);

  const initialTabs = await getWindowTabs(sw, windowId);
  const blankTab = initialTabs.find(t => t.url === 'about:blank');
  if (blankTab) {
    await sw.evaluate(async (tabId) => chrome.tabs.remove(tabId), blankTab.id);
  }
  await sleep(300);

  // Invoke handler directly
  sw.evaluate(async (respectGroups) => {
    handleExtractAllDomains(respectGroups, () => {});
  }, true);

  const dialogPage = await findDialogPage(context);
  await dialogPage.waitForSelector('#operationList');
  const operationHtml = await dialogPage.innerHTML('#operationList');

  // Should mention domain windows and miscellaneous window
  expect(operationHtml).toContain('windows');
  expect(operationHtml).toContain('one for each domain with 2+ tabs');
  expect(operationHtml).toContain('miscellaneous window');
  expect(operationHtml).toContain('single-tab domains');

  // Cancel to clean up
  await dialogPage.click('#cancelButton');
  await sleep(500);
});
