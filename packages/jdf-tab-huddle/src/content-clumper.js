// Link clumper — content script.
// Hold a key (default: Z) and click-drag a rectangle to collect every link
// inside it. On release, the selection is sent to the service worker which
// opens each link as a background tab adjacent to the current one.
//
// Clean-room implementation from a behavior spec; not derived from upstream
// linkclump source. See packages/jdf-tab-huddle/README.md for attribution.

// --- Configuration (read from chrome.storage.sync; defaults applied if unset) ---
const CLUMPER_DEFAULT_KEY = 'z';
const CLUMPER_DEFAULT_MODIFIER = null; // null | 'shift' | 'ctrl' | 'alt'
const CLUMPER_DEFAULT_ENABLED = true;

let clumperActivationKey = CLUMPER_DEFAULT_KEY;
let clumperActivationModifier = CLUMPER_DEFAULT_MODIFIER;
let clumperEnabled = CLUMPER_DEFAULT_ENABLED;

// --- Visual constants ---
const CLUMPER_COLOR = '#ff6600';
const CLUMPER_FILL = 'rgba(255, 102, 0, 0.1)';
const CLUMPER_LINK_HIGHLIGHT = 'rgba(255, 102, 0, 0.3)';
const CLUMPER_Z_INDEX = 2147483647;

// --- State ---
let clumperKeyHeld = false;
let clumperDragging = false;
let clumperDragStart = null; // {x, y} in page coords
let clumperSelectionBox = null; // DOM element or null
const clumperHighlightOverlays = []; // array of overlay DOM elements
let clumperHighlightContainer = null; // parent element holding all overlays
let clumperPrevBodyUserSelect = null; // saved value of document.body.style.userSelect while suppressed

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

function clumperKeyMatches(event, key) {
  return Boolean(event && event.key && key && event.key.toLowerCase() === key.toLowerCase());
}

function clumperModifierMatches(event, modifier) {
  if (!event) return false;
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

// --- Event handlers ---

function clumperHandleKeyDown(event) {
  if (!clumperEnabled) return;
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
  clumperKeyHeld = false;
  clumperTeardown();
}

function clumperHandleMouseDown(event) {
  if (!clumperEnabled) return;
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
  if (!clumperDragging || !clumperSelectionBox) return;
  if (event.button !== 0) return;
  const rect = clumperBoxFromPoints(clumperDragStart, { x: clumperPageX(event), y: clumperPageY(event) });
  const urls = clumperCollectUrlsInRect(rect);
  clumperTeardown();
  if (urls.length > 0 && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'clumpOpenUrls', urls });
  }
  event.preventDefault();
}

function clumperResetStateForTest() {
  clumperKeyHeld = false;
  clumperTeardown();
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
  clumperEnabled = typeof c.enabled === 'boolean' ? c.enabled : CLUMPER_DEFAULT_ENABLED;
  clumperActivationKey = typeof c.key === 'string' && c.key.length === 1
    ? c.key.toLowerCase()
    : CLUMPER_DEFAULT_KEY;
  clumperActivationModifier = c.modifier === 'shift' || c.modifier === 'ctrl' || c.modifier === 'alt'
    ? c.modifier
    : CLUMPER_DEFAULT_MODIFIER;
}

function clumperLoadSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
  chrome.storage.sync.get(['clumping'], (result) => {
    clumperApplySettings(result && result.clumping);
  });
}

// Register listeners. Capturing phase so we beat the page's own handlers.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', clumperHandleKeyDown, true);
  document.addEventListener('keyup', clumperHandleKeyUp, true);
  document.addEventListener('keydown', clumperHandleEscape, true);
  document.addEventListener('mousedown', clumperHandleMouseDown, true);
  document.addEventListener('mousemove', clumperHandleMouseMove, true);
  document.addEventListener('mouseup', clumperHandleMouseUp, true);
}

// Load settings once on startup, then keep them in sync with any subsequent
// changes made through the options page (or from another Chrome signin).
clumperLoadSettings();
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.clumping) return;
    clumperApplySettings(changes.clumping.newValue);
    // If the feature was just disabled or the key changed, abort any
    // in-flight drag to avoid a "zombie" armed state.
    if (clumperKeyHeld || clumperDragging) {
      clumperKeyHeld = false;
      clumperTeardown();
    }
  });
}
