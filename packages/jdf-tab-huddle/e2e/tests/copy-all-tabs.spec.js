import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createTabs, createTabGroup, sleep } from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('60: Copy all tabs (ungrouped) returns flat URL list', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
  await sleep(300);

  // Use a page context to send the message to the background script
  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups: true }, (response) => {
        resolve(response.text);
      });
    });
  });
  await popup.close();

  // Should contain both URLs
  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.org/aaa');
  // No group headers since there are no groups
  expect(text).not.toContain('Ungrouped');
});

test('61: Copy grouped tabs (groups mode) has group headers', async ({ sw, context, extensionId }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups: true }, (response) => {
        resolve(response.text);
      });
    });
  });
  await popup.close();

  // Should have URLs but no group headers
  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.com/bbb');
  expect(text).toContain('https://example.org/aaa');
  expect(text).not.toContain('Work');
  expect(text).not.toContain('Ungrouped');

  // Groups should be separated by blank lines
  const sections = text.split('\n\n');
  expect(sections.length).toBeGreaterThanOrEqual(2);
});

test('62: Copy tabs (individual mode) returns flat list without headers', async ({ sw, context, extensionId }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups: false }, (response) => {
        resolve(response.text);
      });
    });
  });
  await popup.close();

  // Should NOT have group headers in individual mode
  expect(text).not.toContain('Work');
  expect(text).not.toContain('Ungrouped');
  // Should have all URLs
  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.com/bbb');
  expect(text).toContain('https://example.org/aaa');
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
