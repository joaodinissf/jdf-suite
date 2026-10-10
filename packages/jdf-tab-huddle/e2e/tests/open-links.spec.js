import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, sleep } from '../helpers/tabs.js';
import {
  OPEN_LINKS_ARGS, LINKS_PAGE, linksPage, serveLinksPage, openedCount, startOpenLinks, hint,
} from '../helpers/open-links.js';

// Open links as tabs on the shipped manifest: no content script and no access
// to every site, so a page has no clumper until the user starts it there.

test.use({ extraArgs: OPEN_LINKS_ARGS });

async function openLinksPage(context, n) {
  await serveLinksPage(context, linksPage(n));
  const page = await context.newPage();
  await page.goto(LINKS_PAGE);
  await page.bringToFront();
  return page;
}

// Holds Z and drags with Playwright's mouse, whose events are the user's own
// (trusted), from the top-left corner down past the nth link.
async function zDrag(page, n) {
  await page.keyboard.down('z');
  await page.mouse.move(2, 2);
  await page.mouse.down();
  await page.mouse.move(200, n * 15 - 5, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('until it is started on the page, a real drag opens nothing', async ({ sw, context }) => {
  const page = await openLinksPage(context, 5);
  await zDrag(page, 5);
  await page.keyboard.up('z');
  await sleep(1000);
  expect(await openedCount(sw)).toBe(0);
  await expect(page.locator('[data-jdf-tab-huddle]')).toHaveCount(0);
});

test('started from the toolbar, it says how to use it, and a real drag opens 5 links; over 25 it asks, and OK opens the first 25', async ({ sw, context }) => {
  const page = await openLinksPage(context, 40);
  expect(await startOpenLinks(context, sw, page)).toEqual({ success: true, already: false });
  await expect(hint(page)).toHaveText('Huddle: hold Z and drag over links to open them as tabs. On until this page reloads.');
  await expect(hint(page)).toHaveCount(0, { timeout: 10000 });

  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.accept();
  });
  await zDrag(page, 5);
  await page.keyboard.up('z');
  await expect.poll(() => openedCount(sw)).toBe(5);
  expect(dialogs).toEqual([]);

  await zDrag(page, 40);
  await page.keyboard.up('z');
  await expect.poll(() => openedCount(sw)).toBe(30);
  expect(dialogs).toEqual(['Huddle: open the first 25 of 40 links?']);
  await sleep(500);
  expect(await openedCount(sw)).toBe(30);
});

test('starting it again shows the hint again, and one drag still opens each link once', async ({ sw, context }) => {
  const page = await openLinksPage(context, 3);
  expect(await startOpenLinks(context, sw, page)).toEqual({ success: true, already: false });
  expect(await startOpenLinks(context, sw, page)).toEqual({ success: true, already: true });
  await expect(hint(page)).toHaveText('Huddle is already on: hold Z and drag over links to open them as tabs.');
  await zDrag(page, 3);
  await page.keyboard.up('z');
  await expect.poll(() => openedCount(sw)).toBe(3);
  await sleep(500);
  expect(await openedCount(sw)).toBe(3);
});

test('it lasts until the page reloads', async ({ sw, context }) => {
  const page = await openLinksPage(context, 3);
  await startOpenLinks(context, sw, page);
  await page.reload();
  await zDrag(page, 3);
  await page.keyboard.up('z');
  await sleep(1000);
  expect(await openedCount(sw)).toBe(0);
});

test('a page cannot open tabs by dispatching its own key and mouse events', async ({ sw, context }) => {
  const page = await openLinksPage(context, 40);
  await startOpenLinks(context, sw, page);
  // The clumper is running here: its hint is up.
  await expect(hint(page)).toHaveCount(1);
  await page.evaluate(() => {
    const d = document;
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true }));
    d.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    d.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 5000, bubbles: true }));
    d.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 5000, button: 0, bubbles: true }));
    d.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', code: 'KeyZ', bubbles: true }));
  });
  await sleep(1500);
  expect(await openedCount(sw)).toBe(0);
});

test('a page Chrome keeps from extensions is refused with the reason', async ({ sw, context }) => {
  const page = await context.newPage();
  await page.goto('chrome://version/');
  expect(await startOpenLinks(context, sw, page))
    .toEqual({ success: false, reason: 'Chrome doesn\'t let extensions run on this page' });
});

test('the shipped manifest loads without errors and grants no site access', async ({ sw }) => {
  const granted = await sw.evaluate(() => chrome.permissions.getAll());
  expect(granted.origins).toEqual([]);
  expect(granted.permissions).toContain('activeTab');
  expect(granted.permissions).not.toContain('windows');
  // chrome.windows works without the permission.
  expect(await sw.evaluate(async () => (await chrome.windows.getAll()).length)).toBeGreaterThan(0);
  const commands = await sw.evaluate(() => chrome.commands.getAll());
  expect(commands.find((c) => c.name === 'open-links')).toMatchObject({ description: 'Open links on this page as tabs' });
});
