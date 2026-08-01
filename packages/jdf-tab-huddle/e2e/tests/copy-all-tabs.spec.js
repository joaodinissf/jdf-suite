import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, createTabs, createTabGroup, createWindow, sleep } from '../helpers/tabs.js';
import { openPopup, clickPopupButton, switchMode } from '../helpers/popup.js';
import { URLS } from '../helpers/constants.js';

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('60: Copy all windows (ungrouped) returns flat URL list', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.TEST_A]);
  await sleep(300);

  // Use a page context to send the message to the background script
  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'copyTabs', respectGroups: true, scope: 'all' },
        (response) => {
          resolve(response.text);
        }
      );
    });
  });
  await popup.close();

  // Should contain both URLs
  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.org/aaa');
  // No group headers since there are no groups
  expect(text).not.toContain('Ungrouped');
});

test('61: Copy grouped tabs (groups mode) has group sections', async ({ sw, context, extensionId }) => {
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.TEST_A]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Work', 'blue');
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'copyTabs', respectGroups: true, scope: 'all' },
        (response) => {
          resolve(response.text);
        }
      );
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
      chrome.runtime.sendMessage(
        { action: 'copyTabs', respectGroups: false, scope: 'all' },
        (response) => {
          resolve(response.text);
        }
      );
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

test('63: Copy buttons stay visible when toggling Groups/Flat', async ({ context, extensionId }) => {
  const popup = await openPopup(context, extensionId);

  // Groups mode (default)
  await expect(popup.locator('#copyThisWindow')).toBeVisible();
  await expect(popup.locator('#copyAllWindows')).toBeVisible();
  await expect(popup.locator('#modeGroups')).toHaveAttribute('aria-pressed', 'true');

  // Switch to Flat mode — same action buttons, only the toggle state changes.
  await switchMode(popup, 'individual');
  await expect(popup.locator('#copyThisWindow')).toBeVisible();
  await expect(popup.locator('#copyAllWindows')).toBeVisible();
  await expect(popup.locator('#modeFlat')).toHaveAttribute('aria-pressed', 'true');

  await popup.close();
});

test('64: Copied feedback appears after clicking Copy this window', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const feedback = popup.locator('#copyFeedback');

  // Feedback should not be visible initially
  await expect(feedback).not.toHaveClass(/visible/);

  await clickPopupButton(popup, 'copyThisWindow');
  await sleep(500);

  // Feedback should be visible after clicking
  await expect(feedback).toHaveClass(/visible/);

  // Wait for feedback to disappear
  await sleep(1500);
  await expect(feedback).not.toHaveClass(/visible/);

  await popup.close();
});

test('65: Copy this window excludes tabs from other windows', async ({ sw, context, extensionId }) => {
  // Tabs in the current (primary) window
  await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B]);
  // Tabs in a second window
  await createWindow(sw, [URLS.TEST_A, URLS.TEST_B]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'copyTabs', respectGroups: true, scope: 'window' },
        (response) => {
          resolve(response.text);
        }
      );
    });
  });
  await popup.close();

  // Current-window URLs present
  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.com/bbb');
  // Other-window URLs absent
  expect(text).not.toContain('https://example.org/aaa');
  expect(text).not.toContain('https://example.org/bbb');
});

test('66: Copy all windows includes tabs from every window', async ({ sw, context, extensionId }) => {
  await createTabs(sw, [URLS.EXAMPLE_A]);
  await createWindow(sw, [URLS.TEST_A]);
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'copyTabs', respectGroups: true, scope: 'all' },
        (response) => {
          resolve(response.text);
        }
      );
    });
  });
  await popup.close();

  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.org/aaa');
});

test('67: Copy this window sections by group without pulling in other windows', async ({ sw, context, extensionId }) => {
  // Current window: one group plus a loose tab, so the output must have
  // both a grouped section and an ungrouped one.
  const tabIds = await createTabs(sw, [URLS.EXAMPLE_A, URLS.EXAMPLE_B, URLS.EXAMPLE_C]);
  await createTabGroup(sw, [tabIds[0], tabIds[1]], 'Here', 'blue');
  // Second window, also grouped — none of it may reach the clipboard.
  const other = await createWindow(sw, [URLS.TEST_A, URLS.TEST_B]);
  await createTabGroup(sw, other.tabIds, 'There', 'red');
  await sleep(300);

  const popup = await openPopup(context, extensionId);
  const text = await popup.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'copyTabs', respectGroups: true, scope: 'window' },
        (response) => {
          resolve(response.text);
        }
      );
    });
  });
  await popup.close();

  expect(text).toContain('https://example.com/aaa');
  expect(text).toContain('https://example.com/bbb');
  expect(text).toContain('https://example.com/ccc');
  // The other window's grouped tabs must not leak into a window-scoped copy.
  expect(text).not.toContain('https://example.org/aaa');
  expect(text).not.toContain('https://example.org/bbb');

  // Grouped tabs and the loose tab land in separate paragraphs.
  const sections = text.split('\n\n').filter((s) => s.trim());
  expect(sections).toHaveLength(2);
});
