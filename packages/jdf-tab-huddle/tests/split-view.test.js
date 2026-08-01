// Split View awareness: sort keeps pairs together, dedup keeps the split copy.
// Chrome exposes splitViewId read-only (there is no API to create or restore a
// split), so everything here is preservation-only and must degrade to today's
// behavior when the property is absent.

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
