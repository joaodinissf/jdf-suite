import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { installFakeOpenRouter, siteUrls, GOOD_KEY } from '../helpers/fake-openrouter.js';
import { resetBrowserState } from '../helpers/tabs.js';
import { OPEN_LINKS_ARGS, LINKS_PAGE, linksPage, serveLinksPage, startOpenLinks } from '../helpers/open-links.js';

// What the link clumper's content script can reach, in a page where Open
// links as tabs was started. Code in a compromised renderer of that site runs
// there too, so this is the boundary between web pages and Huddle: the stored
// OpenRouter key and every worker action but clumpOpenUrls stay out of reach.

test.use({ extraArgs: OPEN_LINKS_ARGS });

// A page of links with Open links as tabs started on it.
async function startedPage(context, sw) {
  await serveLinksPage(context, linksPage(3));
  const page = await context.newPage();
  await page.goto(LINKS_PAGE);
  expect(await startOpenLinks(context, sw, page)).toEqual({ success: true, already: false });
  return page;
}

// Evaluates `expression` in Huddle's content-script world of `page`.
async function inContentScript(context, page, expression) {
  const cdp = await context.newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
  await cdp.send('Runtime.enable');
  const isHuddle = (c) => c.auxData && c.auxData.type === 'isolated' && c.name === 'Huddle';
  await expect.poll(() => worlds.some(isHuddle)).toBe(true);
  const r = await cdp.send('Runtime.evaluate', {
    expression, contextId: worlds.find(isHuddle).id, awaitPromise: true, returnByValue: true,
  });
  await cdp.detach();
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

test.beforeEach(async ({ sw, context }) => {
  await resetBrowserState(sw, context);
});

test('the content script cannot read storage.local, where the key is, and still reads its settings from storage.sync', async ({ sw, context }) => {
  await installFakeOpenRouter(context);
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ aiConfig: { key: btoa(key), model: 'anthropic/claude-haiku-5.5', expiresAt: null, expiryDuration: null } });
    await chrome.storage.sync.set({ clumping: { key: 'x' } });
  }, GOOD_KEY);
  const page = await startedPage(context, sw);

  const local = await inContentScript(context, page,
    "chrome.storage.local.get('aiConfig').then((r) => 'read ' + Object.keys(r), (e) => 'refused: ' + e.message)");
  expect(local).toMatch(/^refused: Access to storage is not allowed/);
  const sync = await inContentScript(context, page,
    "chrome.storage.sync.get('clumping').then((r) => r.clumping, (e) => 'refused: ' + e.message)");
  expect(sync).toEqual({ key: 'x' });
});

test('the content script may only open links: other actions are forbidden and an organize port is closed', async ({ sw, context }) => {
  const fake = await installFakeOpenRouter(context);
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ aiConfig: { key: btoa(key), model: 'anthropic/claude-haiku-5.5', expiresAt: null, expiryDuration: null } });
  }, GOOD_KEY);
  const page = await startedPage(context, sw);

  for (const message of [{ action: 'loadAiConfig' }, { action: 'copyTabs', scope: 'all' }, { action: 'deleteAiKey' }]) {
    expect(await inContentScript(context, page, `chrome.runtime.sendMessage(${JSON.stringify(message)})`))
      .toEqual({ success: false, error: 'forbidden' });
  }
  expect(await sw.evaluate(async () => (await chrome.storage.local.get('aiConfig')).aiConfig.key)).toBe(btoa(GOOD_KEY));

  const port = await inContentScript(context, page, `new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'huddle-ai-run' });
    port.onMessage.addListener((m) => resolve('message ' + m.type));
    port.onDisconnect.addListener(() => resolve('disconnected'));
    port.postMessage({ type: 'start', protocol: 2, instructions: '', model: null, respectGroups: true });
  })`);
  expect(port).toBe('disconnected');
  expect(fake.chats).toHaveLength(0);

  const target = siteUrls()[1];
  expect(await inContentScript(context, page, `chrome.runtime.sendMessage({ action: 'clumpOpenUrls', urls: [${JSON.stringify(target)}] })`))
    .toEqual({ success: true, opened: 1 });
  await expect.poll(() => sw.evaluate(async (url) => (await chrome.tabs.query({})).some((t) => (t.pendingUrl || t.url) === url), target)).toBe(true);
});
