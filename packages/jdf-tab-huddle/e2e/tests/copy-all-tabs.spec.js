import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createTabs, createTabGroup, sleep } from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('60: Copy all tabs (ungrouped, groups mode)', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);

  // Grant clipboard permissions by evaluating in the popup context
  await clickPopupButton(popup, 'copyAllTabs-groups');
  await sleep(500);

  // Read clipboard from the popup page context
  const clipboardText = await popup.evaluate(() => navigator.clipboard.readText());

  // Should contain both URLs (plus about:blank from the initial tab)
  expect(clipboardText).toContain(URLS.EXAMPLE_A);
  expect(clipboardText).toContain(URLS.TEST_A);
  // No group headers since there are no groups
  expect(clipboardText).not.toContain('Ungrouped');

  await popup.close();
});

test('61: Copy grouped tabs (groups mode) has group headers', async ({ sw, context, extensionId }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await clickPopupButton(popup, 'copyAllTabs-groups');
  await sleep(500);

  const clipboardText = await popup.evaluate(() => navigator.clipboard.readText());

  // Should have group header
  expect(clipboardText).toContain('Work');
  expect(clipboardText).toContain(URLS.EXAMPLE_A);
  expect(clipboardText).toContain(URLS.EXAMPLE_B);
  // Ungrouped tabs should be under "Ungrouped"
  expect(clipboardText).toContain('Ungrouped');
  expect(clipboardText).toContain(URLS.TEST_A);

  // Groups should be separated by blank lines
  const sections = clipboardText.split('\n\n');
  expect(sections.length).toBeGreaterThanOrEqual(2);

  await popup.close();
});

test('62: Copy tabs (individual mode) returns flat list', async ({ sw, context, extensionId }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await switchMode(popup, 'individual');
  await clickPopupButton(popup, 'copyAllTabs-individual');
  await sleep(500);

  const clipboardText = await popup.evaluate(() => navigator.clipboard.readText());

  // Should NOT have group headers in individual mode
  expect(clipboardText).not.toContain('Work');
  expect(clipboardText).not.toContain('Ungrouped');
  // Should have all URLs
  expect(clipboardText).toContain(URLS.EXAMPLE_A);
  expect(clipboardText).toContain(URLS.EXAMPLE_B);
  expect(clipboardText).toContain(URLS.TEST_A);

  await popup.close();
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
