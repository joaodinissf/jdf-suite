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
