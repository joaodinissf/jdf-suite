import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createWindow, sleep } from '../helpers/tabs.js';
import { openPopup, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('54: Default toggle is "Groups"', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  // The Groups segment should be pressed by default.
  await expect(popup.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'false');
  await expect(popup.locator('#modeSubtitle')).toHaveText('respecting groups');

  await popup.close();
});

test('55: Switch to Flat mode', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  await switchMode(popup, 'individual');

  // The Flat segment should now be pressed.
  await expect(popup.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'false');
  await expect(popup.locator('#modeSubtitle')).toHaveText('flat mode');

  await popup.close();
});

test('56: Toggle preference persisted', async ({ context, extensionId }) => {
  // Open popup and switch to Flat mode
  const popup1 = await openPopup(context, extensionId);
  await switchMode(popup1, 'individual');
  await sleep(300); // allow storage.local.set to complete
  await popup1.close();

  // Reopen popup and verify Flat mode is restored
  const popup2 = await openPopup(context, extensionId);
  await sleep(300); // allow loadUserPreferences to run

  await expect(popup2.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup2.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'false');

  await popup2.close();
});

test('57: Single window hides multi-window buttons (both toggle states)', async ({ context, extensionId }) => {
  // With only one window, multi-window buttons should be hidden regardless
  // of the Groups/Flat toggle (there's now a single action set).
  const popup = await openPopup(context, extensionId);
  await sleep(300); // allow updateUIForWindowCount to complete

  const hiddenIds = [
    'sortAllWindows',
    'moveAllToSingleWindow',
    'removeDuplicatesAllWindows',
    'removeDuplicatesGlobally',
  ];

  for (const id of hiddenIds) {
    await expect(popup.locator(`#${id}`)).not.toBeVisible();
  }

  // Switching the toggle doesn't change which buttons exist.
  await switchMode(popup, 'individual');

  for (const id of hiddenIds) {
    await expect(popup.locator(`#${id}`)).not.toBeVisible();
  }

  await popup.close();
});

test('58: Multiple windows shows all buttons (both toggle states)', async ({ sw, context, extensionId }) => {
  // Create a second window so multi-window buttons become visible
  await createWindow(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await sleep(300);

  const allButtonIds = [
    'sortAllWindows',
    'sortCurrentWindow',
    'extractDomain',
    'extractAllDomains',
    'moveAllToSingleWindow',
    'removeDuplicatesWindow',
    'removeDuplicatesAllWindows',
    'removeDuplicatesGlobally',
  ];

  for (const id of allButtonIds) {
    await expect(popup.locator(`#${id}`)).toBeVisible();
  }

  // Switch to Flat mode — the same buttons remain visible.
  await switchMode(popup, 'individual');

  for (const id of allButtonIds) {
    await expect(popup.locator(`#${id}`)).toBeVisible();
  }

  await popup.close();
});

test('59: All buttons have correct IDs (single action set)', async ({ sw, context, extensionId }) => {
  // Create second window to ensure all buttons are rendered (not hidden)
  await createWindow(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await sleep(300);

  const allButtonIds = [
    'sortAllWindows',
    'sortCurrentWindow',
    'extractDomain',
    'extractAllDomains',
    'moveAllToSingleWindow',
    'removeDuplicatesWindow',
    'removeDuplicatesAllWindows',
    'removeDuplicatesGlobally',
    'copyThisWindow',
    'copyAllWindows',
  ];

  expect(allButtonIds).toHaveLength(10);

  for (const id of allButtonIds) {
    const button = popup.locator(`#${id}`);
    await expect(button).toHaveCount(1);
  }

  await popup.close();
});
