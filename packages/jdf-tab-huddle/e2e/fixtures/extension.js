import { test as base, chromium } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom Playwright fixture that launches Chromium with the extension loaded.
 * Provides `context`, `extensionId`, and `sw` (service worker) to each test.
 */
export const test = base.extend({
  context: async ({}, use) => {
    const pathToExtension = path.resolve(__dirname, '../../src');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // MV3 extensions load in Chrome's new headless mode (full Chrome, not
      // the old stripped headless_shell), so tests run without taking over a
      // display. Set HEADED=1 to watch a run.
      //
      // headless stays false at the Playwright level on purpose: headless:true
      // selects the stripped headless_shell build, which has no extension
      // system. The --headless=new arg below gets full Chrome, headless.
      //
      // PW_EXECUTABLE points the run at a specific Chromium / Chrome for
      // Testing binary (e.g. a newer build than the pinned one). Branded
      // Google Chrome will not work: it ignores --load-extension.
      headless: false,
      ...(process.env.PW_EXECUTABLE
        ? { executablePath: process.env.PW_EXECUTABLE }
        : {}),
      args: [
        ...(process.env.HEADED ? [] : ['--headless=new']),
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },

  sw: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    await use(background);
  },
});
