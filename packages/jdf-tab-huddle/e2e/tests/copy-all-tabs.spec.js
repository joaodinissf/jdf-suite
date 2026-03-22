import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createTabs, createTabGroup, sleep } from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('60: Copy all tabs (ungrouped) returns flat URL list', async ({ sw }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
  await sleep(300);

  // Query formatted text directly via the service worker
  const text = await sw.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.onMessage.addListener(function handler(message, _sender, sendResponse) {
        if (message.action === 'copyAllTabs') {
          chrome.runtime.onMessage.removeListener(handler);
          // Let the real handler process it; we intercept the response
          return false;
        }
      });

      chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups: true }, (response) => {
        resolve(response.text);
      });
    });
  });

  // Should contain both URLs
  expect(text).toContain(URLS.EXAMPLE_A);
  expect(text).toContain(URLS.TEST_A);
  // No group headers since there are no groups
  expect(text).not.toContain('Ungrouped');
});

test('61: Copy grouped tabs (groups mode) has group headers', async ({ sw }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const text = await sw.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups: true }, (response) => {
        resolve(response.text);
      });
    });
  });

  // Should have group header
  expect(text).toContain('Work');
  expect(text).toContain(URLS.EXAMPLE_A);
  expect(text).toContain(URLS.EXAMPLE_B);
  // Ungrouped tabs should be under "Ungrouped"
  expect(text).toContain('Ungrouped');
  expect(text).toContain(URLS.TEST_A);

  // Groups should be separated by blank lines
  const sections = text.split('\n\n');
  expect(sections.length).toBeGreaterThanOrEqual(2);
});

test('62: Copy tabs (individual mode) returns flat list without headers', async ({ sw }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const text = await sw.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups: false }, (response) => {
        resolve(response.text);
      });
    });
  });

  // Should NOT have group headers in individual mode
  expect(text).not.toContain('Work');
  expect(text).not.toContain('Ungrouped');
  // Should have all URLs
  expect(text).toContain(URLS.EXAMPLE_A);
  expect(text).toContain(URLS.EXAMPLE_B);
  expect(text).toContain(URLS.TEST_A);
});

test('63: Copy All Tabs button visible in both modes', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  // Groups mode
  await expect(popup.locator('#copyAllTabs-groups')).toBeVisible();

  // Switch to individual mode
  await switchMode(popup, 'individual');
  await expect(popup.locator('#copyAllTabs-individual')).toBeVisible();

  await popup.close();
});

test('64: Copied feedback appears after clicking', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const feedback = popup.locator('#copyFeedback-groups');

  // Feedback should not be visible initially
  await expect(feedback).not.toHaveClass(/visible/);

  await clickPopupButton(popup, 'copyAllTabs-groups');
  await sleep(500);

  // Feedback should be visible after clicking
  await expect(feedback).toHaveClass(/visible/);

  // Wait for feedback to disappear
  await sleep(1500);
  await expect(feedback).not.toHaveClass(/visible/);

  await popup.close();
});
