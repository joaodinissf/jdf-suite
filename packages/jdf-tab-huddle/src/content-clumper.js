// Open links as tabs: the link clumper.
// Hold a key (default: Z) and click-drag a rectangle to collect every link
// inside it. On release, the selection is sent to the service worker which
// opens each link as a background tab adjacent to the current one.
//
// The worker injects this script into one page when the user starts Open
// links as tabs there (the shortcut or the popup), through activeTab. It
// stays until the page reloads or the tab moves to another page.
//
// Clean-room implementation from a behavior spec; not derived from upstream
// linkclump source. See packages/jdf-tab-huddle/README.md for attribution.

// --- Configuration (read from chrome.storage.sync; defaults applied if unset) ---
const CLUMPER_DEFAULT_KEY = 'z';
const CLUMPER_DEFAULT_MODIFIER = null; // null | 'shift' | 'ctrl' | 'alt'

let clumperActivationKey = CLUMPER_DEFAULT_KEY;
let clumperActivationModifier = CLUMPER_DEFAULT_MODIFIER;

// --- Visual constants ---
const CLUMPER_COLOR = '#ff6600';
const CLUMPER_FILL = 'rgba(255, 102, 0, 0.1)';
const CLUMPER_LINK_HIGHLIGHT = 'rgba(255, 102, 0, 0.3)';
const CLUMPER_Z_INDEX = 2147483647;

// How long the "hold Z and drag" hint stays up.
const CLUMPER_HINT_MS = 3000;

// --- State ---
let clumperKeyHeld = false;
let clumperDragging = false;
let clumperDragStart = null; // {x, y} in page coords
let clumperSelectionBox = null; // DOM element or null
const clumperHighlightOverlays = []; // array of overlay DOM elements
let clumperHighlightContainer = null; // parent element holding all overlays
let clumperPrevBodyUserSelect = null; // saved value of document.body.style.userSelect while suppressed

// A page can dispatch its own key and mouse events, and they reach this
// script's listeners too; only the user's own input is trusted. Page scripts
// can't reach this isolated world, so the tests can swap this function out
// (jsdom's events are never trusted) without giving a page a way around it.
let clumperEventIsTrusted = (event) => event.isTrusted;

// Above this many links a drag asks first, and it never opens more than
// CLUMPER_MAX_URLS.
const CLUMPER_CONFIRM_ABOVE = 10;
const CLUMPER_MAX_URLS = 25;

// --- Pure helpers ---

function clumperIsOpenableUrl(href) {
  if (!href) return false;
  try {
    const u = new URL(href, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function clumperRectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function clumperBoxFromPoints(p1, p2) {
  return {
    left: Math.min(p1.x, p2.x),
    top: Math.min(p1.y, p2.y),
    right: Math.max(p1.x, p2.x),
    bottom: Math.max(p1.y, p2.y),
  };
}

// Compute page coords from clientX/clientY + scroll offset. Equivalent to
// event.pageX/pageY in real browsers, but works in jsdom (which doesn't
// populate pageX/pageY on synthetic MouseEvents).
function clumperPageX(event) {
  if (typeof event.pageX === 'number' && event.pageX !== 0) return event.pageX;
  const cx = typeof event.clientX === 'number' ? event.clientX : 0;
  const sx = typeof window !== 'undefined' ? window.pageXOffset || 0 : 0;
  return cx + sx;
}

function clumperPageY(event) {
  if (typeof event.pageY === 'number' && event.pageY !== 0) return event.pageY;
  const cy = typeof event.clientY === 'number' ? event.clientY : 0;
  const sy = typeof window !== 'undefined' ? window.pageYOffset || 0 : 0;
  return cy + sy;
}

// Match the character first, so the labelled key works on any layout (on
// AZERTY the key labelled A sends code KeyQ). Shift and Option change the
// character (Shift+1 reports '!', macOS Option+Z reports 'Ω'), so only then
// fall back to the physical key (event.code: KeyZ / Digit1).
function clumperKeyMatches(event, key) {
  if (!event || !key) return false;
  const k = key.toLowerCase();
  if (event.key && event.key.toLowerCase() === k) return true;
  if (!event.code || !(event.shiftKey || event.altKey)) return false;
  return event.code === (/^[0-9]$/.test(k) ? 'Digit' + k : 'Key' + k.toUpperCase());
}

function clumperModifierMatches(event, modifier) {
  if (!event) return false;
  // Cmd+Z is undo. macOS also sends no keyup for a key released while Cmd is
  // held, so arming here would leave the clumper stuck on.
  if (event.metaKey) return false;
  const shift = Boolean(event.shiftKey);
  const ctrl = Boolean(event.ctrlKey);
  const alt = Boolean(event.altKey);
  switch (modifier) {
    case null:
    case undefined:
    case '':
    case 'none':
      return !shift && !ctrl && !alt;
    case 'shift':
      return shift && !ctrl && !alt;
    case 'ctrl':
      return ctrl && !shift && !alt;
    case 'alt':
      return alt && !shift && !ctrl;
    default:
      return false;
  }
}

function clumperPageRectOf(element) {
  const r = element.getBoundingClientRect();
  const sx = typeof window !== 'undefined' ? window.pageXOffset || 0 : 0;
  const sy = typeof window !== 'undefined' ? window.pageYOffset || 0 : 0;
  return {
    left: r.left + sx,
    top: r.top + sy,
    right: r.right + sx,
    bottom: r.bottom + sy,
  };
}

function clumperCollectUrlsInRect(selRect, root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return [];
  const links = doc.querySelectorAll('a[href]');
  const urls = [];
  const seen = new Set();
  for (const link of links) {
    const rawHref = link.getAttribute('href');
    if (!clumperIsOpenableUrl(rawHref)) continue;
    const pageRect = clumperPageRectOf(link);
    if (!clumperRectsOverlap(pageRect, selRect)) continue;
    // Canonicalize via URL constructor to match anchor.href behavior
    const canonical = new URL(rawHref, doc.baseURI).href;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    urls.push(canonical);
  }
  return urls;
}

function clumperIsTextInputTarget(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

// --- DOM helpers ---

function clumperCreateSelectionBox() {
  const box = document.createElement('div');
  box.setAttribute('data-jdf-tab-huddle', 'clumper-box');
  const s = box.style;
  s.position = 'absolute';
  s.pointerEvents = 'none';
  s.border = `2px solid ${CLUMPER_COLOR}`;
  s.background = CLUMPER_FILL;
  s.zIndex = String(CLUMPER_Z_INDEX);
  s.boxSizing = 'border-box';
  s.left = '0px';
  s.top = '0px';
  s.width = '0px';
  s.height = '0px';
  document.body.appendChild(box);
  return box;
}

function clumperUpdateSelectionBox(box, rect) {
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${Math.max(0, rect.right - rect.left)}px`;
  box.style.height = `${Math.max(0, rect.bottom - rect.top)}px`;
}

function clumperEnsureHighlightContainer() {
  if (clumperHighlightContainer && clumperHighlightContainer.isConnected) {
    return clumperHighlightContainer;
  }
  const container = document.createElement('div');
  container.setAttribute('data-jdf-tab-huddle', 'clumper-highlights');
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.left = '0';
  container.style.pointerEvents = 'none';
  container.style.zIndex = String(CLUMPER_Z_INDEX - 1);
  document.body.appendChild(container);
  clumperHighlightContainer = container;
  return container;
}

function clumperClearHighlights() {
  for (const overlay of clumperHighlightOverlays) {
    overlay.remove();
  }
  clumperHighlightOverlays.length = 0;
  if (clumperHighlightContainer) {
    clumperHighlightContainer.remove();
    clumperHighlightContainer = null;
  }
}

function clumperHighlightLinksInRect(selRect) {
  clumperClearHighlights();
  const links = document.querySelectorAll('a[href]');
  const container = clumperEnsureHighlightContainer();
  for (const link of links) {
    if (!clumperIsOpenableUrl(link.getAttribute('href'))) continue;
    const pageRect = clumperPageRectOf(link);
    if (!clumperRectsOverlap(pageRect, selRect)) continue;
    // Draw an overlay rather than styling the link itself. This works
    // even when the link wraps opaque children (like BBC article cards
    // with images) that would hide a backgroundColor set on the anchor,
    // and survives any site CSS with `outline: none !important` on links.
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.left = `${pageRect.left}px`;
    overlay.style.top = `${pageRect.top}px`;
    overlay.style.width = `${Math.max(0, pageRect.right - pageRect.left)}px`;
    overlay.style.height = `${Math.max(0, pageRect.bottom - pageRect.top)}px`;
    overlay.style.backgroundColor = CLUMPER_LINK_HIGHLIGHT;
    overlay.style.outline = `2px solid ${CLUMPER_COLOR}`;
    overlay.style.boxSizing = 'border-box';
    container.appendChild(overlay);
    clumperHighlightOverlays.push(overlay);
  }
}

function clumperSuppressTextSelection() {
  if (typeof document === 'undefined' || !document.body) return;
  if (clumperPrevBodyUserSelect !== null) return; // already suppressed
  clumperPrevBodyUserSelect = document.body.style.userSelect || '';
  document.body.style.userSelect = 'none';
}

function clumperRestoreTextSelection() {
  if (clumperPrevBodyUserSelect === null) return; // nothing to restore
  if (typeof document === 'undefined' || !document.body) return;
  document.body.style.userSelect = clumperPrevBodyUserSelect;
  clumperPrevBodyUserSelect = null;
}

function clumperTeardown() {
  clumperDragging = false;
  clumperDragStart = null;
  if (clumperSelectionBox) {
    clumperSelectionBox.remove();
    clumperSelectionBox = null;
  }
  clumperClearHighlights();
  clumperRestoreTextSelection();
}

// Lets go of the key as far as the clumper knows: for when its keyup can't
// arrive (the window lost focus, the tab was hidden) or Escape was pressed.
function clumperDisarm() {
  clumperKeyHeld = false;
  clumperTeardown();
}

// --- Event handlers ---

function clumperHandleKeyDown(event) {
  if (!clumperEventIsTrusted(event)) return;
  // After the extension is updated or reloaded, this copy can no longer open
  // tabs, so it never arms.
  if (!chrome.runtime?.id) return;
  if (clumperKeyHeld) return;
  if (clumperIsTextInputTarget(event.target)) return;
  if (!clumperKeyMatches(event, clumperActivationKey)) return;
  if (!clumperModifierMatches(event, clumperActivationModifier)) return;
  clumperKeyHeld = true;
  clumperSuppressTextSelection();
}

function clumperHandleKeyUp(event) {
  if (!clumperKeyMatches(event, clumperActivationKey)) return;
  clumperKeyHeld = false;
  if (clumperDragging) {
    clumperTeardown();
  } else {
    // Key released without a drag — still need to restore page's selection CSS
    clumperRestoreTextSelection();
  }
}

function clumperHandleEscape(event) {
  if (event.key !== 'Escape') return;
  if (!clumperKeyHeld && !clumperDragging) return;
  clumperDisarm();
}

function clumperHandleMouseDown(event) {
  if (!clumperEventIsTrusted(event)) return;
  if (!chrome.runtime?.id) return;
  if (!clumperKeyHeld) return;
  if (event.button !== 0) return;
  clumperDragging = true;
  clumperDragStart = { x: clumperPageX(event), y: clumperPageY(event) };
  clumperSelectionBox = clumperCreateSelectionBox();
  clumperUpdateSelectionBox(clumperSelectionBox, clumperBoxFromPoints(clumperDragStart, clumperDragStart));
  event.preventDefault();
}

function clumperHandleMouseMove(event) {
  if (!clumperDragging || !clumperSelectionBox) return;
  const rect = clumperBoxFromPoints(clumperDragStart, { x: clumperPageX(event), y: clumperPageY(event) });
  clumperUpdateSelectionBox(clumperSelectionBox, rect);
  clumperHighlightLinksInRect(rect);
  event.preventDefault();
}

function clumperHandleMouseUp(event) {
  if (!clumperEventIsTrusted(event)) return;
  if (!clumperDragging || !clumperSelectionBox) return;
  if (event.button !== 0) return;
  event.preventDefault();
  const rect = clumperBoxFromPoints(clumperDragStart, { x: clumperPageX(event), y: clumperPageY(event) });
  let urls = clumperCollectUrlsInRect(rect);
  clumperTeardown();
  if (urls.length > CLUMPER_CONFIRM_ABOVE) {
    // The key is let go while the dialog is up, and that keyup never reaches
    // the page.
    clumperKeyHeld = false;
    // The browser's own dialog: a page can't click it or answer it.
    const question = urls.length > CLUMPER_MAX_URLS
      ? `Huddle: open the first ${CLUMPER_MAX_URLS} of ${urls.length} links?`
      : `Huddle: open ${urls.length} links?`;
    if (!window.confirm(question)) return;
    urls = urls.slice(0, CLUMPER_MAX_URLS);
  }
  if (urls.length > 0 && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'clumpOpenUrls', urls });
  }
}

function clumperResetStateForTest() {
  clumperDisarm();
}

function clumperGetStateForTest() {
  return {
    keyHeld: clumperKeyHeld,
    dragging: clumperDragging,
    dragStart: clumperDragStart,
    hasSelectionBox: Boolean(clumperSelectionBox),
    highlightCount: clumperHighlightOverlays.length,
  };
}

function clumperApplySettings(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  clumperActivationKey = typeof c.key === 'string' && c.key.length === 1
    ? c.key.toLowerCase()
    : CLUMPER_DEFAULT_KEY;
  clumperActivationModifier = c.modifier === 'shift' || c.modifier === 'ctrl' || c.modifier === 'alt'
    ? c.modifier
    : CLUMPER_DEFAULT_MODIFIER;
}

function clumperLoadSettings(then) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
  chrome.storage.sync.get(['clumping'], (result) => {
    clumperApplySettings(result && result.clumping);
    if (then) then();
  });
}

// --- The hint: "hold Z and drag" ---
// A small notice at the bottom centre of the page, drawn like the popup's
// toasts, in a shadow root so the page's CSS can't restyle it. It never takes
// focus or clicks, is announced politely, goes after CLUMPER_HINT_MS, and
// Escape puts it away sooner. The extension's fonts can't load in a web page
// (Huddle exposes no web_accessible_resources), so it uses the system's.

let clumperHintHost = null;
let clumperHintAgain = false;
let clumperHintTimers = [];

const CLUMPER_HINT_CSS = `
  .hint {
    --panel: #eef1f6; --bd: #c5cad3; --tx: #1b1d22; --kbd-bg: #e6e9ef; --kbd-tx: #3c4043;
    --shadow: 0 8px 22px rgba(28, 36, 52, .22), 0 1px 3px rgba(28, 36, 52, .12);
    box-sizing: border-box;
    max-width: min(560px, calc(100vw - 32px));
    padding: 9px 13px;
    border: 1px solid var(--bd);
    border-radius: 10px;
    background: var(--panel);
    color: var(--tx);
    box-shadow: var(--shadow);
    font: 400 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    text-align: center;
    overflow-wrap: anywhere;
    opacity: 0;
  }
  .hint.shown { opacity: 1; }
  b { font-weight: 700; }
  kbd {
    display: inline-block;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--kbd-bg);
    color: var(--kbd-tx);
    font: 600 12px/1.5 ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    .hint {
      --panel: #2d3036; --bd: #454952; --tx: #eceef2; --kbd-bg: rgba(255, 255, 255, .10); --kbd-tx: #dfe2e7;
      --shadow: 0 10px 26px rgba(0, 0, 0, .7), 0 0 0 1px rgba(255, 255, 255, .07);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .hint { transform: translateY(6px); transition: opacity 160ms ease-out, transform 160ms ease-out; }
    .hint.shown { transform: none; }
  }
`;

// "Z", or "Shift+Z" with a modifier.
function clumperKeyLabel() {
  const modifier = { shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt' }[clumperActivationModifier];
  const key = clumperActivationKey.toUpperCase();
  return modifier ? `${modifier}+${key}` : key;
}

function clumperHintText(again) {
  return again
    ? ['Huddle is already on: hold ', ' and drag over links to open them as tabs.']
    : ['Huddle: hold ', ' and drag over links to open them as tabs. On until this page reloads.'];
}

function clumperHideHint() {
  for (const t of clumperHintTimers) clearTimeout(t);
  clumperHintTimers = [];
  document.removeEventListener('keydown', clumperHintEscape, true);
  if (clumperHintHost) clumperHintHost.remove();
  clumperHintHost = null;
}

// Escape puts the hint away. The page still gets the key.
function clumperHintEscape(event) {
  if (event.key === 'Escape') clumperHideHint();
}

function clumperShowHint(again = false) {
  clumperHideHint();
  clumperHintAgain = again;
  const host = document.createElement('div');
  host.setAttribute('data-jdf-tab-huddle', 'open-links-hint');
  // Inline !important beats any page rule, so the page can't move or hide it.
  host.style.cssText = [
    'all: initial', 'position: fixed', 'left: 0', 'right: 0', 'bottom: 24px', 'display: flex',
    'justify-content: center', 'padding: 0 16px', 'pointer-events: none', `z-index: ${CLUMPER_Z_INDEX}`,
  ].map((rule) => `${rule} !important`).join('; ');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CLUMPER_HINT_CSS;
  const box = document.createElement('div');
  box.className = 'hint';
  box.setAttribute('role', 'status');
  root.append(style, box);
  (document.body || document.documentElement).appendChild(host);
  clumperHintHost = host;
  document.addEventListener('keydown', clumperHintEscape, true);

  // Filled once the live region is in the page, so a screen reader announces it.
  const [before, after] = clumperHintText(again);
  clumperHintTimers.push(setTimeout(() => {
    const key = document.createElement('kbd');
    key.textContent = clumperKeyLabel();
    box.append(before, key, after);
    clumperHintTimers.push(setTimeout(() => box.classList.add('shown'), 20));
  }, 50));
  clumperHintTimers.push(setTimeout(clumperHideHint, CLUMPER_HINT_MS));
}

// Register listeners. Capturing phase so we beat the page's own handlers.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', clumperHandleKeyDown, true);
  document.addEventListener('keyup', clumperHandleKeyUp, true);
  document.addEventListener('keydown', clumperHandleEscape, true);
  document.addEventListener('mousedown', clumperHandleMouseDown, true);
  document.addEventListener('mousemove', clumperHandleMouseMove, true);
  document.addEventListener('mouseup', clumperHandleMouseUp, true);
  // The key's keyup goes elsewhere when it is released in another window, tab
  // or frame.
  window.addEventListener('blur', clumperDisarm);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clumperDisarm();
  });
}

// Load the key from Settings, then say how to use it. A second start can
// already have shown "already on" (with the default key) before the settings
// arrive; that hint is then redrawn with the right key, not replaced. Keep the
// key in sync with any later change made in Settings (or from another Chrome
// signin).
clumperLoadSettings(() => clumperShowHint(Boolean(clumperHintHost) && clumperHintAgain));
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.clumping) return;
    clumperApplySettings(changes.clumping.newValue);
    // The old key's keyup would no longer match, so let go of a held key or
    // a drag in flight rather than leave it stuck.
    if (clumperKeyHeld || clumperDragging) clumperDisarm();
  });
}

// The worker's check before injecting finds this, and shows the hint again
// rather than loading a second copy (see armClumper in background.js).
globalThis.huddleOpenLinksHint = clumperShowHint;
