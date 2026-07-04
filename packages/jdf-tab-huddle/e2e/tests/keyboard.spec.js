import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createTabs, sleep } from '../helpers/tabs.js';
import { openPopup } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('kbd 1: hint badges are rendered on visible buttons', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);
  await sleep(300);

  // Every mapped, visible button carries a single-letter key badge.
  const badges = popup.locator('.hotkey-hint');
  expect(await badges.count()).toBeGreaterThan(0);

  // A couple of the mnemonic bindings are present and correct.
  await expect(popup.locator('#snoozeTab .hotkey-hint')).toHaveText('T');
  await expect(popup.locator('#sortCurrentWindow-groups .hotkey-hint')).toHaveText('S');

  await popup.close();
});

test('kbd 2: pressing the mode-switch hotkeys toggles the visible panel', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);
  await sleep(300);

  // Groups is the default active panel.
  await expect(popup.locator('#groups-content')).toBeVisible();

  // Press "i" → Individual mode.
  await popup.keyboard.press('i');
  await expect(popup.locator('#individual-content')).toHaveClass(/active/);
  await expect(popup.locator('#individual-content')).toBeVisible();
  await expect(popup.locator('#groups-content')).not.toBeVisible();

  // Press "g" → back to Groups mode.
  await popup.keyboard.press('g');
  await expect(popup.locator('#groups-content')).toHaveClass(/active/);
  await expect(popup.locator('#groups-content')).toBeVisible();

  await popup.close();
});

test('kbd 3: "t" opens the snooze picker and Escape closes it', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await sleep(400); // allow presets to load

  // Picker starts hidden.
  await expect(popup.locator('#snoozePickerPanel')).toBeHidden();

  // Press "t" (snooze Tab) → the picker opens and becomes the modal hotkey set.
  await popup.keyboard.press('t');
  await expect(popup.locator('#snoozePickerPanel')).toBeVisible();

  // While the picker is modal, its preset buttons carry their own badges.
  await expect(popup.locator('#snoozePreset-laterToday .hotkey-hint')).toHaveText('L');
  await expect(popup.locator('#snoozePickerCancel .hotkey-hint')).toHaveText('C');

  // Escape closes the picker.
  await popup.keyboard.press('Escape');
  await expect(popup.locator('#snoozePickerPanel')).toBeHidden();

  await popup.close();
});
