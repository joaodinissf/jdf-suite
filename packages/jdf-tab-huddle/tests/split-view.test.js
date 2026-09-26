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
