import { test } from '../fixtures/extension.js';
import { expect } from '@playwright/test';
import { randomWindow } from '../helpers/random-window.js';

// Huddle up works out what Expand, Deduplicate and Compact would leave and
// changes only what differs. These tests build the same windows twice in real
// Chrome, with real pins, groups and Split Views, run the step-by-step version
// on one copy and the planned version on the other, and compare the results.
// Like the other Split View specs they skip below Chrome 155; run them with
// PW_EXECUTABLE pointing at a Chrome for Testing 155+ build.
test.beforeEach(async ({ sw }) => {
  const supported = await sw.evaluate(() =>
    typeof chrome.tabs.createSplit === 'function' && typeof chrome.tabs.unsplit === 'function');
  test.skip(!supported, 'chrome.tabs.createSplit/unsplit unavailable (needs Chrome 155+)');
});

// Builds a window from tab specs (see random-window.js) and returns its id.
// Pages are data: URLs carrying the spec's address, so nothing is fetched.
function buildWindow(sw, spec) {
  return sw.evaluate(async (spec) => {
    const page = (t) => `data:text/html,${t.url}`;
    const win = await chrome.windows.create({ url: page(spec[0]), focused: false });
    const ids = [win.tabs[0].id];
    for (const t of spec.slice(1)) ids.push((await chrome.tabs.create({ windowId: win.id, url: page(t), active: false })).id);
    for (let i = 0; i < spec.length; i++) if (spec[i].pinned) await chrome.tabs.update(ids[i], { pinned: true });
    const groups = new Map();
    spec.forEach((t, i) => {
      if (t.groupId === undefined || t.groupId === -1) return;
      if (!groups.has(t.groupId)) groups.set(t.groupId, []);
      groups.get(t.groupId).push(ids[i]);
    });
    for (const tabIds of groups.values()) await chrome.tabs.group({ tabIds, createProperties: { windowId: win.id } });
    const splits = new Map();
    spec.forEach((t, i) => {
      if (t.splitViewId === undefined) return;
      if (!splits.has(t.splitViewId)) splits.set(t.splitViewId, []);
      splits.get(t.splitViewId).push(ids[i]);
    });
    for (const pair of splits.values()) await chrome.tabs.createSplit(pair);
    // Every page has its address before Huddle up reads the window.
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({ windowId: win.id });
      if (tabs.every((t) => t.status === 'complete' && !t.pendingUrl)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return win.id;
  }, spec);
}

// The window independent of tab, group and split ids: each tab's page,
// pinned state, group (numbered by first appearance) and split partner's page.
function snapshot(sw, windowId) {
  return sw.evaluate(async (windowId) => {
    const tabs = await chrome.tabs.query({ windowId });
    const groupNumber = new Map();
    return tabs.map((t) => {
      if (t.groupId !== -1 && !groupNumber.has(t.groupId)) groupNumber.set(t.groupId, groupNumber.size);
      const partner = t.splitViewId != null && t.splitViewId !== -1
        ? tabs.find((o) => o.id !== t.id && o.splitViewId === t.splitViewId) : null;
      return [t.url, t.pinned, t.groupId === -1 ? null : groupNumber.get(t.groupId), partner ? partner.url : null];
    });
  }, windowId);
}

// Runs one version on a window, counting the changes it asks Chrome for (a
// batch move counts each tab it moves) and whether the planned version had
// to fall back to the steps.
function runHuddleUp(sw, windowId, respectGroups, planned) {
  return sw.evaluate(async ({ windowId, respectGroups, planned }) => {
    const changes = {};
    const originals = {};
    for (const name of ['remove', 'move', 'unsplit', 'createSplit', 'group', 'ungroup']) {
      originals[name] = chrome.tabs[name];
      chrome.tabs[name] = (...args) => {
        changes[name] = (changes[name] || 0) + (Array.isArray(args[0]) && name === 'move' ? args[0].length : 1);
        return originals[name].apply(chrome.tabs, args);
      };
    }
    const warn = console.warn;
    let fellBack = 0;
    console.warn = (...args) => { fellBack++; warn(...args); };
    const started = performance.now();
    try {
      const result = planned ? await huddleUpFromPlan(windowId, respectGroups) : await huddleUpStepByStep(windowId, respectGroups);
      return { result, changes, fellBack, ms: Math.round(performance.now() - started) };
    } finally {
      Object.assign(chrome.tabs, originals);
      console.warn = warn;
    }
  }, { windowId, respectGroups, planned });
}

const closeWindow = (sw, windowId) => sw.evaluate((id) => chrome.windows.remove(id), windowId);

for (const respectGroups of [true, false]) {
  test(`1${respectGroups ? 'a' : 'b'}: on random windows the planned version ends exactly as the step-by-step one, without falling back (${respectGroups ? 'Groups' : 'Flat'})`, async ({ sw }) => {
    test.setTimeout(600000);
    const totals = { steps: 0, planned: 0, stepsMs: 0, plannedMs: 0 };
    for (let seed = 1; seed <= 25; seed++) {
      // Flat mode on a window with groups takes the step-by-step path.
      const spec = randomWindow(seed).map((t) => (respectGroups ? t : { ...t, groupId: -1 }));
      const reference = await buildWindow(sw, spec);
      const before = await snapshot(sw, reference);
      const steps = await runHuddleUp(sw, reference, respectGroups, false);
      const expected = await snapshot(sw, reference);
      await closeWindow(sw, reference);

      const copy = await buildWindow(sw, spec);
      expect({ seed, window: await snapshot(sw, copy) }).toEqual({ seed, window: before });
      const planned = await runHuddleUp(sw, copy, respectGroups, true);
      const actual = await snapshot(sw, copy);
      await closeWindow(sw, copy);

      expect({ seed, window: actual }).toEqual({ seed, window: expected });
      expect({ seed, fellBack: planned.fellBack, failed: planned.result.failed }).toEqual({ seed, fellBack: 0, failed: 0 });
      const count = (c) => Object.values(c).reduce((a, b) => a + b, 0);
      totals.steps += count(steps.changes);
      totals.planned += count(planned.changes);
      totals.stepsMs += steps.ms;
      totals.plannedMs += planned.ms;
    }
    console.log(`Huddle up on 25 random windows (${respectGroups ? 'Groups' : 'Flat'}): step by step ${totals.steps} changes in ${totals.stepsMs} ms; planned ${totals.planned} changes in ${totals.plannedMs} ms`);
    expect(totals.planned).toBeLessThan(totals.steps);
  });
}

test('2: a large huddled window is left alone, and a few new tabs move on their own', async ({ sw }) => {
  test.setTimeout(120000);
  const page = (i) => ({ url: `https://p.test/${String(i).padStart(3, '0')}` });
  const huddled = [...Array(60).keys()].map(page);
  huddled.forEach((t, i) => { t.splitViewId = Math.floor(i / 2) + 1; });
  const windowId = await buildWindow(sw, huddled);

  const again = await runHuddleUp(sw, windowId, true, true);
  expect(again.changes).toEqual({});
  expect(again.result).toEqual({ removed: 0, paired: 30, failed: 0, sortFailed: false });

  // Three new pages at the end, each belonging in the middle.
  await sw.evaluate(async (windowId) => {
    for (const n of ['010x', '030x', '050x']) {
      await chrome.tabs.create({ windowId, url: `data:text/html,https://p.test/${n}`, active: false });
    }
  }, windowId);
  const added = await runHuddleUp(sw, windowId, true, true);
  expect(added.fellBack).toBe(0);
  expect(added.changes.move).toBe(3);
  const after = await snapshot(sw, windowId);
  expect(after.map(([url]) => url)).toEqual([...after.map(([url]) => url)].sort());
  expect(after.filter(([, , , partner]) => partner === null)).toHaveLength(1);
  await closeWindow(sw, windowId);
});
