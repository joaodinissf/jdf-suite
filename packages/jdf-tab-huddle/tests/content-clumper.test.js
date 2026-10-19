import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { contentSender, popupSender } from './senders.js';

describe('clumperIsOpenableUrl', () => {
  it('accepts absolute http and https URLs', () => {
    expect(global.clumperIsOpenableUrl('http://example.com/page')).toBe(true);
    expect(global.clumperIsOpenableUrl('https://example.com/page')).toBe(true);
    expect(global.clumperIsOpenableUrl('https://example.com/a?b=c#d')).toBe(true);
  });

  it('accepts relative URLs when they resolve to http(s) against baseURI', () => {
    // jsdom default baseURI is http://localhost/
    expect(global.clumperIsOpenableUrl('/relative/path')).toBe(true);
    expect(global.clumperIsOpenableUrl('relative-without-slash')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(global.clumperIsOpenableUrl('mailto:x@y.com')).toBe(false);
    expect(global.clumperIsOpenableUrl('tel:+1234567890')).toBe(false);
    expect(global.clumperIsOpenableUrl('javascript:void(0)')).toBe(false);
    expect(global.clumperIsOpenableUrl('data:text/plain;base64,SGVsbG8=')).toBe(false);
    expect(global.clumperIsOpenableUrl('file:///etc/hosts')).toBe(false);
    expect(global.clumperIsOpenableUrl('ftp://example.com/file')).toBe(false);
  });

  it('rejects empty / null / malformed input', () => {
    expect(global.clumperIsOpenableUrl('')).toBe(false);
    expect(global.clumperIsOpenableUrl(null)).toBe(false);
    expect(global.clumperIsOpenableUrl(undefined)).toBe(false);
  });

  it('accepts hash-only fragments', () => {
    // '#' resolves against the page's own http(s) URL, so it is accepted. The
    // original linkclump skipped fragment-only anchors; Huddle deliberately
    // does not.
    expect(global.clumperIsOpenableUrl('#')).toBe(true);
  });
});

describe('clumperRectsOverlap', () => {
  const make = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });

  it('detects fully-contained overlap', () => {
    expect(global.clumperRectsOverlap(make(0, 0, 100, 100), make(10, 10, 20, 20))).toBe(true);
  });

  it('detects partial overlap on any edge', () => {
    const center = make(50, 50, 100, 100);
    expect(global.clumperRectsOverlap(center, make(0, 0, 60, 60))).toBe(true); // top-left
    expect(global.clumperRectsOverlap(center, make(80, 0, 150, 60))).toBe(true); // top-right
    expect(global.clumperRectsOverlap(center, make(0, 80, 60, 150))).toBe(true); // bottom-left
    expect(global.clumperRectsOverlap(center, make(80, 80, 150, 150))).toBe(true); // bottom-right
  });

  it('rejects fully disjoint rects', () => {
    expect(global.clumperRectsOverlap(make(0, 0, 10, 10), make(20, 20, 30, 30))).toBe(false);
    expect(global.clumperRectsOverlap(make(0, 0, 10, 10), make(11, 0, 20, 10))).toBe(false);
  });

  it('rejects touching-but-not-overlapping rects (strict inequality)', () => {
    // Edges that are exactly equal count as not overlapping
    expect(global.clumperRectsOverlap(make(0, 0, 10, 10), make(10, 0, 20, 10))).toBe(false);
  });
});

describe('clumperBoxFromPoints', () => {
  it('normalizes forward drags', () => {
    expect(global.clumperBoxFromPoints({ x: 10, y: 20 }, { x: 30, y: 40 })).toEqual({
      left: 10, top: 20, right: 30, bottom: 40,
    });
  });

  it('normalizes backward drags (end before start)', () => {
    expect(global.clumperBoxFromPoints({ x: 30, y: 40 }, { x: 10, y: 20 })).toEqual({
      left: 10, top: 20, right: 30, bottom: 40,
    });
  });

  it('handles mixed-direction drags', () => {
    expect(global.clumperBoxFromPoints({ x: 30, y: 10 }, { x: 10, y: 40 })).toEqual({
      left: 10, top: 10, right: 30, bottom: 40,
    });
  });

  it('handles zero-sized drags', () => {
    expect(global.clumperBoxFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      left: 5, top: 5, right: 5, bottom: 5,
    });
  });
});

describe('clumperCollectUrlsInRect', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Reset any leftover state from previous event-handler tests
    if (typeof global.clumperResetStateForTest === 'function') {
      global.clumperResetStateForTest();
    }
  });

  // Helper: create a link at an absolute position using inline style.
  // jsdom's getBoundingClientRect returns zeroed values for most elements, so
  // we stub it on each anchor to simulate real layout.
  const makeLink = (href, rect) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = href;
    document.body.appendChild(a);
    a.getBoundingClientRect = () => ({
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.right - rect.left, height: rect.bottom - rect.top,
      x: rect.left, y: rect.top,
    });
    return a;
  };

  it('returns links whose bounding box overlaps the selection', () => {
    makeLink('https://a.com/', { left: 10, top: 10, right: 20, bottom: 20 });
    makeLink('https://b.com/', { left: 100, top: 100, right: 200, bottom: 200 });
    const rect = { left: 0, top: 0, right: 50, bottom: 50 };
    const urls = global.clumperCollectUrlsInRect(rect);
    expect(urls).toEqual(['https://a.com/']);
  });

  it('skips non-http(s) URLs', () => {
    makeLink('mailto:x@y.com', { left: 0, top: 0, right: 10, bottom: 10 });
    makeLink('javascript:void(0)', { left: 0, top: 0, right: 10, bottom: 10 });
    makeLink('https://ok.com/', { left: 0, top: 0, right: 10, bottom: 10 });
    const urls = global.clumperCollectUrlsInRect({ left: 0, top: 0, right: 100, bottom: 100 });
    expect(urls).toEqual(['https://ok.com/']);
  });

  it('de-duplicates exact URL matches, preserving first-seen order', () => {
    makeLink('https://dup.com/', { left: 10, top: 10, right: 20, bottom: 20 });
    makeLink('https://other.com/', { left: 30, top: 10, right: 40, bottom: 20 });
    makeLink('https://dup.com/', { left: 50, top: 10, right: 60, bottom: 20 });
    const urls = global.clumperCollectUrlsInRect({ left: 0, top: 0, right: 100, bottom: 100 });
    expect(urls).toEqual(['https://dup.com/', 'https://other.com/']);
  });

  it('returns empty array when no links in rect', () => {
    makeLink('https://a.com/', { left: 200, top: 200, right: 300, bottom: 300 });
    const urls = global.clumperCollectUrlsInRect({ left: 0, top: 0, right: 10, bottom: 10 });
    expect(urls).toEqual([]);
  });

  it('returns empty when document has no links', () => {
    const urls = global.clumperCollectUrlsInRect({ left: 0, top: 0, right: 1000, bottom: 1000 });
    expect(urls).toEqual([]);
  });
});

// Drag helpers: links laid out in a column, 20 px apart, from y = 0.
function placeLinks(n, host = 'site.example') {
  const links = [];
  for (let i = 0; i < n; i++) {
    const a = document.createElement('a');
    a.href = `https://${host}/p${i}`;
    a.textContent = `p${i}`;
    document.body.appendChild(a);
    const top = i * 20;
    a.getBoundingClientRect = () => ({ left: 10, top, right: 60, bottom: top + 10, width: 50, height: 10, x: 10, y: top });
    links.push(a.href);
  }
  return links;
}
// What the worker's start (the shortcut, or the popup) runs on a page that
// already has the clumper.
const start = () => globalThis.huddleOpenLinksStart();
const mouse = (type, x, y, init = {}) => {
  const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
};
function drag(from = { x: 0, y: 0 }, to = { x: 100, y: 5000 }) {
  const down = mouse('mousedown', from.x, from.y);
  mouse('mousemove', to.x, to.y);
  const up = mouse('mouseup', to.x, to.y);
  return { down, up };
}
const sentUrls = () => global.chrome.runtime.sendMessage.mock.calls.map(([m]) => m.urls);
const state = () => global.clumperGetStateForTest();

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.userSelect = '';
  global.clumperResetStateForTest();
  global.chrome.runtime.sendMessage.mockClear();
});
afterEach(() => {
  global.clumperHideHint();
  global.clumperResetStateForTest();
  global.clumperTrustAllEventsForTest(true);
});

describe('starting it arms the page for one drag', () => {
  it('injecting the script arms it at once: a crosshair, no text selection, and the hint', () => {
    expect(global.clumperStateAtLoad).toMatchObject({ armed: true, dragging: false, crosshair: true, userSelect: 'none', hint: true });
  });

  it('before it is started, a drag does nothing', () => {
    placeLinks(3);
    const { down } = drag();
    expect(state().dragging).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('the crosshair is Huddle\'s own, dark in a white outline, centred, with the system\'s as the fallback', () => {
    start();
    const css = document.querySelector('style[data-jdf-tab-huddle="clumper-cursor"]').textContent;
    const [, svg, x, y] = css.match(/cursor: url\("data:image\/svg\+xml,([^"]+)"\) (\d+) (\d+), crosshair !important;/);
    expect([x, y]).toEqual(['12', '12']);
    const image = new window.DOMParser().parseFromString(decodeURIComponent(svg), 'image/svg+xml').documentElement;
    expect([image.getAttribute('width'), image.getAttribute('height')]).toEqual(['24', '24']);
    expect([...image.querySelectorAll('path')].map((path) => path.getAttribute('stroke'))).toEqual(['#fff', '#1b1d22']);
  });

  it('a plain drag, with no key held, opens the links it covers and puts the page back', () => {
    const links = placeLinks(3);
    start();
    expect(state()).toMatchObject({ armed: true, crosshair: true });
    expect(document.querySelector('style[data-jdf-tab-huddle="clumper-cursor"]').textContent).toMatch(/crosshair/);
    expect(document.body.style.userSelect).toBe('none');

    drag();
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const [msg] = global.chrome.runtime.sendMessage.mock.calls[0];
    expect(msg).toEqual({ action: 'clumpOpenUrls', urls: links });
    expect(state()).toMatchObject({ armed: false, dragging: false, hasSelectionBox: false, highlightCount: 0, crosshair: false });
    expect(document.querySelector('style[data-jdf-tab-huddle="clumper-cursor"]')).toBeNull();
    expect(document.body.style.userSelect).toBe('');
  });

  it('a second drag after that does nothing, until it is started again', () => {
    placeLinks(3);
    start();
    drag();
    global.chrome.runtime.sendMessage.mockClear();
    const { down } = drag();
    expect(down.defaultPrevented).toBe(false);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

    start();
    expect(state()).toMatchObject({ armed: true, crosshair: true });
    drag();
    expect(sentUrls()).toHaveLength(1);
  });

  it('starting it again while armed keeps one crosshair and gives the page\'s own selection style back after', () => {
    document.body.style.userSelect = 'text';
    start();
    start();
    expect(document.querySelectorAll('style[data-jdf-tab-huddle="clumper-cursor"]')).toHaveLength(1);
    drag();
    expect(document.body.style.userSelect).toBe('text');
  });

  it('a click without a drag (under 4 px either way) opens nothing and puts the page back', () => {
    placeLinks(3);
    start();
    drag({ x: 12, y: 2 }, { x: 15, y: 5 });
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ armed: false, crosshair: false });
    expect(document.body.style.userSelect).toBe('');
  });

  it('a drag of 4 px is a drag', () => {
    const links = placeLinks(3);
    start();
    drag({ x: 12, y: 2 }, { x: 16, y: 2 });
    expect(sentUrls()).toEqual([[links[0]]]);
  });

  it('Escape before the drag cancels it, and a drag then does nothing', () => {
    placeLinks(3);
    start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(state()).toMatchObject({ armed: false, crosshair: false });
    expect(document.body.style.userSelect).toBe('');
    drag();
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('Escape mid-drag cancels without sending', () => {
    placeLinks(3);
    start();
    mouse('mousedown', 0, 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(state()).toMatchObject({ armed: false, dragging: false, hasSelectionBox: false });
    mouse('mouseup', 100, 5000);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('a non-left mouse button does not start a drag', () => {
    start();
    mouse('mousedown', 0, 0, { button: 2 });
    expect(state()).toMatchObject({ armed: true, dragging: false });
  });
});

describe('the click that follows a drag does not reach the page', () => {
  it('is swallowed once, so a drag that ends on a link does not also follow it; the next click gets through', () => {
    placeLinks(1);
    const link = document.querySelector('a');
    const pageSaw = vi.fn((e) => e.preventDefault());
    link.addEventListener('click', pageSaw);
    start();
    drag({ x: 0, y: 0 }, { x: 20, y: 5 });
    expect(sentUrls()).toHaveLength(1);

    const first = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(pageSaw).not.toHaveBeenCalled();

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pageSaw).toHaveBeenCalledTimes(1);
  });

  it('a click without a drag is swallowed too: it only cancels', () => {
    placeLinks(1);
    const link = document.querySelector('a');
    const pageSaw = vi.fn((e) => e.preventDefault());
    link.addEventListener('click', pageSaw);
    start();
    drag({ x: 12, y: 2 }, { x: 12, y: 2 });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pageSaw).not.toHaveBeenCalled();
  });

  it('when no click comes, a later one is not swallowed', async () => {
    placeLinks(1);
    const link = document.querySelector('a');
    const pageSaw = vi.fn((e) => e.preventDefault());
    link.addEventListener('click', pageSaw);
    start();
    drag();
    await new Promise((resolve) => setTimeout(resolve, 0));
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pageSaw).toHaveBeenCalledTimes(1);
  });

  it('a click with no drag before it reaches the page', () => {
    placeLinks(1);
    const link = document.querySelector('a');
    const pageSaw = vi.fn((e) => e.preventDefault());
    link.addEventListener('click', pageSaw);
    start();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pageSaw).toHaveBeenCalledTimes(1);
  });
});

describe('the clumper acts only on the user\'s own input', () => {
  it('a page\'s own mousedown and mouseup (untrusted) open nothing, and it stays armed', () => {
    placeLinks(5);
    start();
    global.clumperTrustAllEventsForTest(false);
    const { down, up } = drag();
    expect(state()).toMatchObject({ armed: true, dragging: false });
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('a page\'s own Escape (untrusted) does not cancel it', () => {
    placeLinks(3);
    start();
    global.clumperTrustAllEventsForTest(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(state()).toMatchObject({ armed: true, crosshair: true });
  });

  it('a page\'s fake mouseup cannot end the user\'s real drag', () => {
    placeLinks(5);
    start();
    mouse('mousedown', 0, 0);
    global.clumperTrustAllEventsForTest(false);
    mouse('mouseup', 100, 5000);
    expect(state().dragging).toBe(true);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('a drag the mouse is released elsewhere from', () => {
  afterEach(() => {
    delete document.hidden;
  });

  it('the window losing focus mid-drag ends the drag, and the page stays armed for another', () => {
    const links = placeLinks(3);
    start();
    mouse('mousedown', 0, 0);
    window.dispatchEvent(new window.FocusEvent('blur'));
    expect(state()).toMatchObject({ armed: true, dragging: false, hasSelectionBox: false, crosshair: true });
    expect(document.body.style.userSelect).toBe('none');
    mouse('mouseup', 100, 5000);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    drag();
    expect(sentUrls()).toEqual([links]);
  });

  it('the tab being hidden mid-drag ends the drag; becoming visible does not', () => {
    start();
    mouse('mousedown', 0, 0);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(state().dragging).toBe(true);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(state()).toMatchObject({ armed: true, dragging: false });
  });
});

describe('a copy of the clumper left behind by an extension update or reload', () => {
  let id;
  beforeEach(() => {
    id = global.chrome.runtime.id;
  });
  afterEach(() => {
    global.chrome.runtime.id = id;
  });

  it('armed before the update, its mousedown puts the page back and lets the page have it', () => {
    placeLinks(5);
    start();
    global.chrome.runtime.id = undefined;
    const { down, up } = drag();
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(state()).toMatchObject({ armed: false, dragging: false, crosshair: false });
    expect(document.body.style.userSelect).toBe('');
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('a big drag asks first and opens at most 25 links', () => {
  let confirmSpy;
  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm');
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('10 links open without asking', () => {
    const links = placeLinks(10);
    start();
    drag();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(sentUrls()).toEqual([links]);
  });

  it('11 links ask; Cancel opens nothing', () => {
    placeLinks(11);
    confirmSpy.mockReturnValue(false);
    start();
    drag();
    expect(confirmSpy).toHaveBeenCalledWith('Huddle: open 11 links?');
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('11 links ask; OK opens all 11', () => {
    const links = placeLinks(11);
    confirmSpy.mockReturnValue(true);
    start();
    drag();
    expect(sentUrls()).toEqual([links]);
  });

  it('40 links offer the first 25, and OK opens those 25', () => {
    const links = placeLinks(40);
    confirmSpy.mockReturnValue(true);
    start();
    drag();
    expect(confirmSpy).toHaveBeenCalledWith('Huddle: open the first 25 of 40 links?');
    expect(sentUrls()).toEqual([links.slice(0, 25)]);
  });

  it('the page is back to normal while the dialog is up, whatever the answer', () => {
    placeLinks(11);
    confirmSpy.mockImplementation(() => {
      expect(state()).toMatchObject({ armed: false, crosshair: false });
      expect(document.body.style.userSelect).toBe('');
      return false;
    });
    start();
    drag();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the worker opens clumped links only for a page\'s top frame', () => {
  const iframeSender = { ...contentSender, frameId: 2 };

  it('refuses a sender with no tab or in a subframe, and opens nothing', async () => {
    for (const sender of [popupSender, iframeSender, {}]) {
      expect(await dispatch({ action: 'clumpOpenUrls', urls: ['https://site.example/a'] }, sender))
        .toEqual({ success: false, error: 'forbidden' });
    }
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('opens only http and https links, and at most 25', async () => {
    const web = Array.from({ length: 30 }, (_, i) => `https://site.example/p${i}`);
    const urls = ['javascript:alert(1)', 'file:///etc/hosts', 'chrome://settings/', 'data:text/html,x', 42, 'HTTP://site.example/up', ...web];
    const reply = await dispatch({ action: 'clumpOpenUrls', urls }, contentSender);
    expect(reply).toEqual({ success: true, opened: 25 });
    const opened = chrome.tabs.create.mock.calls.map(([p]) => p.url);
    expect(opened).toEqual(['HTTP://site.example/up', ...web.slice(0, 24)]);
  });
});
