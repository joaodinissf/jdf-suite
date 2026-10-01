import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { resetBrowserState, sleep } from '../helpers/tabs.js';

// A page of n links, one per 15 px row, served at clump.example.com. The
// links point at target.example.com, which serves a blank page. Both are
// answered here, so nothing goes to the network.
const TARGET = 'https://target.example.com';

function linksPage(n, script = '') {
  const links = Array.from({ length: n }, (_, i) => `<a style="display:block;height:15px" href="${TARGET}/p${i}">link ${i}</a>`).join('');
  return `<!doctype html><body style="margin:0">${links}<script>${script}</script></body>`;
}

async function serve(context, body) {
  await context.route('https://*.example.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: new URL(route.request().url()).hostname === 'clump.example.com' ? body : '<body>target</body>',
  }));
}

const openedCount = (sw) => sw.evaluate(async (t) => (await chrome.tabs.query({ url: `${t}/*` })).length, TARGET);

async function openLinksPage(context) {
  const page = await context.newPage();
  await page.goto('https://clump.example.com/');
  await page.bringToFront();
  await sleep(300); // the content script reads its settings
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

test('a page cannot open tabs by dispatching its own key and mouse events', async ({ sw, context }) => {
  await serve(context, linksPage(40, `
    addEventListener('load', () => setTimeout(() => {
      const d = document;
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true }));
      d.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0, bubbles: true }));
      d.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 5000, bubbles: true }));
      d.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 5000, button: 0, bubbles: true }));
      d.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', code: 'KeyZ', bubbles: true }));
      window.fired = true;
    }, 500));
  `));
  const page = await openLinksPage(context);
  await page.waitForFunction(() => window.fired === true);
  await sleep(1500);
  expect(await openedCount(sw)).toBe(0);
});

test('a real drag opens 5 links at once; over 25 links it asks, and OK opens the first 25', async ({ sw, context }) => {
  await serve(context, linksPage(40));
  const page = await openLinksPage(context);
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
