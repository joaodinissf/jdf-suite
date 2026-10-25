import { seeded, randomWindow } from '../e2e/helpers/random-window.js';

// Split View: sort keeps pairs together and dedup keeps the split copy, which
// only needs the read-only splitViewId and must degrade to the old behavior
// when the property is absent. Compact/Expand create and remove splits and
// exist only where chrome.tabs.createSplit/unsplit do (Chrome 155+).

const t = (id, url, extra = {}) => ({ id, url, pinned: false, ...extra });

describe('tabSplitViewId', () => {
  test('null for tabs without the property (older Chrome)', () => {
    expect(tabSplitViewId(t(1, 'https://a.test'))).toBeNull();
  });

  test('null for the explicit not-split sentinel', () => {
    expect(tabSplitViewId(t(1, 'https://a.test', { splitViewId: -1 }))).toBeNull();
  });

  test('passes a real split id through', () => {
    expect(tabSplitViewId(t(1, 'https://a.test', { splitViewId: 7 }))).toBe(7);
  });
});

describe('sortTabsAsUnits', () => {
  test('plain tabs sort by URL exactly as before', () => {
    const tabs = [t(1, 'https://c.test'), t(2, 'https://a.test'), t(3, 'https://b.test')];
    expect(sortTabsAsUnits(tabs).map((x) => x.url)).toEqual([
      'https://a.test', 'https://b.test', 'https://c.test',
    ]);
  });

  test('a split pair sorts as one unit keyed by the left tab', () => {
    // Strip order: A(split), B(split), C, D — with C < A < D < B alphabetically.
    const tabs = [
      t(1, 'https://c.test', { splitViewId: 7 }),
      t(2, 'https://z.test', { splitViewId: 7 }),
      t(3, 'https://a.test'),
      t(4, 'https://m.test'),
    ];
    expect(sortTabsAsUnits(tabs).map((x) => x.url)).toEqual([
      'https://a.test',
      'https://c.test', // pair leader — keyed here, not at z
      'https://z.test', // right member rides along, order preserved
      'https://m.test',
    ]);
  });

  test('pair members stay in left-to-right strip order even when reversed alphabetically', () => {
    const tabs = [
      t(1, 'https://z.test', { splitViewId: 3 }),
      t(2, 'https://a.test', { splitViewId: 3 }),
      t(3, 'https://b.test'),
    ];
    // Pair keys at z, so the single b-tab sorts before the whole pair,
    // and z stays left of a inside it.
    expect(sortTabsAsUnits(tabs).map((x) => x.url)).toEqual([
      'https://b.test', 'https://z.test', 'https://a.test',
    ]);
  });

  test('two different pairs sort independently', () => {
    const tabs = [
      t(1, 'https://d.test', { splitViewId: 1 }),
      t(2, 'https://e.test', { splitViewId: 1 }),
      t(3, 'https://a.test', { splitViewId: 2 }),
      t(4, 'https://f.test', { splitViewId: 2 }),
    ];
    expect(sortTabsAsUnits(tabs).map((x) => x.id)).toEqual([3, 4, 1, 2]);
  });

  test('a lone member of a partitioned pair behaves as a plain tab', () => {
    // Only one member present (the other was pinned / in another group).
    const tabs = [t(1, 'https://c.test', { splitViewId: 9 }), t(2, 'https://a.test')];
    expect(sortTabsAsUnits(tabs).map((x) => x.url)).toEqual([
      'https://a.test', 'https://c.test',
    ]);
  });

  test('a loading tab sorts by the URL it is loading (pendingUrl)', () => {
    const tabs = [t(1, 'https://b.test'), t(2, 'https://z.test', { pendingUrl: 'https://a.test' })];
    expect(sortTabsAsUnits(tabs).map((x) => x.id)).toEqual([2, 1]);
  });

  test('sentinel splitViewId of -1 never pairs tabs', () => {
    const tabs = [
      t(1, 'https://c.test', { splitViewId: -1 }),
      t(2, 'https://a.test', { splitViewId: -1 }),
    ];
    expect(sortTabsAsUnits(tabs).map((x) => x.url)).toEqual([
      'https://a.test', 'https://c.test',
    ]);
  });
});

describe('sortWindowTabs keeps split pairs adjacent through the batch move', () => {
  beforeEach(() => {
    chrome.tabs.query.mockReset();
    chrome.tabs.move.mockReset();
    chrome.tabs.move.mockResolvedValue([]);
  });

  // URLs chosen so paired and unpaired orders differ: plain sort of
  // (c, z, d) is c,d,z — the pair keeps z glued to c instead.

  test('flat mode: move receives the pair adjacent, keyed by the left tab', async () => {
    chrome.tabs.query.mockResolvedValue([
      t(1, 'https://c.test', { splitViewId: 7 }),
      t(2, 'https://z.test', { splitViewId: 7 }),
      t(3, 'https://d.test'),
    ]);

    await sortWindowTabs(101, false);

    expect(chrome.tabs.move).toHaveBeenCalledWith([1, 2, 3], { index: 0 });
  });

  test('flat mode without splitViewId is unchanged from plain URL order', async () => {
    chrome.tabs.query.mockResolvedValue([
      t(1, 'https://c.test'),
      t(2, 'https://z.test'),
      t(3, 'https://d.test'),
    ]);

    await sortWindowTabs(101, false);

    expect(chrome.tabs.move).toHaveBeenCalledWith([1, 3, 2], { index: 0 });
  });
});

describe('findDuplicateTabs prefers keeping the Split View copy', () => {
  test('later split duplicate replaces the earlier plain keeper', () => {
    const tabs = [
      t(1, 'https://dup.test'),
      t(2, 'https://dup.test', { splitViewId: 5 }),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], false);
    expect(tabsToRemove).toEqual([1]);
  });

  test('earlier split keeper survives a later plain duplicate', () => {
    const tabs = [
      t(1, 'https://dup.test', { splitViewId: 5 }),
      t(2, 'https://dup.test'),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], false);
    expect(tabsToRemove).toEqual([2]);
  });

  test('both split: first occurrence wins, as for plain tabs', () => {
    const tabs = [
      t(1, 'https://dup.test', { splitViewId: 5 }),
      t(2, 'https://dup.test', { splitViewId: 6 }),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], false);
    expect(tabsToRemove).toEqual([2]);
  });

  test('a page split with itself is still deduplicated', () => {
    // Same URL as both halves of one split. The split preference chooses
    // which copy of a URL survives — it never changes whether a duplicate
    // is removed. Closing one half here loses nothing visible: the
    // surviving half shows the identical page.
    const tabs = [
      t(1, 'https://dup.test', { splitViewId: 5 }),
      t(2, 'https://dup.test', { splitViewId: 5 }),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], false);
    expect(tabsToRemove).toEqual([2]);
  });

  test('pinned still beats split: a pinned duplicate is never removed', () => {
    const tabs = [
      t(1, 'https://dup.test', { pinned: true }),
      t(2, 'https://dup.test', { splitViewId: 5 }),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], false);
    // The pinned tab is skipped entirely; the split tab is the first (and
    // only) non-pinned occurrence, so nothing is removed.
    expect(tabsToRemove).toEqual([]);
  });

  test('no splitViewId anywhere: identical result to the previous behavior', () => {
    const tabs = [
      t(1, 'https://dup.test'),
      t(2, 'https://dup.test'),
      t(3, 'https://other.test'),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], false);
    expect(tabsToRemove).toEqual([2]);
  });

  test('groups mode: swap happens within a group scope', () => {
    const tabs = [
      t(1, 'https://dup.test', { groupId: 10 }),
      t(2, 'https://dup.test', { groupId: 10, splitViewId: 4 }),
      // Same URL in a different group is not a duplicate — unchanged rule.
      t(3, 'https://dup.test', { groupId: 20 }),
    ];
    const { tabsToRemove } = findDuplicateTabs([tabs], true);
    expect(tabsToRemove).toEqual([1]);
  });
});

describe('planCompactPairs', () => {
  // Tabs as chrome.tabs.query returns them: index, pinned, groupId always set.
  const tab = (id, extra = {}) => ({ id, index: id, pinned: false, groupId: -1, splitViewId: -1, ...extra });

  test('pairs neighbours left to right', () => {
    expect(planCompactPairs([tab(0), tab(1), tab(2), tab(3)])).toEqual([[0, 1], [2, 3]]);
  });

  test('an odd last tab stays unpaired', () => {
    expect(planCompactPairs([tab(0), tab(1), tab(2)])).toEqual([[0, 1]]);
  });

  test('empty and single-tab windows produce no pairs', () => {
    expect(planCompactPairs([])).toEqual([]);
    expect(planCompactPairs([tab(0)])).toEqual([]);
  });

  test('never pairs across the pinned boundary', () => {
    const tabs = [tab(0, { pinned: true }), tab(1), tab(2)];
    expect(planCompactPairs(tabs)).toEqual([[1, 2]]);
  });

  test('never pairs across group boundaries, including loose-to-group', () => {
    const tabs = [
      tab(0), tab(1, { groupId: 7 }), tab(2, { groupId: 7 }),
      tab(3, { groupId: 8 }), tab(4, { groupId: 9 }), tab(5),
    ];
    expect(planCompactPairs(tabs)).toEqual([[1, 2]]);
  });

  test('an existing split breaks the run and is left alone', () => {
    const tabs = [
      tab(0), tab(1, { splitViewId: 5 }), tab(2, { splitViewId: 5 }), tab(3), tab(4),
    ];
    expect(planCompactPairs(tabs)).toEqual([[3, 4]]);
  });

  test('tabs without the splitViewId property count as unsplit', () => {
    const tabs = [{ id: 0, index: 0, pinned: false, groupId: -1 }, { id: 1, index: 1, pinned: false, groupId: -1 }];
    expect(planCompactPairs(tabs)).toEqual([[0, 1]]);
  });

  test('follows index order, not array order', () => {
    const tabs = [tab(9, { index: 2 }), tab(4, { index: 0 }), tab(6, { index: 1 })];
    expect(planCompactPairs(tabs)).toEqual([[4, 6]]);
  });
});

describe('Compact / Expand handlers', () => {
  const tab = (id, extra = {}) => ({ id, index: id, pinned: false, groupId: -1, splitViewId: -1, ...extra });

  afterEach(() => {
    delete chrome.tabs.createSplit;
    delete chrome.tabs.unsplit;
  });

  function withSplitApi() {
    chrome.tabs.createSplit = vi.fn().mockResolvedValue(1);
    chrome.tabs.unsplit = vi.fn().mockResolvedValue(undefined);
  }

  test('splitWriteSupported follows the presence of both methods', () => {
    expect(splitWriteSupported()).toBe(false);
    chrome.tabs.createSplit = vi.fn();
    expect(splitWriteSupported()).toBe(false);
    chrome.tabs.unsplit = vi.fn();
    expect(splitWriteSupported()).toBe(true);
  });

  test('Compact reports unsupported without touching tabs on older Chrome', async () => {
    chrome.tabs.query.mockResolvedValue([tab(0), tab(1)]);
    const sendResponse = vi.fn();
    await handleCompactWindow(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'unsupported' });
  });

  test('Compact splits each planned pair in order', async () => {
    withSplitApi();
    chrome.tabs.query.mockResolvedValue([tab(0), tab(1), tab(2), tab(3), tab(4)]);
    const sendResponse = vi.fn();
    await handleCompactWindow(sendResponse);
    expect(chrome.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
    expect(chrome.tabs.createSplit.mock.calls).toEqual([[[0, 1]], [[2, 3]]]);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, paired: 2, failed: 0 });
  });

  test('a rejected pair is counted and the rest still split', async () => {
    withSplitApi();
    chrome.tabs.createSplit
      .mockRejectedValueOnce(new Error('tab closed'))
      .mockResolvedValueOnce(2);
    chrome.tabs.query.mockResolvedValue([tab(0), tab(1), tab(2), tab(3)]);
    const sendResponse = vi.fn();
    await handleCompactWindow(sendResponse);
    expect(chrome.tabs.createSplit).toHaveBeenCalledTimes(2);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, paired: 1, failed: 1 });
  });

  test('Expand unsplits each split once', async () => {
    withSplitApi();
    chrome.tabs.query.mockResolvedValue([
      tab(0, { splitViewId: 5 }), tab(1, { splitViewId: 5 }),
      tab(2),
      tab(3, { splitViewId: 8 }), tab(4, { splitViewId: 8 }),
    ]);
    const sendResponse = vi.fn();
    await handleExpandWindow(sendResponse);
    expect(chrome.tabs.unsplit.mock.calls).toEqual([[5], [8]]);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, unsplit: 2, failed: 0 });
  });

  test('Expand reports unsupported on older Chrome', async () => {
    const sendResponse = vi.fn();
    await handleExpandWindow(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'unsupported' });
  });
});

// A window that behaves like Chrome's tab strip where Huddle up relies on it:
// moves land at Chrome's final index, moving a tab in a split dissolves that
// split, splits need two unsplit neighbours with the same pinned state and
// group, and closing a tab ends its split. Every change is logged.
function fakeStrip(spec) {
  let nextSplit = 100;
  let tabs = spec.map((t, i) => ({ id: i + 1, windowId: 1, pinned: false, groupId: -1, splitViewId: -1, ...t }));
  const log = [];
  const view = () => tabs.map((t, index) => ({ ...t, index }));
  const dissolve = (splitId) => { for (const t of tabs) if (t.splitViewId === splitId) t.splitViewId = -1; };
  const api = {
    query: vi.fn(async () => view()),
    get: vi.fn(async (id) => {
      const tab = view().find(t => t.id === id);
      if (!tab) throw new Error(`No tab ${id}`);
      return tab;
    }),
    remove: vi.fn(async (ids) => {
      log.push(['remove', [].concat(ids)]);
      for (const t of tabs) if ([].concat(ids).includes(t.id) && t.splitViewId !== -1) dissolve(t.splitViewId);
      tabs = tabs.filter(t => ![].concat(ids).includes(t.id));
    }),
    move: vi.fn(async (ids, { index }) => {
      const moving = [].concat(ids).map(id => tabs.find(t => t.id === id));
      log.push(['move', moving.map(t => t.id), index]);
      for (const t of moving) if (t.splitViewId !== -1) dissolve(t.splitViewId);
      tabs = tabs.filter(t => !moving.includes(t));
      tabs.splice(Math.min(index, tabs.length), 0, ...moving);
    }),
    unsplit: vi.fn(async (splitId) => {
      if (!tabs.some(t => t.splitViewId === splitId)) throw new Error(`No split ${splitId}`);
      log.push(['unsplit', splitId]);
      dissolve(splitId);
    }),
    createSplit: vi.fn(async ([left, right]) => {
      const a = tabs.findIndex(t => t.id === left);
      const b = tabs.findIndex(t => t.id === right);
      const [l, r] = [tabs[a], tabs[b]];
      if (b !== a + 1 || l.splitViewId !== -1 || r.splitViewId !== -1 || l.pinned !== r.pinned || l.groupId !== r.groupId) {
        throw new Error(`Cannot split ${left} and ${right}`);
      }
      log.push(['createSplit', [left, right]]);
      l.splitViewId = r.splitViewId = nextSplit++;
      return l.splitViewId;
    }),
  };
  // What the window looks like, independent of tab and split ids: each tab's
  // page, pinned state, group, and the page of the tab it is split with.
  const snapshot = () => tabs.map((t) => [t.url, t.pinned, t.groupId,
    t.splitViewId === -1 ? null : tabs.find(o => o !== t && o.splitViewId === t.splitViewId)?.url ?? null]);
  return { api, log, snapshot, tabs: () => tabs };
}

function useStrip(strip) {
  Object.assign(chrome.tabs, strip.api);
  chrome.tabGroups.query.mockResolvedValue([]);
}

// Runs an async step that waits on Huddle's settle() under fake timers.
async function withTimers(promise) {
  let done = false;
  promise.finally(() => { done = true; });
  while (!done) await vi.advanceTimersByTimeAsync(250);
  return promise;
}

describe('Huddle up', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete chrome.tabs.createSplit;
    delete chrome.tabs.unsplit;
  });

  test('step by step, it separates every split before closing a duplicate, and pairs only after the sort', async () => {
    const strip = fakeStrip([
      { url: 'https://b.test/', splitViewId: 5 }, { url: 'https://a.test/', splitViewId: 5 },
      { url: 'https://c.test/' }, { url: 'https://a.test/' }, { url: 'https://d.test/' },
    ]);
    useStrip(strip);
    const result = await withTimers(huddleUpStepByStep(1, false));
    const kinds = strip.log.map(([kind]) => kind);
    expect(kinds[0]).toBe('unsplit');
    expect(kinds.indexOf('remove')).toBeGreaterThan(0);
    expect(kinds.indexOf('createSplit')).toBeGreaterThan(kinds.lastIndexOf('move'));
    expect(strip.snapshot().map(([url]) => url)).toEqual(['https://a.test/', 'https://b.test/', 'https://c.test/', 'https://d.test/']);
    expect(result).toEqual({ removed: 1, paired: 2, failed: 0, sortFailed: false });
  });

  test.each([true, false])('it leaves every random window as the step-by-step version does, without falling back to it (Groups mode: %s)', async (respectGroups) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let compared = 0;
    let changed = 0;
    for (let seed = 1; seed <= 300; seed++) {
      // Flat mode on a window with groups takes the step-by-step path, so Flat
      // windows are compared without their groups.
      const spec = randomWindow(seed).map(t => (respectGroups ? t : { ...t, groupId: -1 }));
      const reference = fakeStrip(structuredClone(spec));
      useStrip(reference);
      await withTimers(huddleUpStepByStep(1, respectGroups));
      const planned = fakeStrip(structuredClone(spec));
      useStrip(planned);
      const result = await withTimers(huddleUpFromPlan(1, respectGroups));
      expect({ seed, window: planned.snapshot() }).toEqual({ seed, window: reference.snapshot() });
      expect({ seed, failed: result.failed, fellBack: warn.mock.calls.length }).toEqual({ seed, failed: 0, fellBack: 0 });
      compared++;
      if (planned.log.length > 0) changed++;
    }
    warn.mockRestore();
    // Most windows need real work; a few are already huddled.
    expect(compared).toBe(300);
    expect(changed).toBeGreaterThan(compared * 0.8);
  });

  test('a window that is already huddled is left alone: nothing closes, moves, separates or pairs', async () => {
    const strip = fakeStrip([
      { url: 'https://a.test/', splitViewId: 1 }, { url: 'https://b.test/', splitViewId: 1 },
      { url: 'https://c.test/', splitViewId: 2 }, { url: 'https://d.test/', splitViewId: 2 },
      { url: 'https://e.test/' },
    ]);
    useStrip(strip);
    const result = await huddleUpFromPlan(1, true);
    expect(strip.log).toEqual([]);
    expect(result).toEqual({ removed: 0, paired: 2, failed: 0, sortFailed: false });
  });

  test('a new tab moves on its own, and the pairs before it stay', async () => {
    const strip = fakeStrip([
      { url: 'https://a.test/', splitViewId: 1 }, { url: 'https://b.test/', splitViewId: 1 },
      { url: 'https://c.test/', splitViewId: 2 }, { url: 'https://d.test/', splitViewId: 2 },
      { url: 'https://e.test/', splitViewId: 3 }, { url: 'https://f.test/', splitViewId: 3 },
      { url: 'https://d.test/x' },
    ]);
    useStrip(strip);
    await huddleUpFromPlan(1, true);
    expect(strip.log.filter(([kind]) => kind === 'move')).toEqual([['move', [7], 4]]);
    // a=b and c=d stay; the pairs after d are made again around the new tab.
    expect(strip.log.filter(([kind]) => kind === 'unsplit')).toEqual([['unsplit', 3]]);
    expect(strip.snapshot().map(([url, , , partner]) => [url, partner])).toEqual([
      ['https://a.test/', 'https://b.test/'], ['https://b.test/', 'https://a.test/'],
      ['https://c.test/', 'https://d.test/'], ['https://d.test/', 'https://c.test/'],
      ['https://d.test/x', 'https://e.test/'], ['https://e.test/', 'https://d.test/x'],
      ['https://f.test/', null],
    ]);
  });

  test('when the window does not end as planned, it finishes step by step and still ends the same', async () => {
    const spec = [{ url: 'https://c.test/' }, { url: 'https://a.test/' }, { url: 'https://b.test/' }, { url: 'https://a.test/' }];
    const reference = fakeStrip(structuredClone(spec));
    useStrip(reference);
    await withTimers(huddleUpStepByStep(1, true));
    const strip = fakeStrip(structuredClone(spec));
    useStrip(strip);
    // Chrome ignores the first single-tab move.
    const move = strip.api.move;
    let first = true;
    chrome.tabs.move = vi.fn(async (ids, options) => {
      if (first && !Array.isArray(ids)) { first = false; return; }
      return move(ids, options);
    });
    await withTimers(huddleUpFromPlan(1, true));
    expect(strip.snapshot()).toEqual(reference.snapshot());
  });

  test('a split it cannot separate and a pair it cannot make are counted, and the rest still runs', async () => {
    const strip = fakeStrip([
      { url: 'https://b.test/', splitViewId: 5 }, { url: 'https://a.test/', splitViewId: 5 },
      { url: 'https://c.test/' }, { url: 'https://d.test/' },
    ]);
    useStrip(strip);
    chrome.tabs.createSplit.mockRejectedValueOnce(new Error('tab closed'));
    const result = await withTimers(huddleUpFromPlan(1, true));
    expect(result).toEqual(expect.objectContaining({ removed: 0, failed: 1, paired: 1 }));
  });

  test('Flat mode on a window with groups takes the step-by-step path', async () => {
    const strip = fakeStrip([{ url: 'https://b.test/', groupId: 10 }, { url: 'https://a.test/' }]);
    useStrip(strip);
    const sendResponse = vi.fn();
    await withTimers(handleHuddleUpWindow(false, sendResponse));
    // Sort's batch move: one move of every unpinned tab.
    expect(strip.log.filter(([kind]) => kind === 'move')).toEqual([['move', [2, 1], 0]]);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('reports unsupported, and changes nothing, where Chrome cannot create Split Views', async () => {
    const strip = fakeStrip([{ url: 'https://b.test/' }, { url: 'https://a.test/' }]);
    useStrip(strip);
    delete chrome.tabs.createSplit;
    const sendResponse = vi.fn();
    await handleHuddleUpWindow(true, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'unsupported' });
    expect(strip.log).toEqual([]);
  });
});

describe('planHuddleUpMoves', () => {
  // Applies the moves the way Chrome does: each tab lands at its index.
  const apply = (units, moves) => {
    const strip = units.flat();
    for (const { id, index } of moves) {
      strip.splice(strip.indexOf(id), 1);
      strip.splice(index, 0, id);
    }
    return strip;
  };

  test('an ordered window needs no moves; a reversed one moves all but one tab', () => {
    expect(planHuddleUpMoves([[1], [2], [3]], [1, 2, 3]).moves).toEqual([]);
    const { moves } = planHuddleUpMoves([[4], [3], [2], [1]], [1, 2, 3, 4]);
    expect(moves).toHaveLength(3);
    expect(apply([[4], [3], [2], [1]], moves)).toEqual([1, 2, 3, 4]);
  });

  test('random orders end in the target with the fewest moves, and a staying pair is never split up', () => {
    const rnd = seeded(7);
    for (let round = 0; round < 500; round++) {
      const n = 1 + Math.floor(rnd() * 12);
      const target = [...Array(n).keys()].map(i => i + 1);
      const current = [...target].sort(() => rnd() - 0.5);
      // Pair up neighbours that are also neighbours in the target.
      const units = [];
      for (let i = 0; i < current.length; i++) {
        if (i + 1 < current.length && current[i + 1] === current[i] + 1 && rnd() < 0.5) units.push([current[i], current[++i]]);
        else units.push([current[i]]);
      }
      const { moves, stayingUnits } = planHuddleUpMoves(units, target);
      const strip = apply(units, moves);
      expect(strip).toEqual(target);
      const movedIds = new Set(moves.map(m => m.id));
      for (const unit of stayingUnits) for (const id of unit) expect(movedIds.has(id)).toBe(false);
      // Every unit off the longest ordered run moves, and no other.
      const stayingTabs = stayingUnits.flat().length;
      expect(moves).toHaveLength(n - stayingTabs);
    }
  });
});

describe('planHuddleUp', () => {
  test('closes the later copy, sorts each part as Sort does, and pairs neighbours as Compact does', () => {
    const tab = (id, url, extra = {}) => ({ id, index: id, url, pinned: false, groupId: -1, splitViewId: -1, ...extra });
    const plan = planHuddleUp([
      tab(0, 'https://p.test/', { pinned: true }),
      tab(1, 'https://c.test/'), tab(2, 'https://a.test/', { splitViewId: 9 }), tab(3, 'https://b.test/', { splitViewId: 9 }),
      tab(4, 'https://z.test/', { groupId: 7 }), tab(5, 'https://y.test/', { groupId: 7 }),
      tab(6, 'https://c.test/'),
    ], true);
    expect(plan.remove).toEqual([6]);
    expect(plan.order).toEqual([0, 2, 3, 1, 5, 4]);
    expect(plan.pairs).toEqual([[2, 3], [5, 4]]);
  });
});

describe('Re-pairing dissolved Split Views (#46)', () => {
  const tab = (id, extra = {}) => ({ id, index: id, windowId: 1, pinned: false, groupId: -1, splitViewId: -1, ...extra });
  let byId;

  beforeEach(() => {
    chrome.tabs.query.mockReset();
    chrome.tabs.move.mockReset();
    chrome.tabs.move.mockResolvedValue([]);
    byId = new Map();
    chrome.tabs.get = vi.fn(async (id) => {
      if (!byId.has(id)) throw new Error(`No tab with id: ${id}`);
      return byId.get(id);
    });
    chrome.tabs.createSplit = vi.fn().mockResolvedValue(99);
    chrome.tabs.unsplit = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete chrome.tabs.get;
    delete chrome.tabs.createSplit;
    delete chrome.tabs.unsplit;
  });

  const setTabs = (...tabs) => { for (const t of tabs) byId.set(t.id, t); };

  test('capture records nothing (and queries nothing) without the write API', async () => {
    delete chrome.tabs.createSplit;
    expect(await captureSplitPairs([1])).toEqual([]);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  test('capture pairs tabs by splitViewId in strip order, per window', async () => {
    chrome.tabs.query.mockResolvedValue([
      tab(3, { splitViewId: 7 }),
      tab(0),
      tab(2, { splitViewId: 7 }),
      tab(5, { splitViewId: 8, windowId: 2, index: 1 }),
      tab(6, { splitViewId: 8, windowId: 2, index: 0 }),
    ]);
    expect(await captureSplitPairs()).toEqual([[2, 3], [6, 5]]);
    expect(chrome.tabs.query).toHaveBeenCalledWith({});
  });

  test('restore re-splits a dissolved pair that is still adjacent', async () => {
    setTabs(tab(4), tab(5));
    expect(await restoreSplitPairs([[4, 5]])).toBe(1);
    expect(chrome.tabs.createSplit).toHaveBeenCalledWith([4, 5]);
  });

  test('restore passes the pair in strip order even if it was recorded reversed', async () => {
    setTabs(tab(4), tab(5));
    await restoreSplitPairs([[5, 4]]);
    expect(chrome.tabs.createSplit).toHaveBeenCalledWith([4, 5]);
  });

  test.each([
    ['a half was closed', () => setTabs(tab(4))],
    ['the pair survived and is still split', () => setTabs(tab(4, { splitViewId: 7 }), tab(5, { splitViewId: 7 }))],
    ['the halves ended up in different windows', () => setTabs(tab(4), tab(5, { windowId: 2 }))],
    ['the halves differ in pinned state', () => setTabs(tab(4, { pinned: true }), tab(5))],
    ['the halves ended up in different groups', () => setTabs(tab(4, { groupId: 10 }), tab(5, { groupId: 11 }))],
    ['the halves are no longer adjacent', () => setTabs(tab(4), tab(6, { id: 5, index: 6 }))],
  ])('restore leaves a pair alone when %s', async (_why, arrange) => {
    arrange();
    expect(await restoreSplitPairs([[4, 5]])).toBe(0);
    expect(chrome.tabs.createSplit).not.toHaveBeenCalled();
  });

  test('restore does nothing without the write API', async () => {
    delete chrome.tabs.createSplit;
    setTabs(tab(4), tab(5));
    expect(await restoreSplitPairs([[4, 5]])).toBe(0);
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });

  test('one pair failing to split does not stop the rest', async () => {
    setTabs(tab(0), tab(1), tab(2), tab(3));
    chrome.tabs.createSplit.mockRejectedValueOnce(new Error('rejected')).mockResolvedValueOnce(99);
    expect(await restoreSplitPairs([[0, 1], [2, 3]])).toBe(1);
    expect(chrome.tabs.createSplit).toHaveBeenCalledTimes(2);
  });

  test('sortWindowTabs records the window\'s pairs, moves, then re-splits them', async () => {
    const before = [
      tab(1, { url: 'https://c.test', splitViewId: 7 }),
      tab(2, { url: 'https://z.test', splitViewId: 7 }),
      tab(0, { url: 'https://d.test', index: 3 }),
    ];
    chrome.tabs.query.mockResolvedValue(before);
    // After the batch move Chrome has dissolved the split; the pair is adjacent.
    setTabs(tab(1, { index: 0 }), tab(2, { index: 1 }));

    await sortWindowTabs(101, false);

    expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 101 });
    expect(chrome.tabs.move).toHaveBeenCalledWith([1, 2, 0], { index: 0 });
    expect(chrome.tabs.createSplit).toHaveBeenCalledWith([1, 2]);
    expect(chrome.tabs.move.mock.invocationCallOrder[0])
      .toBeLessThan(chrome.tabs.createSplit.mock.invocationCallOrder[0]);
  });
});
