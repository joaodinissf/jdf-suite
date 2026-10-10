/**
 * Open links as tabs, started the way a user does, on the shipped manifest.
 *
 * Huddle only gets into a page through activeTab, which Chrome grants after a
 * user gesture on the extension (its toolbar button or a shortcut).
 * Playwright can't press either, but the DevTools protocol can click the
 * toolbar button: Extensions.triggerAction, which needs Chrome started with
 * --enable-unsafe-extension-debugging. The worker then starts the clumper in
 * that tab with armClumper, as the shortcut and the popup's button do.
 */

// Chrome flags for specs that start Open links as tabs:
// test.use({ extraArgs: OPEN_LINKS_ARGS }).
export const OPEN_LINKS_ARGS = ['--enable-unsafe-extension-debugging'];

// The links' targets, served blank.
export const TARGET = 'https://target.example.com';
export const LINKS_PAGE = 'https://clump.example.com/';

// A page of n links, one per 15 px row.
export function linksPage(n) {
  const links = Array.from({ length: n }, (_, i) => `<a style="display:block;height:15px" href="${TARGET}/p${i}">link ${i}</a>`).join('');
  return `<!doctype html><body style="margin:0">${links}</body>`;
}

// Serves `body` at clump.example.com and a blank page everywhere else under
// example.com, so nothing goes to the network.
export async function serveLinksPage(context, body) {
  await context.route('https://*.example.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: new URL(route.request().url()).hostname === 'clump.example.com' ? body : '<body>target</body>',
  }));
}

export const openedCount = (sw) => sw.evaluate(async (t) => (await chrome.tabs.query({ url: `${t}/*` })).length, TARGET);

// Clicks Huddle's toolbar button over `page` (granting activeTab for its tab),
// then starts the clumper there. Resolves with armClumper's reply.
export async function startOpenLinks(context, sw, page) {
  const url = page.url();
  const cdp = await context.browser().newBrowserCDPSession();
  try {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
    const tab = targetInfos.find((t) => t.type === 'tab' && t.url === url);
    if (!tab) throw new Error(`no tab target for ${url}`);
    await cdp.send('Extensions.triggerAction', { id: new URL(sw.url()).host, targetId: tab.targetId });
  } finally {
    await cdp.detach();
  }
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
  return sw.evaluate((id) => armClumper(id), tabId);
}

// The hint the page shows once it's started, inside Huddle's shadow root.
export const hint = (page) => page.locator('[data-jdf-tab-huddle="open-links-hint"] [role="status"]');
