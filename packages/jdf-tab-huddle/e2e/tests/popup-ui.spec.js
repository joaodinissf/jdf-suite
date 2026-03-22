import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createWindow, sleep } from '../helpers/tabs.js';
import { openPopup, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('54: Default mode is "groups"', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  // The groups tab button should be active
  const groupsButton = popup.locator('.tab-button[data-tab="groups"]');
  await expect(groupsButton).toHaveClass(/active/);

  // Groups content should be visible
  const groupsContent = popup.locator('#groups-content');
  await expect(groupsContent).toHaveClass(/active/);
  await expect(groupsContent).toBeVisible();

  // Individual content should be hidden
  const individualContent = popup.locator('#individual-content');
  await expect(individualContent).not.toHaveClass(/active/);
  await expect(individualContent).not.toBeVisible();

  await popup.close();
});

test('55: Switch to individual mode', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  await switchMode(popup, 'individual');

  // Individual tab button should be active
  const individualButton = popup.locator('.tab-button[data-tab="individual"]');
  await expect(individualButton).toHaveClass(/active/);

  // Individual content should be visible
  const individualContent = popup.locator('#individual-content');
  await expect(individualContent).toHaveClass(/active/);
  await expect(individualContent).toBeVisible();

  // Groups content should be hidden
  const groupsContent = popup.locator('#groups-content');
  await expect(groupsContent).not.toHaveClass(/active/);
  await expect(groupsContent).not.toBeVisible();

  await popup.close();
});

test('56: Mode preference persisted', async ({ context, extensionId }) => {
  // Open popup and switch to individual mode
  const popup1 = await openPopup(context, extensionId);
  await switchMode(popup1, 'individual');
  await sleep(300); // allow storage.local.set to complete
  await popup1.close();

  // Reopen popup and verify individual mode is restored
  const popup2 = await openPopup(context, extensionId);
  await sleep(300); // allow loadUserPreferences to run

  const individualButton = popup2.locator('.tab-button[data-tab="individual"]');
  await expect(individualButton).toHaveClass(/active/);

  const individualContent = popup2.locator('#individual-content');
  await expect(individualContent).toHaveClass(/active/);
  await expect(individualContent).toBeVisible();

  const groupsContent = popup2.locator('#groups-content');
  await expect(groupsContent).not.toBeVisible();

  await popup2.close();
});

test('57: Single window hides multi-window buttons', async ({ context, extensionId }) => {
  // With only one window, multi-window buttons should be hidden in both modes
  const popup = await openPopup(context, extensionId);
  await sleep(300); // allow updateUIForWindowCount to complete

  // Check groups mode buttons
  const hiddenGroupsIds = [
    'sortAllWindows-groups',
    'moveAllToSingleWindow-groups',
    'removeDuplicatesAllWindows-groups',
    'removeDuplicatesGlobally-groups',
  ];

  for (const id of hiddenGroupsIds) {
    await expect(popup.locator(`#${id}`)).not.toBeVisible();
  }

  // Switch to individual mode
  await switchMode(popup, 'individual');

  const hiddenIndividualIds = [
    'sortAllWindows-individual',
    'moveAllToSingleWindow-individual',
    'removeDuplicatesAllWindows-individual',
    'removeDuplicatesGlobally-individual',
  ];

  for (const id of hiddenIndividualIds) {
    await expect(popup.locator(`#${id}`)).not.toBeVisible();
  }

  await popup.close();
});

test('58: Multiple windows shows all buttons', async ({ sw, context, extensionId }) => {
  // Create a second window so multi-window buttons become visible
  await createWindow(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await sleep(300);

  // All groups mode buttons should be visible
  const groupsButtonIds = [
    'sortAllWindows-groups',
    'sortCurrentWindow-groups',
    'extractDomain-groups',
    'extractAllDomains-groups',
    'moveAllToSingleWindow-groups',
    'removeDuplicatesWindow-groups',
    'removeDuplicatesAllWindows-groups',
    'removeDuplicatesGlobally-groups',
  ];

  for (const id of groupsButtonIds) {
    await expect(popup.locator(`#${id}`)).toBeVisible();
  }

  // Switch to individual mode and check all buttons there too
  await switchMode(popup, 'individual');

  const individualButtonIds = [
    'sortAllWindows-individual',
    'sortCurrentWindow-individual',
    'extractDomain-individual',
    'extractAllDomains-individual',
    'moveAllToSingleWindow-individual',
    'removeDuplicatesWindow-individual',
    'removeDuplicatesAllWindows-individual',
    'removeDuplicatesGlobally-individual',
  ];

  for (const id of individualButtonIds) {
    await expect(popup.locator(`#${id}`)).toBeVisible();
  }

  await popup.close();
});

test('59: All buttons have correct IDs', async ({ sw, context, extensionId }) => {
  // Create second window to ensure all buttons are rendered (not hidden)
  await createWindow(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await sleep(300);

  const allButtonIds = [
    // Groups mode (9 buttons)
    'sortAllWindows-groups',
    'sortCurrentWindow-groups',
    'extractDomain-groups',
    'extractAllDomains-groups',
    'moveAllToSingleWindow-groups',
    'removeDuplicatesWindow-groups',
    'removeDuplicatesAllWindows-groups',
    'removeDuplicatesGlobally-groups',
    'copyAllTabs-groups',
    // Individual mode (9 buttons)
    'sortAllWindows-individual',
    'sortCurrentWindow-individual',
    'extractDomain-individual',
    'extractAllDomains-individual',
    'moveAllToSingleWindow-individual',
    'removeDuplicatesWindow-individual',
    'removeDuplicatesAllWindows-individual',
    'removeDuplicatesGlobally-individual',
    'copyAllTabs-individual',
  ];

  expect(allButtonIds).toHaveLength(18);

  for (const id of allButtonIds) {
    const button = popup.locator(`#${id}`);
    await expect(button).toHaveCount(1);
  }

  await popup.close();
});
