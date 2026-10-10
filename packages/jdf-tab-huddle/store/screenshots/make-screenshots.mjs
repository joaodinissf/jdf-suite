#!/usr/bin/env node
/**
 * Makes Huddle's Chrome Web Store screenshots and small promo tile.
 *
 *   PW_EXECUTABLE=<Chrome for Testing binary> node store/screenshots/make-screenshots.mjs
 *
 * Run from packages/jdf-tab-huddle. It loads this checkout's src/ into Chrome
 * for Testing with a throwaway profile, opens invented tabs on reserved
 * example.com hosts (served by Playwright, never fetched), answers OpenRouter
 * with the e2e suite's fake (e2e/helpers/fake-openrouter.js) and a test key,
 * and resolves every other host to nowhere, so nothing reaches the network.
 *
 * It writes, next to this file:
 *   1-popup.png, 2-snooze.png       the popup beside a caption
 *   3-nap-room.png                  the nap room with four snoozes
 *   4-open-links-as-tabs.png        a drag under way, with the page hint
 *   5-organize-with-ai.png          a proposal from the fake model
 *   promo-small-440x280.png         the small promo tile
 *
 * Every image is drawn in a 1024 x 640 CSS frame at 1.25x, so it comes out at
 * the 1280 x 800 the store asks for (440 x 280 for the tile), and is saved as
 * a 24-bit PNG with no alpha channel. The script stops with an error when a
 * page doesn't fit its picture. SHOTS_DEBUG=<dir> saves the page that didn't.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { installFakeOpenRouter, GOOD_KEY } from '../../e2e/helpers/fake-openrouter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');
const SCALE = 1.25;
const FRAME = { width: 1024, height: 640 };

// --- Invented tabs -------------------------------------------------------

// Sites on reserved example.com hosts, served as plain pages with no icon,
// so every tab shows Chrome's own placeholder icon.
const tab = (host, slug, title) => ({ url: `https://${host}/${slug}`, title });

// A window mid-task: a trip being planned, dinner, some work.
const MIXED_TABS = [
  tab('travel.example.com', 'lisbon/3-days', 'Lisbon in three days: an unhurried itinerary'),
  tab('recipes.example.com', 'one-pan-gnocchi', 'One-pan gnocchi with tomatoes and spinach'),
  tab('docs.example.com', 'api/tab-groups', 'Tab groups API reference'),
  tab('market.example.com', 'list', 'Weekly shopping list'),
  tab('code.example.com', 'huddle/pull/42', 'Release notes for 1.0 · Pull request #42'),
  tab('stays.example.com', 'lisbon/alfama', 'Guesthouses in Alfama, Lisbon'),
];

// How the fake model groups MIXED_TABS: by what they're for, as a good model would.
const AI_GROUPS = [
  { name: 'Lisbon trip', color: 'blue', hosts: ['travel.example.com', 'stays.example.com'] },
  { name: 'Dinner this week', color: 'green', hosts: ['recipes.example.com', 'market.example.com'] },
  { name: 'Release 1.0', color: 'purple', hosts: ['docs.example.com', 'code.example.com'] },
];

// Tabs that go to sleep, and when they wake.
const SNOOZES = [
  { tabs: [tab('video.example.com', 'talks/slow-software', 'Talk: The case for slow software (42 min)')], preset: 'tonight' },
  { tabs: [tab('reading.example.com', 'essays/attention', 'Long read: Where does attention go?')], preset: 'weekend', late: true },
  {
    group: { title: 'Half marathon', color: 'yellow' },
    tabs: [
      tab('run.example.com', 'plans/12-weeks', '12-week half marathon plan'),
      tab('run.example.com', 'shoes/2026', 'Running shoes for long distances'),
      tab('run.example.com', 'races/autumn', 'Autumn races near you'),
    ],
    preset: 'nextWeek',
  },
  // Snoozed after the popup's picture, whose Sleeping list shows two
  // without scrolling.
  { tabs: [tab('market.example.com', 'tent', 'Two-person tent, compared')], preset: 'tomorrow', late: true },
];

// A second window's tabs, so the popup shows its All windows section.
const EXTRA_TABS = [
  tab('docs.example.com', 'guide/manifest', 'Manifest file format'),
  tab('code.example.com', 'huddle/issues', 'Issues · huddle'),
  tab('news.example.com', 'science/naps', 'Why a short nap helps you focus'),
  tab('reading.example.com', 'essays/maps', 'Essay: Maps we carry in our heads'),
];

// The title each invented page shows.
function titleFor(url) {
  for (const t of [...MIXED_TABS, ...SNOOZES.flatMap((s) => s.tabs), ...EXTRA_TABS]) {
    if (t.url === url) return t.title;
  }
  return new URL(url).hostname;
}

const sitePage = (title) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><link rel="icon" href="data:,"><body style="font:16px system-ui;margin:40px"><h1>${title}</h1></body></html>`;

// The page Open links as tabs is shown on: a reading list with links.
const READING_LIST = [
  ['The quiet joy of single-tasking', 'Notes from a month of one tab at a time.'],
  ['How we read on screens', 'What eye-tracking studies say about long pages.'],
  ['A field guide to bookmarks', 'Folders, tags, and the ones you never open again.'],
  ['Small tools, well made', 'On software that does one thing and does it kindly.'],
  ['The case for slow software', 'Why waiting a second can be a feature.'],
  ['Where does attention go?', 'An essay on notifications, focus and rest.'],
];

const readingListPage = () => `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Weekend reading · Reading Room</title>
<link rel="icon" href="data:,">
<style>
  body { margin: 0; background: #fbfaf7; color: #26231f; font: 17px/1.55 Georgia, 'Times New Roman', serif; }
  header { border-bottom: 1px solid #e6e1d8; padding: 18px 48px; font: 600 15px system-ui, sans-serif; letter-spacing: .02em; color: #6b6255; }
  main { max-width: 640px; margin: 0 auto; padding: 28px 24px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
  .dek { color: #6b6255; margin: 0 0 22px; font-size: 16px; }
  ol { padding-left: 22px; margin: 0; }
  li { margin: 0 0 12px; }
  a { color: #1d4f91; font-weight: 600; text-decoration: none; }
  li span { display: block; color: #6b6255; font-size: 15px; }
</style>
<header>Reading Room</header>
<main>
  <h1>Weekend reading</h1>
  <p class="dek">Six pieces on attention, tools and tabs, picked for a slow Saturday.</p>
  <ol>${READING_LIST.map(([t, d], i) => `<li><a href="https://reading.example.com/essays/${i + 1}">${t}</a><span>${d}</span></li>`).join('')}</ol>
</main></html>`;

async function serveSites(context) {
  await context.route(/^https:\/\/[a-z]+\.example\.com\//, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'frame.example.com') {
      if (url.pathname.startsWith('/fonts/')) {
        return route.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(SRC, url.pathname)) });
      }
      return route.fulfill({ contentType: 'text/html', body: FRAMES.get(url.pathname) || '' });
    }
    const body = url.href === 'https://reading.example.com/weekend' ? readingListPage() : sitePage(titleFor(url.href));
    return route.fulfill({ contentType: 'text/html', body });
  });
}

// The fake OpenRouter answers the catalog and the key check; this one answer
// replaces its chat reply with groups by purpose instead of by site.
async function fakeAiAnswer(context) {
  await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const text = (body.messages || []).map((m) => m.content || '').join('\n');
    const groups = AI_GROUPS.map((g) => ({ name: g.name, color: g.color, tabIds: [] }));
    for (const m of text.matchAll(/\[id:(\d+)\]\s+(\S+)\s+—/g)) {
      const i = AI_GROUPS.findIndex((g) => g.hosts.includes(m[2]));
      if (i >= 0) groups[i].tabIds.push(Number(m[1]));
    }
    const content = JSON.stringify({ groups: groups.filter((g) => g.tabIds.length) });
    const chunk = (delta, extra = {}) => `data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta, ...extra }] })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
      body: chunk({ content }) + chunk({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
    });
  });
}

// --- PNG without alpha -----------------------------------------------------

// Chrome's screenshots are RGBA. The store's docs don't say whether a
// screenshot may have an alpha channel, so this drops it (it is fully opaque
// anyway) and re-encodes the image as a 24-bit RGB PNG.
function pngWithoutAlpha(png) {
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    chunks.push({ type: png.toString('latin1', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [depth, colorType, , , interlace] = ihdr.subarray(8, 13);
  if (depth !== 8 || interlace !== 0) throw new Error('unexpected PNG format');
  if (colorType === 2) return png;
  if (colorType !== 6) throw new Error(`unexpected PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const inStride = width * 4;
  const outStride = width * 3;
  const rgba = Buffer.alloc(inStride * height);
  let prev = Buffer.alloc(inStride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (inStride + 1)];
    const line = raw.subarray(y * (inStride + 1) + 1, (y + 1) * (inStride + 1));
    const row = rgba.subarray(y * inStride, (y + 1) * inStride);
    for (let x = 0; x < inStride; x++) {
      const a = x >= 4 ? row[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 0xff;
    }
    prev = row;
  }
  // Re-encode as RGB, each row with the Up filter (good for screenshots).
  const out = Buffer.alloc((outStride + 1) * height);
  let above = Buffer.alloc(outStride);
  for (let y = 0; y < height; y++) {
    const rgb = Buffer.alloc(outStride);
    for (let x = 0; x < width; x++) rgba.copy(rgb, x * 3, y * inStride + x * 4, y * inStride + x * 4 + 3);
    out[y * (outStride + 1)] = 2;
    for (let x = 0; x < outStride; x++) out[y * (outStride + 1) + 1 + x] = (rgb[x] - above[x]) & 0xff;
    above = rgb;
  }
  const newIhdr = Buffer.from(ihdr);
  newIhdr[9] = 2;
  return Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', newIhdr), pngChunk('IDAT', zlib.deflateSync(out, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([head.subarray(4), data])) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

function save(name, png, [width, height] = [1280, 800]) {
  if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
    throw new Error(`${name} is ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)}, not ${width} x ${height}`);
  }
  const file = path.join(HERE, name);
  fs.writeFileSync(file, pngWithoutAlpha(png));
  console.log(`  ${name}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
}

// --- Frames ---------------------------------------------------------------

const theme = fs.readFileSync(path.join(SRC, 'huddle-theme.css'), 'utf8');
const mark = fs.readFileSync(path.join(SRC, 'icons/huddle-mark.svg'), 'utf8');

// The composed images are pages at frame.example.com (served by serveSites),
// so they can load Huddle's bundled fonts.
const FRAMES = new Map();
async function showFrame(page, name, html) {
  FRAMES.set(`/${name}`, html);
  await page.goto(`https://frame.example.com/${name}`);
}

// A page of Huddle's own ground and type, for the composed images.
const framePage = (body, css) => `<!doctype html><html lang="en"><meta charset="utf-8"><style>${theme}
  html, body { margin: 0; height: 100%; overflow: hidden; }
  ${css}</style><body>${body}</body></html>`;

// --- The run ----------------------------------------------------------------

async function main() {
  const executablePath = process.env.PW_EXECUTABLE;
  if (!executablePath) throw new Error('Set PW_EXECUTABLE to a Chrome for Testing binary.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-store-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: false,
    viewport: FRAME,
    deviceScaleFactor: SCALE,
    colorScheme: 'light',
    // No fades mid-screenshot (the page hint's 160 ms rise, hover colours).
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/Lisbon',
    args: [
      '--headless=new',
      `--disable-extensions-except=${SRC}`,
      `--load-extension=${SRC}`,
      '--enable-unsafe-extension-debugging',
      // Nothing resolves: every page and OpenRouter are answered by routes.
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
    ],
  });
  context.setDefaultTimeout(60000);
  try {
    await installFakeOpenRouter(context);
    await fakeAiAnswer(context);
    await serveSites(context);
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).host;
    sw.on('console', (m) => { if (m.type() === 'error') console.error('  [worker]', m.text()); });
    const ext = (page) => `chrome-extension://${extensionId}/${page}`;
    await sw.evaluate(async (key) => {
      await chrome.storage.local.set({
        aiConfig: { key: btoa(key), model: 'anthropic/claude-haiku-5.5', expiresAt: Date.now() + 30 * 86400000, expiryDuration: 30 * 86400000, setupComplete: true },
      });
    }, GOOD_KEY);

    console.log('Huddle store images:');
    await snoozeSome(sw);
    await organizeShot(context, sw, ext);
    await popupShot(context, sw, ext);
    await snoozeSome(sw, true);
    await napRoomShot(context, ext);
    await openLinksShot(context, sw);
    await promoTile(context);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// Opens tabs (in a new window when asked) and waits until they show their
// titles. A tab's first load can start before Playwright's routes see the
// tab, and then fails (nothing resolves), so each tab is loaded again.
async function openTabs(sw, tabs, { newWindow = false } = {}) {
  return sw.evaluate(async ({ urls, newWindow }) => {
    const ids = [];
    let windowId;
    if (newWindow) {
      const win = await chrome.windows.create({ url: urls[0], focused: false });
      windowId = win.id;
      ids.push(win.tabs[0].id);
    }
    for (const url of urls.slice(ids.length)) ids.push((await chrome.tabs.create({ url, windowId, active: false })).id);
    const loaded = async (id) => {
      const t = await chrome.tabs.get(id);
      return t.status === 'complete' && t.title && t.title !== new URL(t.url || t.pendingUrl).hostname;
    };
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 50; i++) {
        const done = await Promise.all(ids.map((id) => chrome.tabs.get(id).then((t) => t.status === 'complete')));
        if (done.every(Boolean)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const waiting = [];
      for (const id of ids) if (!(await loaded(id))) waiting.push(id);
      if (!waiting.length) return ids;
      await Promise.all(waiting.map((id) => chrome.tabs.reload(id)));
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('the test tabs did not load');
  }, { urls: tabs.map((t) => t.url), newWindow });
}

// Snoozes SNOOZES through the worker's own handlers, as the popup would.
async function snoozeSome(sw, late = false) {
  for (const s of SNOOZES.filter((x) => !!x.late === late)) {
    const ids = await openTabs(sw, s.tabs);
    await sw.evaluate(async ({ ids, group, preset }) => {
      await chrome.tabs.update(ids[0], { active: true });
      let handler = handleSnoozeTab;
      if (group) {
        const groupId = await chrome.tabs.group({ tabIds: ids });
        await chrome.tabGroups.update(groupId, group);
        handler = handleSnoozeGroup;
      }
      const reply = await new Promise((resolve) => handler({ wakeAt: computePresetWakeTime(preset), preset }, resolve));
      if (!reply || reply.success === false) throw new Error(`snooze failed: ${JSON.stringify(reply)}`);
    }, { ids, group: s.group, preset: s.preset });
  }
}

// (5) Organize with AI: the proposal for a mixed window. Last of the five,
// since AI is optional: everything else works without it.
async function organizeShot(context, sw, ext) {
  await openTabs(sw, MIXED_TABS);
  await sw.evaluate(async () => {
    const blanks = await chrome.tabs.query({ url: 'about:blank' });
    const [first] = await chrome.tabs.query({ url: 'https://travel.example.com/*' });
    await chrome.tabs.update(first.id, { active: true });
    if (blanks.length) await chrome.tabs.remove(blanks.map((t) => t.id));
  });
  const popup = await context.newPage();
  await popup.goto(ext('popup.html'));
  await popup.locator('#aiOrganize').click();
  let page;
  for (let i = 0; i < 300 && !page; i++) {
    page = context.pages().find((p) => p.url().includes('/ai-proposal.html'));
    if (!page) await popup.waitForTimeout(200);
  }
  if (!page) throw new Error(`the organize page did not open; pages: ${context.pages().map((p) => p.url()).join(', ')}`);
  await popup.close();
  await page.waitForLoadState('domcontentloaded');
  // At 90 % zoom, so the page's three groups fit in one picture.
  await zoomTo(page, 0.9);
  await page.locator('#startOrganize').click();
  await page.locator('#content .group-card').nth(AI_GROUPS.length - 1).waitFor();
  await page.locator('#applyButton').blur();
  await page.mouse.move(0, 0);
  await settle(page);
  await fitsOnScreen(page);
  save('5-organize-with-ai.png', await page.screenshot());
  // Applied, so the popup's picture shows a window with tab groups.
  const closed = page.waitForEvent('close');
  await page.locator('#applyButton').click();
  await closed;
}

// Shows the page as at a browser zoom of `factor` (the frame is drawn at
// SCALE, so CSS zoom makes up the difference), still 1280 x 800 pixels.
async function zoomTo(page, factor) {
  await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, factor / SCALE);
}

// Nothing below the fold: everything you can see on the page (text, images,
// controls and bordered boxes, not the page's bottom padding) is in the
// picture. The root's height is in the same (zoomed) units as those boxes.
async function fitsOnScreen(page) {
  const lowest = await page.evaluate(() => {
    const seen = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return box.width && box.height && style.visibility !== 'hidden'
        && (!el.children.length || style.borderBottomWidth !== '0px');
    });
    const bottom = Math.max(...seen.map((el) => el.getBoundingClientRect().bottom));
    const el = seen.find((x) => x.getBoundingClientRect().bottom === bottom);
    return { over: Math.ceil(bottom - document.documentElement.clientHeight), what: `${el.tagName.toLowerCase()} ${el.id || el.className}` };
  });
  if (lowest.over > 0) {
    if (process.env.SHOTS_DEBUG) await page.screenshot({ path: path.join(process.env.SHOTS_DEBUG, 'too-tall.png') });
    throw new Error(`${page.url()}: ${lowest.what} ends ${lowest.over}px below the picture`);
  }
}

// Waits for fonts, favicons and transitions.
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(Array.from(document.images, (img) => img.complete || new Promise((r) => { img.onload = img.onerror = r; }))));
  await page.waitForTimeout(400);
}

// (1, 2) The popup, at its real size, beside what it is for; then its
// snooze picker.
async function popupShot(context, sw, ext) {
  // A second window, so the popup shows its All windows section too.
  await openTabs(sw, EXTRA_TABS, { newWindow: true });
  // The popup page is a tab in the trip's window, opened in the background,
  // so its current window's active tab is a web page, as when you click
  // Huddle's button over one (Chrome for Testing has no toolbar to click).
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 640 });
  await sw.evaluate(async (popupUrl) => {
    const [own] = await chrome.tabs.query({ url: 'about:blank' });
    const [first] = await chrome.tabs.query({ url: 'https://travel.example.com/*' });
    if (!own || own.windowId !== first.windowId) throw new Error('the popup page did not open in the trip window');
    await chrome.windows.update(first.windowId, { focused: true });
    await chrome.tabs.update(first.id, { active: true });
    await chrome.tabs.update(own.id, { url: popupUrl });
  }, ext('popup.html'));
  await popup.waitForURL(ext('popup.html'));
  await popup.locator('#snoozedList li').nth(1).waitFor();
  await settle(popup);
  // The Sleeping list shows every item, with nothing to scroll. (The footer's
  // shortcut line hides a shortcut that doesn't fit by design; it is checked
  // by looking at the picture.)
  const clipped = await popup.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .filter((el) => el.id !== 'openShortcut')
    .filter((el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible')
    .map((el) => el.id || el.className));
  if (clipped.length) throw new Error(`the popup scrolls inside: ${clipped.join(', ')}`);
  const main = await popupPicture(popup);
  // Then the snooze picker, opened from Tab as a click would.
  await popup.locator('#snoozeTab').click();
  await popup.locator('#snoozePickerPanel:not([hidden])').waitFor();
  await popup.mouse.move(0, 0);
  await settle(popup);
  const picker = await popupPicture(popup);
  await popup.close();

  await composeWithPopup(context, '1-popup.png', main, `
    <h1>Organize your browser tabs</h1>
    <p>Sort, group, de-duplicate and snooze tabs from one popup, with a single key for each action.</p>
    <p><kbd>Alt+Shift+U</kbd> opens it, <kbd>⌥⇧U</kbd> on a Mac.</p>`);
  await composeWithPopup(context, '2-snooze.png', picker, `
    <h1>Snooze tabs until later</h1>
    <p>Put a tab, the selected tabs, a window or a tab group to sleep. It comes back on time, with a notification.</p>
    <p>Later today, tonight, tomorrow, the weekend, next week, or a time you pick.</p>`);
}

// The popup page as it draws, at its real size (380 px wide).
async function popupPicture(popup) {
  return {
    png: await popup.locator('body').screenshot(),
    ...await popup.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight })),
  };
}

// A picture of the popup beside a short caption, on Huddle's ground.
async function composeWithPopup(context, name, popup, caption) {
  const frame = await context.newPage();
  await showFrame(frame, name.replace('.png', ''), framePage(`
    <div class="wrap">
      <div class="copy">
        <div class="brand">${mark}<span>Huddle</span></div>
        ${caption}
      </div>
      <img class="popup" src="data:image/png;base64,${popup.png.toString('base64')}" width="${popup.w}" height="${popup.h}" alt="">
    </div>`, `
    body { background: var(--bg); }
    .wrap { display: flex; align-items: center; justify-content: center; gap: 72px; height: 100%; }
    .copy { width: 380px; }
    .brand { display: flex; align-items: center; gap: 10px; font: 700 20px var(--ui); margin-bottom: 26px; }
    .brand svg { width: 34px; height: 34px; }
    h1 { font: 700 34px/1.15 var(--ui); letter-spacing: -.02em; margin: 0 0 14px; }
    p { font: 17px/1.5 var(--ui); color: var(--tx-dim); margin: 0 0 14px; }
    kbd { font: 600 14px var(--mono); background: var(--kbd-bg); color: var(--kbd-tx); border-radius: 5px; padding: 2px 7px; }
    .popup { border-radius: 10px; border: 1px solid var(--bd-hi); box-shadow: var(--shadow-float); background: var(--panel); }`));
  await settle(frame);
  save(name, await frame.screenshot());
  await frame.close();
}

// (3) The nap room with a few sleeping tabs.
async function napRoomShot(context, ext) {
  const page = await context.newPage();
  await page.goto(ext('nap-room.html'));
  await page.locator('main').waitFor();
  await settle(page);
  await fitsOnScreen(page);
  save('3-nap-room.png', await page.screenshot());
  await page.close();
}

// (4) Open links as tabs on a reading list: the hint, and a drag under way.
async function openLinksShot(context, sw) {
  const page = await context.newPage();
  await page.goto('https://reading.example.com/weekend');
  await settle(page);
  // Huddle's toolbar button over this tab grants activeTab, as a click would
  // (DevTools' Extensions.triggerAction); the worker then starts it there,
  // as the shortcut does.
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
  const target = targetInfos.find((t) => t.type === 'tab' && t.url === page.url());
  await cdp.send('Extensions.triggerAction', { id: new URL(sw.url()).host, targetId: target.targetId });
  await cdp.detach();
  const reply = await sw.evaluate(async (url) => armClumper((await chrome.tabs.query({ url }))[0].id), page.url());
  if (!reply.success) throw new Error(`Open links as tabs did not start: ${JSON.stringify(reply)}`);
  // Hold Z and drag over four links while the hint is still up (3 s).
  await page.locator('[data-jdf-tab-huddle="open-links-hint"]').evaluate((host) => new Promise((resolve) => {
    const check = () => (host.shadowRoot.querySelector('.hint.shown') ? resolve() : setTimeout(check, 20));
    check();
  }));
  const links = page.locator('main a');
  const first = await links.nth(1).boundingBox();
  const last = await links.nth(4).boundingBox();
  await page.keyboard.down('z');
  await page.mouse.move(first.x - 30, first.y - 14);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width + 60, last.y + last.height + 26, { steps: 4 });
  const hintUp = await page.locator('[data-jdf-tab-huddle="open-links-hint"]').evaluate((host) => {
    const box = host.shadowRoot && host.shadowRoot.querySelector('.hint');
    return !!box && box.classList.contains('shown');
  });
  if (!hintUp) throw new Error('the hint went before the screenshot (the machine may be too busy); run again');
  save('4-open-links-as-tabs.png', await page.screenshot());
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('z');
  await page.close();
}

// The 440 x 280 small promo tile: the mark and the name on Chrome blue.
async function promoTile(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 352, height: 224 });
  await showFrame(page, 'promo', framePage(`<div class="tile">${mark}<div><div class="name">Huddle</div><div class="tag">Organize your browser tabs</div></div></div>`, `
    body { background: #1a73e8; }
    .tile { display: flex; align-items: center; justify-content: center; gap: 18px; height: 100%; color: #fff; }
    .tile svg { width: 84px; height: 84px; }
    .name { font: 700 40px/1 var(--ui); letter-spacing: -.02em; }
    .tag { font: 500 15px/1.3 var(--ui); margin-top: 8px; opacity: .92; }`));
  await settle(page);
  save('promo-small-440x280.png', await page.screenshot(), [440, 280]);
  await page.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
