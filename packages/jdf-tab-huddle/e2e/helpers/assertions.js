import { expect } from '@playwright/test';

/**
 * Poll until a condition on tabs is met, or timeout.
 */
export async function waitForCondition(fn, timeout = 5000, interval = 150) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw lastError || new Error('waitForCondition timed out');
}

/**
 * Wait for expected number of windows.
 */
export async function waitForWindowCount(sw, expectedCount, timeout = 5000) {
  return waitForCondition(async () => {
    const windows = await sw.evaluate(async () => {
      return (await chrome.windows.getAll()).length;
    });
    if (windows === expectedCount) return true;
    throw new Error(`Expected ${expectedCount} windows, got ${windows}`);
  }, timeout);
}

/**
 * Wait for expected number of tabs in a window.
 */
export async function waitForTabCount(sw, windowId, expectedCount, timeout = 5000) {
  return waitForCondition(async () => {
    const count = await sw.evaluate(async (wid) => {
      return (await chrome.tabs.query({ windowId: wid })).length;
    }, windowId);
    if (count === expectedCount) return true;
    throw new Error(`Expected ${expectedCount} tabs in window ${windowId}, got ${count}`);
  }, timeout);
}

/**
 * Wait for expected number of "domain" windows — i.e. windows that don't
 * contain the extension's popup or confirmation-dialog page. Several
 * operations (extract all domains, etc.) are triggered via a fire-and-forget
 * popup click or a detached `handler(args, () => {})` invocation with no
 * promise for the test to await, so the only reliable signal that the
 * operation has finished is the actual window layout settling into its
 * expected shape.
 */
export async function waitForDomainWindowCount(sw, expectedCount, timeout = 10000) {
  return waitForCondition(async () => {
    const windows = await sw.evaluate(async () => {
      const wins = await chrome.windows.getAll({ populate: true });
      return wins.map(w => ({
        id: w.id,
        urls: w.tabs.map(t => t.url || t.pendingUrl || ''),
      }));
    });
    const domainWindows = windows.filter(w =>
      !w.urls.some(u => u.includes('popup.html') || u.includes('confirmation-dialog.html'))
    );
    if (domainWindows.length === expectedCount) return true;
    throw new Error(`Expected ${expectedCount} domain windows, got ${domainWindows.length}`);
  }, timeout);
}

/**
 * Poll until unpinned tab URLs in a window reach sorted order, or timeout.
 * Use this in place of a fixed sleep before asserting sort order when the
 * sort is triggered by a fire-and-forget popup click (no promise to await),
 * so the assertion doesn't race the background operation under load.
 */
export async function waitForSorted(sw, windowId, timeout = 10000) {
  return waitForCondition(async () => {
    const tabs = await sw.evaluate(async (wid) => {
      const tabs = await chrome.tabs.query({ windowId: wid });
      return tabs
        .sort((a, b) => a.index - b.index)
        .filter(t => !t.pinned)
        .map(t => t.pendingUrl || t.url);
    }, windowId);
    const sorted = [...tabs].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(tabs) === JSON.stringify(sorted)) return true;
    throw new Error(`Tabs in window ${windowId} not yet sorted: ${JSON.stringify(tabs)}`);
  }, timeout);
}

/**
 * Assert that unpinned tab URLs in a window are in sorted order.
 */
export async function assertTabsSorted(sw, windowId) {
  const tabs = await sw.evaluate(async (wid) => {
    const tabs = await chrome.tabs.query({ windowId: wid });
    return tabs
      .sort((a, b) => a.index - b.index)
      .filter(t => !t.pinned)
      .map(t => t.pendingUrl || t.url);
  }, windowId);

  const sorted = [...tabs].sort((a, b) => a.localeCompare(b));
  expect(tabs).toEqual(sorted);
}

/**
 * Assert unpinned tab URLs in a window match an expected list (in order).
 */
export async function assertTabUrls(sw, windowId, expectedUrls) {
  const urls = await sw.evaluate(async (wid) => {
    const tabs = await chrome.tabs.query({ windowId: wid });
    return tabs
      .sort((a, b) => a.index - b.index)
      .filter(t => !t.pinned)
      .map(t => t.pendingUrl || t.url);
  }, windowId);

  expect(urls).toEqual(expectedUrls);
}

/**
 * Assert that pinned tabs in a window have the expected URLs (unordered).
 */
export async function assertPinnedTabUrls(sw, windowId, expectedUrls) {
  const urls = await sw.evaluate(async (wid) => {
    const tabs = await chrome.tabs.query({ windowId: wid });
    return tabs
      .filter(t => t.pinned)
      .sort((a, b) => a.index - b.index)
      .map(t => t.pendingUrl || t.url);
  }, windowId);

  expect(urls.sort()).toEqual([...expectedUrls].sort());
}

/**
 * Assert that no duplicate URLs exist among unpinned tabs in a window.
 */
export async function assertNoDuplicates(sw, windowId) {
  const urls = await sw.evaluate(async (wid) => {
    const tabs = await chrome.tabs.query({ windowId: wid });
    return tabs.filter(t => !t.pinned).map(t => t.pendingUrl || t.url);
  }, windowId);

  const unique = new Set(urls);
  expect(urls.length).toBe(unique.size);
}

/**
 * Get total tab count across all windows.
 */
export async function getTotalTabCount(sw) {
  return await sw.evaluate(async () => {
    return (await chrome.tabs.query({})).length;
  });
}
