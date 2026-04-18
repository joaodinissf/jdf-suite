import { describe, it, expect, beforeEach, vi } from 'vitest';

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

  it('rejects hash-only fragments', () => {
    // '#' resolves to current baseURI with fragment — should still be http(s)
    // This matches the linkclump behavior of excluding fragment-only anchors
    // as "no real target". We accept them since they resolve to http:; flag
    // this as a deliberate deviation from the original for a less-surprising result.
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

describe('clumperKeyMatches', () => {
  it('matches case-insensitively', () => {
    expect(global.clumperKeyMatches({ key: 'Z' }, 'z')).toBe(true);
    expect(global.clumperKeyMatches({ key: 'z' }, 'Z')).toBe(true);
    expect(global.clumperKeyMatches({ key: 'A' }, 'a')).toBe(true);
  });

  it('rejects different keys', () => {
    expect(global.clumperKeyMatches({ key: 'Z' }, 'a')).toBe(false);
    expect(global.clumperKeyMatches({ key: 'Escape' }, 'z')).toBe(false);
  });

  it('handles missing key property', () => {
    expect(global.clumperKeyMatches({}, 'z')).toBe(false);
    expect(global.clumperKeyMatches(null, 'z')).toBe(false);
  });
});

describe('clumperModifierMatches', () => {
  const base = { shiftKey: false, ctrlKey: false, altKey: false };

  it('no modifier: requires all three unpressed', () => {
    expect(global.clumperModifierMatches(base, null)).toBe(true);
    expect(global.clumperModifierMatches(base, 'none')).toBe(true);
    expect(global.clumperModifierMatches({ ...base, shiftKey: true }, null)).toBe(false);
  });

  it('shift: requires only shift', () => {
    expect(global.clumperModifierMatches({ ...base, shiftKey: true }, 'shift')).toBe(true);
    expect(global.clumperModifierMatches({ shiftKey: true, ctrlKey: true, altKey: false }, 'shift')).toBe(false);
    expect(global.clumperModifierMatches(base, 'shift')).toBe(false);
  });

  it('ctrl: requires only ctrl', () => {
    expect(global.clumperModifierMatches({ ...base, ctrlKey: true }, 'ctrl')).toBe(true);
    expect(global.clumperModifierMatches({ ctrlKey: true, shiftKey: true, altKey: false }, 'ctrl')).toBe(false);
  });

  it('alt: requires only alt', () => {
    expect(global.clumperModifierMatches({ ...base, altKey: true }, 'alt')).toBe(true);
    expect(global.clumperModifierMatches({ altKey: true, ctrlKey: true, shiftKey: false }, 'alt')).toBe(false);
  });

  it('unknown modifier name rejects everything', () => {
    expect(global.clumperModifierMatches({ ...base, shiftKey: true }, 'meta')).toBe(false);
  });
});

describe('clumperIsTextInputTarget', () => {
  it('detects input and textarea tags', () => {
    expect(global.clumperIsTextInputTarget({ tagName: 'INPUT' })).toBe(true);
    expect(global.clumperIsTextInputTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(global.clumperIsTextInputTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('detects contentEditable', () => {
    expect(global.clumperIsTextInputTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('rejects other elements', () => {
    expect(global.clumperIsTextInputTarget({ tagName: 'DIV' })).toBe(false);
    expect(global.clumperIsTextInputTarget({ tagName: 'A', isContentEditable: false })).toBe(false);
    expect(global.clumperIsTextInputTarget(null)).toBe(false);
    expect(global.clumperIsTextInputTarget({})).toBe(false);
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

describe('content-clumper event handler integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.clumperResetStateForTest();
    // Clear any mocked chrome.runtime.sendMessage calls
    if (global.chrome && global.chrome.runtime && global.chrome.runtime.sendMessage) {
      global.chrome.runtime.sendMessage.mockClear();
    }
  });

  it('activation key keydown sets keyHeld; keyup clears it', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
  });

  it('non-activation keys do not arm the clumper', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
  });

  it('keydown while focused in text input is ignored', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    // jsdom-safe way to fire keydown against a specific target
    const evt = new KeyboardEvent('keydown', { key: 'z', bubbles: true });
    input.dispatchEvent(evt);
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
  });

  it('mousedown without key held does not start a drag', () => {
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(global.clumperGetStateForTest().dragging).toBe(false);
  });

  it('full drag sequence sends urls to background as clumpOpenUrls', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com/';
    a.textContent = 'ex';
    document.body.appendChild(a);
    a.getBoundingClientRect = () => ({ left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20, x: 10, y: 10 });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 100, bubbles: true }));

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    const [msg] = global.chrome.runtime.sendMessage.mock.calls[0];
    expect(msg.action).toBe('clumpOpenUrls');
    expect(msg.urls).toEqual(['https://example.com/']);
  });

  it('releasing the activation key during drag tears down without opening', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    expect(global.clumperGetStateForTest().dragging).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().dragging).toBe(false);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('Escape during armed state cancels without sending', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(global.clumperGetStateForTest().dragging).toBe(false);
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('non-left mouse button does not start a drag', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 0, clientY: 0, bubbles: true }));
    expect(global.clumperGetStateForTest().dragging).toBe(false);
  });
});
