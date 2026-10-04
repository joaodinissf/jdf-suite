import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { installFakeOpenRouter, GOOD_KEY } from '../helpers/fake-openrouter.js';

// The Settings page's layout in a real browser, against a fake OpenRouter
// (the page loads the catalog; nothing reaches the real service).

test.use({ extraArgs: ['--host-resolver-rules=MAP openrouter.ai ~NOTFOUND'] });

test('at 320 px the delete question keeps Delete and Keep side by side (L57)', async ({ context, sw, extensionId }) => {
  await installFakeOpenRouter(context);
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({
      aiConfig: { key: btoa(key), model: 'anthropic/claude-haiku-4.5', expiresAt: null, expiryDuration: null, setupComplete: true },
    });
  }, GOOD_KEY);
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.click('#aiDeleteKey');
  await expect(page.locator('#aiConfirmDeleteNo')).toBeFocused();

  const yes = await page.locator('#aiConfirmDeleteYes').boundingBox();
  const no = await page.locator('#aiConfirmDeleteNo').boundingBox();
  // One row: the same top edge, Keep just right of Delete.
  expect(Math.round(no.y)).toBe(Math.round(yes.y));
  const gap = no.x - (yes.x + yes.width);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(16);
});
