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

  // A couple of the mnemonic bindings are present and correct (new single-panel ids).
  await expect(popup.locator('#snoozeTab .hotkey-hint')).toHaveText('T');
  await expect(popup.locator('#sortCurrentWindow .hotkey-hint')).toHaveText('S');
  await expect(popup.locator('#flattenWindow .hotkey-hint')).toHaveText('U');

  await popup.close();
});

test('kbd 2: the mode hotkeys flip the Groups/Flat toggle', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);
  await sleep(300);

  // Groups is the default active segment.
  await expect(popup.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'false');

  // Press "f" → Flat.
  await popup.keyboard.press('f');
  await expect(popup.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'false');
  await expect(popup.locator('#modeSubtitle')).toHaveText('flat mode');

  // Press "g" → back to Groups.
  await popup.keyboard.press('g');
  await expect(popup.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'false');
  await expect(popup.locator('#modeSubtitle')).toHaveText('respecting groups');

  await popup.close();
});

test('kbd 3: "t" opens the snooze picker (modal set) and Escape closes it', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  await sleep(400); // allow presets to load

  // Picker starts hidden.
  await expect(popup.locator('#snoozePickerPanel')).toBeHidden();

  // Press "t" (snooze Tab) → the picker opens and becomes the modal hotkey set.
  await popup.keyboard.press('t');
  await expect(popup.locator('#snoozePickerPanel')).toBeVisible();

  // While the picker is modal, its preset buttons carry their own badges and
  // the main-panel action buttons no longer do.
  await expect(popup.locator('#snoozePreset-laterToday .hotkey-hint')).toHaveText('L');
  await expect(popup.locator('#snoozePickerCancel .hotkey-hint')).toHaveText('C');
  await expect(popup.locator('#sortCurrentWindow .hotkey-hint')).toHaveCount(0);

  // Escape closes the picker.
  await popup.keyboard.press('Escape');
  await expect(popup.locator('#snoozePickerPanel')).toBeHidden();

  // Back to the main set: the action badges are restored.
  await expect(popup.locator('#sortCurrentWindow .hotkey-hint')).toHaveText('S');

  await popup.close();
});
