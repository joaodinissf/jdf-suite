import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Open links as tabs: the worker starts the link clumper in one tab when the
// user asks (the open-links shortcut, or the popup's action), through
// activeTab, instead of a content script on every site. Globals come from
// tests/setup.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(__dirname, '../src', file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

const RESTRICTED = "Chrome doesn't let extensions run on this page";
const NO_LINKS = 'There are no links to open on this page';

// The hint the clumper shows in the page, inside its shadow root.
const hintHost = () => document.querySelector('[data-jdf-tab-huddle="open-links-hint"]');
const hintStatus = () => hintHost() && hintHost().shadowRoot.querySelector('[role="status"]');

// chrome.scripting.executeScript as Chrome runs it in this (jsdom) page:
// `func` runs here in the page, and injecting content-clumper.js does what the
// script's last lines do (it is already loaded by tests/setup.js, so loading
// it again would add a second set of listeners). `fresh` starts on a page the
// clumper has not run in.
function scriptThisPage({ fresh = true } = {}) {
  const showHint = global.clumperShowHint;
  if (fresh) delete globalThis.huddleOpenLinksHint;
  chrome.scripting.executeScript.mockImplementation(async (details) => {
    if (details.func) return [{ frameId: 0, result: details.func() }];
    expect(details.files).toEqual(['content-clumper.js']);
    globalThis.huddleOpenLinksHint = showHint;
    showHint();
    return [{ frameId: 0, result: null }];
  });
}

function placeLinks(n) {
  document.body.innerHTML = Array.from({ length: n }, (_, i) => `<a href="https://site.example/${i}">link ${i}</a>`).join('');
}

beforeEach(() => {
  vi.useFakeTimers();
  global.clumperHideHint?.();
  global.clumperApplySettings({ key: 'z', modifier: null });
});

afterEach(() => {
  global.clumperHideHint?.();
  globalThis.huddleOpenLinksHint = global.clumperShowHint;
  chrome.scripting.executeScript.mockReset().mockResolvedValue([]);
  vi.useRealTimers();
});

describe('the shipped manifest', () => {
  test('asks for activeTab and scripting, and no access to every site', () => {
    expect(manifest.permissions).toEqual(['tabs', 'tabGroups', 'storage', 'alarms', 'notifications', 'scripting', 'activeTab', 'favicon']);
    expect(manifest).not.toHaveProperty('content_scripts');
  });

  test('asks for no site access at all, OpenRouter included: it answers CORS for any origin', () => {
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    expect(read('manifest.json')).not.toMatch(/openrouter|https?:\/\/|<all_urls>/i);
  });

  test('no longer asks for windows: chrome.windows needs no permission', () => {
    expect(manifest.permissions).not.toContain('windows');
    expect(read('background.js')).toMatch(/chrome\.windows\.getAll/);
  });

  test('has the open-links command, with a ChromeOS key that is not its system shortcut', () => {
    expect(manifest.commands['open-links']).toEqual({
      suggested_key: { default: 'Alt+Shift+L', mac: 'Alt+Shift+L', chromeos: 'Alt+Shift+K' },
      description: 'Open links on this page as tabs',
    });
    // Alt+Shift+L focuses the ChromeOS launcher, and Alt+Shift+U is Huddle's own.
    expect(manifest.commands['open-links'].suggested_key.chromeos).not.toMatch(/^(Alt\+Shift|Shift\+Alt)\+[LU]$/);
    expect(manifest.commands._execute_action.suggested_key).toEqual({ default: 'Alt+Shift+U', mac: 'Alt+Shift+U' });
  });
});

describe('the open-links shortcut', () => {
  test('starts the clumper in the tab the shortcut was pressed in', async () => {
    placeLinks(3);
    scriptThisPage();
    await Promise.all(chrome.commands.onCommand.callListeners('open-links', { id: 42, url: 'https://site.example/' }));
    expect(chrome.scripting.executeScript.mock.calls.map(([d]) => [d.target, d.files || 'check'])).toEqual([
      [{ tabId: 42 }, 'check'],
      [{ tabId: 42 }, ['content-clumper.js']],
    ]);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  test('ignores any other command', async () => {
    await Promise.all(chrome.commands.onCommand.callListeners('something-else', { id: 42 }));
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test.each([
    ['chrome://', 'Cannot access a chrome:// URL'],
    ['another extension', 'Cannot access a chrome-extension:// URL of different extension'],
    ['the Web Store', 'The extensions gallery cannot be scripted.'],
    ['file: without access', 'Cannot access contents of url "file:///Users/me/a.html". Extension manifest must request permission to access this host.'],
  ])('on %s, the toolbar button says Chrome keeps extensions out, then goes back to normal', async (_page, message) => {
    chrome.scripting.executeScript.mockRejectedValue(new Error(message));
    await Promise.all(chrome.commands.onCommand.callListeners('open-links', { id: 7 }));
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({ tabId: 7, title: `Huddle: ${RESTRICTED}` });
    vi.advanceTimersByTime(OPEN_LINKS_BADGE_MS);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({ tabId: 7, title: 'Huddle' });
  });

  test('a refusal in a second tab does not leave the first tab stuck on "!"', async () => {
    chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    await Promise.all(chrome.commands.onCommand.callListeners('open-links', { id: 7 }));
    vi.advanceTimersByTime(OPEN_LINKS_BADGE_MS / 2);
    await Promise.all(chrome.commands.onCommand.callListeners('open-links', { id: 9 }));
    vi.advanceTimersByTime(OPEN_LINKS_BADGE_MS);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({ tabId: 7, title: 'Huddle' });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 9, text: '' });
  });

  test('on a PDF, the toolbar button says there are no links to open', async () => {
    chrome.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { already: false, contentType: 'application/pdf', links: 0 } }]);
    await Promise.all(chrome.commands.onCommand.callListeners('open-links', { id: 8 }));
    expect(chrome.action.setTitle).toHaveBeenCalledWith({ tabId: 8, title: `Huddle: ${NO_LINKS}` });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
});

describe('armClumper', () => {
  test('a page with links gets the clumper and its hint', async () => {
    placeLinks(3);
    scriptThisPage();
    expect(await armClumper(5)).toEqual({ success: true, already: false });
    vi.advanceTimersByTime(100);
    expect(hintStatus().textContent).toBe('Huddle: hold Z and drag over links to open them as tabs. On until this page reloads.');
  });

  test('starting it twice shows the hint again, loads one copy, and is no error', async () => {
    placeLinks(3);
    scriptThisPage();
    expect(await armClumper(5)).toEqual({ success: true, already: false });
    vi.advanceTimersByTime(3000);
    expect(hintHost()).toBeNull();

    expect(await armClumper(5)).toEqual({ success: true, already: true });
    vi.advanceTimersByTime(100);
    expect(hintStatus().textContent).toBe('Huddle is already on: hold Z and drag over links to open them as tabs.');
    expect(chrome.scripting.executeScript.mock.calls.filter(([d]) => d.files)).toHaveLength(1);
    expect(document.querySelectorAll('[data-jdf-tab-huddle="open-links-hint"]')).toHaveLength(1);
  });

  test.each([
    ['a PDF', { already: false, contentType: 'application/pdf', links: 0 }],
    ['a page with no links', { already: false, contentType: 'text/html', links: 0 }],
    ['a plain-text file', { already: false, contentType: 'text/plain', links: 0 }],
    ['an image', { already: false, contentType: 'image/png', links: 0 }],
  ])('on %s there is nothing to open, and nothing is injected', async (_page, result) => {
    chrome.scripting.executeScript.mockResolvedValue([{ frameId: 0, result }]);
    expect(await armClumper(5)).toEqual({ success: false, reason: NO_LINKS });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  test('the check runs in the page and reports what it found', () => {
    placeLinks(4);
    delete globalThis.huddleOpenLinksHint;
    expect(openLinksPageCheck()).toEqual({ already: false, contentType: 'text/html', links: 4 });
  });

  test('a page Chrome won\'t script, or a check with no result, is refused with the reason', async () => {
    chrome.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access a chrome:// URL'));
    expect(await armClumper(5)).toEqual({ success: false, reason: RESTRICTED });
    chrome.scripting.executeScript.mockResolvedValueOnce([]);
    expect(await armClumper(5)).toEqual({ success: false, reason: RESTRICTED });
  });
});

describe('the popup\'s Open links as tabs', () => {
  const html = read('popup.html');
  let close;

  beforeEach(() => {
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
    close = vi.spyOn(window, 'close').mockImplementation(() => {});
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (callback) callback({ success: true, already: false });
      return Promise.resolve();
    });
  });

  afterEach(() => {
    close?.mockRestore();
    chrome.runtime.sendMessage.mockReset();
    chrome.tabs.query.mockReset();
  });

  async function openPopupOver(url) {
    chrome.tabs.query.mockResolvedValue([{ id: 31, url, active: true }]);
    await initOpenLinks();
    return document.getElementById('openLinks');
  }

  test('sits in the footer next to Settings, styled like it, with the hotkey K', () => {
    const button = document.getElementById('openLinks');
    expect(button.textContent.trim()).toBe('Open links as tabs');
    expect(button.className).toBe('gear');
    expect(button.parentElement).toBe(document.getElementById('openOptions').parentElement);
    expect(button.closest('.foot')).not.toBeNull();
    expect(buildHotkeyMap().get('k')).toBe(button);
    expect(buildHotkeyMap().get('i')?.id).toBe('openOptions');
  });

  test('sends the tab it was opened over, then closes so the page\'s hint shows', async () => {
    const button = await openPopupOver('https://site.example/');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    button.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'openLinksAsTabs', tabId: 31 }, expect.any(Function));
    expect(close).toHaveBeenCalled();
  });

  test('the K hotkey does the same', async () => {
    await openPopupOver('https://site.example/');
    refreshHotkeys();
    handleHotkeyKeydown(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true }));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'openLinksAsTabs', tabId: 31 }, expect.any(Function));
  });

  test('when the worker finds nothing to open, the popup stays open and says why', async () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback({ success: false, reason: NO_LINKS });
      return Promise.resolve();
    });
    (await openPopupOver('https://site.example/report.pdf')).click();
    expect(close).not.toHaveBeenCalled();
    const result = document.getElementById('actionResult');
    expect(result.hidden).toBe(false);
    expect(result.textContent).toBe(NO_LINKS);
    expect(result.classList.contains('error')).toBe(false);
  });

  test.each([
    'chrome://settings/',
    'chrome-extension://other/page.html',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore/detail/x',
    'about:blank',
    'file:///Users/me/a.html',
  ])('over %s it is aria-disabled with the reason, and pressing it says so without asking the worker', async (url) => {
    const button = await openPopupOver(url);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-description')).toBe(RESTRICTED);
    expect(button.title).toBe(RESTRICTED);
    button.click();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'openLinksAsTabs' }), expect.anything());
    expect(document.getElementById('actionResult').textContent).toBe(RESTRICTED);
    expect(close).not.toHaveBeenCalled();
  });

  test('a file: page is allowed once Huddle may read file URLs', async () => {
    chrome.extension.isAllowedFileSchemeAccess.mockResolvedValueOnce(true);
    const button = await openPopupOver('file:///Users/me/a.html');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  test('the footer shows both shortcuts as Chrome has bound them', () => {
    showOpenShortcut();
    expect(document.getElementById('openShortcut').hidden).toBe(false);
    expect(document.getElementById('openLinksShortcut').textContent).toBe('⌥⇧L for links');
    expect(document.getElementById('openPopupShortcut').textContent).toBe('⌥⇧U to open');
  });

  test('with no open-links shortcut, the footer says where to set one', async () => {
    chrome.commands.getAll.mockImplementationOnce((callback) => callback([
      { name: '_execute_action', shortcut: '⌥⇧U' }, { name: 'open-links', shortcut: '' },
    ]));
    showOpenShortcut();
    expect(document.getElementById('openLinksShortcut').textContent).toBe('Set a shortcut at chrome://extensions/shortcuts');
    const button = await openPopupOver('https://site.example/');
    expect(button.title).toBe('Set a shortcut at chrome://extensions/shortcuts');
  });
});

describe('the page\'s hint', () => {
  beforeEach(() => {
    placeLinks(2);
  });

  test('is a polite status in a shadow root, fixed at the bottom, that takes no clicks or focus', () => {
    const focused = document.activeElement;
    global.clumperShowHint();
    const host = hintHost();
    expect(host.style.getPropertyValue('position')).toBe('fixed');
    expect(host.style.getPropertyPriority('position')).toBe('important');
    expect(host.style.getPropertyValue('pointer-events')).toBe('none');
    expect(host.shadowRoot).not.toBeNull();
    // Announced: the live region is in the page before its text arrives.
    expect(hintStatus().getAttribute('role')).toBe('status');
    expect(hintStatus().textContent).toBe('');
    vi.advanceTimersByTime(100);
    expect(hintStatus().textContent).not.toBe('');
    expect(document.activeElement).toBe(focused);
  });

  test('shows the configured key as a key badge', () => {
    global.clumperApplySettings({ key: 'q', modifier: 'shift' });
    global.clumperShowHint();
    vi.advanceTimersByTime(100);
    expect(hintStatus().querySelector('kbd').textContent).toBe('Shift+Q');
  });

  test('goes after about 3 seconds', () => {
    global.clumperShowHint();
    vi.advanceTimersByTime(2900);
    expect(hintHost()).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(hintHost()).toBeNull();
  });

  test('Escape puts it away early, and the page still gets the key', () => {
    global.clumperShowHint();
    const pageSaw = vi.fn();
    document.addEventListener('keydown', pageSaw);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    document.removeEventListener('keydown', pageSaw);
    expect(hintHost()).toBeNull();
    expect(pageSaw).toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });

  test('uses Huddle\'s colours, not the old orange, and moves only when motion is welcome', () => {
    global.clumperShowHint();
    const css = hintHost().shadowRoot.querySelector('style').textContent;
    expect(css).not.toMatch(/ff6600/i);
    expect(css).toMatch(/--panel: #eef1f6/);
    expect(css).toMatch(/prefers-color-scheme: dark/);
    // The only transition is inside the no-preference block.
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(css.match(/transition/g)).toHaveLength(1);
    expect(motion).toMatch(/transition/);
  });
});
