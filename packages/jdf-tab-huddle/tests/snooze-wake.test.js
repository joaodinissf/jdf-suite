// The wake protocol (M1, M2, L12, L67): a snoozed record stays in storage
// until its wake has finished, so a worker stop, an extension reload or a
// browser restart in the middle of a wake loses nothing. These tests run the
// real worker in tests/helpers/fake-browser.js, which keeps windows, tabs,
// storage and alarms across worker instances, and stop a wake at an exact
// checkpoint with the worker's wakeStage() hook.
import { createBrowser } from './helpers/fake-browser.js';

const HOME = 'https://home.test/';
const url = (name) => `https://${name}.test/`;

function record(id, type, names, extra = {}) {
  const tabs = names.map((n, i) => ({ url: url(n), title: n, pinned: false, index: i }));
  return {
    id,
    type,
    summary: type === 'tab' ? names[0] : `${tabs.length} tabs`,
    createdAt: Date.now() - 7200000,
    wakeAt: Date.now() - 1000,
    preset: 'custom',
    windowId: 1,
    tabs,
    ...(type === 'group' ? { group: { title: 'Research', color: 'blue' } } : {}),
    ...extra,
  };
}

// A browser with one ordinary window and the given records asleep, each with
// its alarm.
function browserWith(records, { homeUrls = [HOME] } = {}) {
  const b = createBrowser();
  const home = b.openWindow(homeUrls);
  b.local.snoozedItems = structuredClone(records);
  for (const r of records) b.alarms.set('snooze:' + r.id, { name: 'snooze:' + r.id, scheduledTime: r.wakeAt });
  return { b, home };
}

async function started(b) {
  const w = b.startWorker();
  await b.settle();
  return w;
}

// The URLs of the record that are not open anywhere and not in a record.
function lost(b, rec) {
  const pending = new Set(b.records().flatMap((r) => r.tabs.map((t) => t.url)));
  return rec.tabs.map((t) => t.url).filter((u) => b.urlCount(u) === 0 && !pending.has(u));
}

afterEach(() => {
  delete globalThis.__huddleWakeHook;
});

describe('waking keeps the record until the wake has finished', () => {
  test('a wake that finishes removes the record and its alarm, and notifies once', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w = await started(b);
    await w.alarm('snooze:r');
    await b.settle();
    expect(b.records()).toEqual([]);
    expect(b.snoozeAlarms()).toEqual([]);
    for (const t of r.tabs) expect(b.urlCount(t.url)).toBe(1);
    expect(b.notifications.map((n) => n.message)).toEqual(['3 tabs are back']);
  });

  test('mid-wake, the record is still stored with its claim and progress', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w = await started(b);
    const release = b.pauseAt('after-progress:1');
    w.alarm('snooze:r');
    await b.settle();
    const stored = b.record('r');
    expect(stored.tabs).toEqual(r.tabs);
    expect(stored.waking).toMatchObject({ attempts: 1, stalled: false, failed: [] });
    expect(stored.waking.opened.map((e) => e.i)).toEqual([0, 1]);
    expect(b.snoozeAlarms().map((a) => a.name)).toEqual(['snooze:r']);
    release();
    await b.settle();
    expect(b.records()).toEqual([]);
  });

  test('the recovery alarm is armed before the claim: dying in between still wakes the record once', async () => {
    const r = record('r', 'tab', ['a']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('claimed');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['claimed']);
    expect(b.record('r').waking).toBeUndefined();
    const [alarm] = b.snoozeAlarms();
    expect(alarm.name).toBe('snooze:r');
    expect(alarm.scheduledTime).toBeGreaterThan(Date.now() + 50000);

    const w2 = await started(b);
    expect(b.urlCount(url('a'))).toBe(0);
    await w2.alarm('snooze:r');
    await b.settle();
    expect(b.urlCount(url('a'))).toBe(1);
    expect(b.records()).toEqual([]);
  });
});

describe('a worker stop at each checkpoint, resumed by the next worker', () => {
  const cases = [
    { type: 'tab', names: ['a'], k: 0 },
    { type: 'tabs', names: ['a', 'b', 'c'], k: 1 },
    { type: 'group', names: ['a', 'b', 'c'], k: 1 },
    { type: 'window', names: ['a', 'b', 'c'], k: 1 },
    { type: 'group', names: ['a', 'b', 'c'], k: 0 },
  ];
  for (const { type, names, k } of cases) {
    for (const stage of ['after-create', 'after-progress']) {
      test(`${type} (${names.length} tabs), stopped at ${stage}:${k}: nothing lost, ${stage === 'after-create' ? 'exactly one duplicate' : 'no duplicate'}`, async () => {
        const r = record('r', type, names);
        const { b } = browserWith([r]);
        const w1 = await started(b);
        b.dieAt(`${stage}:${k}`);
        w1.alarm('snooze:r');
        await b.settle();
        expect(b.stageHits).toEqual([`${stage}:${k}`]);
        // The record is still asleep, claimed, with its alarm.
        expect(b.record('r').waking).toBeTruthy();
        expect(b.snoozeAlarms().map((a) => a.name)).toEqual(['snooze:r']);

        b.startWorker();
        await b.settle();
        expect(b.records()).toEqual([]);
        expect(b.snoozeAlarms()).toEqual([]);
        expect(lost(b, r)).toEqual([]);
        const counts = r.tabs.map((t) => b.urlCount(t.url));
        const expected = r.tabs.map((_t, i) => (stage === 'after-create' && i === k ? 2 : 1));
        expect(counts).toEqual(expected);

        if (type === 'group') {
          const groups = [...b.groups.values()];
          expect(groups).toHaveLength(1);
          expect(groups[0]).toMatchObject({ title: 'Research', color: 'blue' });
          const members = b.allTabs().filter((t) => t.groupId === groups[0].id).map((t) => t.url);
          expect(members.sort()).toEqual(r.tabs.map((t) => t.url).sort());
        }
        if (type === 'window') {
          // One window holds the record's tabs, reused across the stop: no
          // second window and no New Tab left.
          const windows = [...b.windows.keys()].filter((id) => b.tabsIn(id).some((t) => t.url !== HOME));
          expect(windows).toHaveLength(1);
          const inWindow = b.tabsIn(windows[0]).map((t) => t.url);
          expect(inWindow).not.toContain('chrome://newtab/');
          expect(new Set(inWindow)).toEqual(new Set(r.tabs.map((t) => t.url)));
        }
        expect(b.notifications).toHaveLength(1);
      });
    }
  }

  test('the resumed wake says how many tabs came back over both attempts', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:1');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:1']);
    b.startWorker();
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual([url('c')]);
    expect(b.notifications.map((n) => n.message)).toEqual(['3 tabs are back']);
  });

  test('listSnoozed shows the resumed record as waking, never as interrupted in between', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    const release = b.pauseAt('after-progress:1');
    const w2 = b.startWorker();
    const reply = await w2.send({ action: 'listSnoozed' });
    expect(reply.success).toBe(true);
    expect(reply.items.map((i) => [i.id, i.waking])).toEqual([['r', 'active']]);
    // The claim's internals stay in the worker.
    expect(reply.items[0].stalled).toBe(false);
    release();
    await b.settle();
  });
});

describe('window records (D18): an empty window first, then tab by tab', () => {
  const windowRecord = () => ({
    ...record('w', 'window', ['a', 'b', 'c', 'd']),
    groups: [{ title: 'Work', color: 'blue' }, { title: 'Read', color: 'red' }],
    tabs: [
      { url: url('a'), title: 'a', pinned: true, index: 0 },
      { url: url('b'), title: 'b', pinned: false, index: 1, groupIndex: 0 },
      { url: url('c'), title: 'c', pinned: false, index: 2, groupIndex: 0 },
      { url: url('d'), title: 'd', pinned: false, index: 3, groupIndex: 1 },
    ],
  });

  function recordWindow(b) {
    const ids = [...b.windows.keys()].filter((id) => b.tabsIn(id).some((t) => t.url === url('b')));
    expect(ids).toHaveLength(1);
    return ids[0];
  }

  function expectRestored(b, windowId) {
    const tabs = b.tabsIn(windowId);
    expect(tabs.map((t) => t.url)).toEqual([url('a'), url('b'), url('c'), url('d')]);
    expect(tabs.map((t) => t.pinned)).toEqual([true, false, false, false]);
    const groupOf = (u) => b.groups.get(tabs.find((t) => t.url === u).groupId);
    expect(groupOf(url('b'))).toMatchObject({ title: 'Work', color: 'blue' });
    expect(groupOf(url('c')).id).toBe(groupOf(url('b')).id);
    expect(groupOf(url('d'))).toMatchObject({ title: 'Read', color: 'red' });
    expect(tabs[0].groupId).toBe(-1);
  }

  test('an uninterrupted wake opens an empty window, fills it, then pins and regroups', async () => {
    const { b } = browserWith([windowRecord()]);
    const w = await started(b);
    await w.alarm('snooze:w');
    await b.settle();
    expectRestored(b, recordWindow(b));
    expect(b.windows.size).toBe(2);
    expect(b.records()).toEqual([]);
  });

  test('stopped right after the window opened: one empty window is left, no tab twice', async () => {
    const { b } = browserWith([windowRecord()]);
    const w1 = await started(b);
    b.dieAt('after-window-create');
    w1.alarm('snooze:w');
    await b.settle();
    expect(b.stageHits).toEqual(['after-window-create']);
    b.startWorker();
    await b.settle();
    const win = recordWindow(b);
    expectRestored(b, win);
    const leftovers = [...b.windows.keys()].filter((id) => id !== win
      && b.tabsIn(id).every((t) => t.url === 'chrome://newtab/'));
    expect(leftovers).toHaveLength(1);
    expect(b.windows.size).toBe(3);
    for (const u of ['a', 'b', 'c', 'd']) expect(b.urlCount(url(u))).toBe(1);
  });

  test('stopped before the groups: the next worker pins and groups with no new tab', async () => {
    const { b } = browserWith([windowRecord()]);
    const w1 = await started(b);
    b.dieAt('before-group');
    w1.alarm('snooze:w');
    await b.settle();
    expect(b.stageHits).toEqual(['before-group']);
    b.startWorker();
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2)).toEqual([]);
    expectRestored(b, recordWindow(b));
    expect(b.windows.size).toBe(2);
  });

  test('when you close the half-filled window meanwhile, only the missing tabs come back, in a new window', async () => {
    const { b } = browserWith([windowRecord()]);
    const w1 = await started(b);
    b.dieAt('after-progress:1');
    w1.alarm('snooze:w');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:1']);
    b.closeWindow(recordWindow(b));
    b.startWorker();
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual([url('c'), url('d')]);
    expect(b.records()).toEqual([]);
  });
});

describe('failures inside one worker', () => {
  test('a failed completion read leaves the wake interrupted, and its recovery alarm completes it', async () => {
    const r = record('r', 'tabs', ['a', 'b']);
    const { b } = browserWith([r]);
    const w = await started(b);
    b.pauseAt('before-remove', () => b.failOnce('storage.local.get'));
    await w.alarm('snooze:r');
    await b.settle();
    expect(b.record('r').waking.opened).toHaveLength(2);
    expect(b.snoozeAlarms().map((a) => a.name)).toEqual(['snooze:r']);
    const listed = await w.send({ action: 'listSnoozed' });
    expect(listed.items[0].waking).toBe('interrupted');

    await w.alarm('snooze:r');
    await b.settle();
    expect(b.records()).toEqual([]);
    expect(b.created.map((c) => c.url)).toEqual([url('a'), url('b')]);
    expect(b.notifications.map((n) => n.message)).toEqual(['2 tabs are back']);
  });

  test('an alarm during an active wake re-arms it and skips; the wake completes; the later alarm is a no-op', async () => {
    const r = record('r', 'tabs', ['a', 'b']);
    const { b } = browserWith([r]);
    const w = await started(b);
    const release = b.pauseAt('after-progress:0');
    w.alarm('snooze:r');
    await b.settle();
    await w.alarm('snooze:r');
    await b.settle();
    const [again] = b.snoozeAlarms();
    expect(again.name).toBe('snooze:r');
    expect(again.scheduledTime).toBeGreaterThan(Date.now() + 50000);
    expect(b.created).toHaveLength(1);
    release();
    await b.settle();
    expect(b.records()).toEqual([]);
    expect(b.snoozeAlarms()).toEqual([]);
    await w.alarm('snooze:r');
    await b.settle();
    expect(b.created).toHaveLength(2);
    expect(b.notifications).toHaveLength(1);
  });

  test('three failed attempts stall the wake: no alarm, one notice, and the list says it did not finish', async () => {
    const r = record('r', 'tab', ['a']);
    const { b } = browserWith([r]);
    const w = await started(b);
    for (let attempt = 1; attempt <= 3; attempt++) {
      b.failOnce('windows.getLastFocused');
      b.failOnce('windows.create');
      await w.alarm('snooze:r');
      await b.settle();
      expect(b.record('r').waking.attempts).toBe(attempt);
      expect(b.snoozeAlarms()).toHaveLength(attempt < 3 ? 1 : 0);
    }
    expect(b.record('r').waking.stalled).toBe(true);
    expect(b.notifications.map((n) => n.title)).toEqual(['Huddle — tabs didn\'t finish waking']);
    const listed = await w.send({ action: 'listSnoozed' });
    expect(listed.items[0]).toMatchObject({ id: 'r', waking: 'interrupted', stalled: true });
    expect(listed.items[0].tabs).toEqual(r.tabs);
  });

  test("clicking the \"didn't finish waking\" notice opens the nap room, even from a new worker", async () => {
    const r = record('r', 'tab', ['a']);
    const { b } = browserWith([r]);
    const w = await started(b);
    for (let attempt = 1; attempt <= 3; attempt++) {
      b.failOnce('windows.getLastFocused');
      b.failOnce('windows.create');
      await w.alarm('snooze:r');
      await b.settle();
    }
    const notice = b.notifications.find((n) => n.title === 'Huddle — tabs didn\'t finish waking');
    expect(notice.id).toBe('snooze-stalled:r');
    const w2 = b.startWorker();
    await b.settle();
    await w2.clickNotification(notice.id);
    await b.settle();
    expect(b.allTabs().some((t) => t.url.endsWith('nap-room.html'))).toBe(true);
  });

  test('after a restart, a URL already open before the wake does not end the wait before the reopened copy comes back', async () => {
    const r = record('r', 'tabs', ['a', 'c']);
    const b = createBrowser();
    b.openWindow([HOME, url('a')]); // 'a' was already open before the wake: baseline 1
    const wakeWin = b.openWindow([url('z')]); // last focused: the wake reopens into it
    b.local.snoozedItems = structuredClone([r]);
    b.alarms.set('snooze:r', { name: 'snooze:r', scheduledTime: r.wakeAt });
    const w1 = b.startWorker();
    await b.settle();
    b.dieAt('after-progress:0');
    w1.alarm('snooze:r'); // stopped at the checkpoint, so it never resolves
    await b.settle();
    expect(b.record('r').waking.baseline[url('a')]).toBe(1);
    const oldWake = wakeWin.windowId ?? wakeWin.id ?? wakeWin;
    const wakeUrls = b.tabsIn(oldWake).map((t) => t.url);
    // Restart: the first window comes back at once, the wake's window a moment later.
    b.restart({ keep: (t) => t.windowId !== oldWake });
    b.clearHook();
    setTimeout(() => { b.openWindow(wakeUrls); }, 25);
    const w2 = b.startWorker();
    await w2.startup();
    await b.settle();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await b.settle();
    expect(b.records()).toEqual([]);
    expect(b.urlCount(url('a'))).toBe(2); // the one already open, plus the one reopened copy
  });

  test('after a reload, a verified record sharing a URL with an unverified one still waits for the unverified copy', async () => {
    const earlier = (id, names, opened, tabIdBase, since) => ({
      ...record(id, 'tabs', names),
      waking: {
        by: 'old-worker', boot: 'old-boot', since, attempts: 1, stalled: false,
        opened: opened.map((i) => ({ i, tabId: tabIdBase + i, windowId: 900 })),
        failed: [], windowId: null, placeholderTabId: null, groupId: null, baseline: {},
      },
    });
    const b = createBrowser();
    const home = b.openWindow([HOME]);
    const hw = home.windowId ?? home.id ?? home;
    b.openTab(hw, url('s'), { id: 500 }); // r1's reopened tab: still there, id intact
    b.local.snoozedItems = structuredClone([earlier('r1', ['s', 'p'], [0], 500, 1), earlier('r2', ['s', 'q'], [0], 600, 2)]);
    setTimeout(() => { b.openWindow([url('s')]); }, 25); // r2's copy, still being restored
    const w = b.startWorker();
    await b.settle();
    await w.installed({ reason: 'update' });
    await b.settle();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await b.settle();
    expect(b.urlCount(url('s'))).toBe(2);
  });

  test('a stalled wake is left alone by five worker starts, the reconciler and a stray alarm; Wake now resumes it', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    b.local.snoozedItems[0].waking = {
      by: 'gone', boot: 'unknown', since: 1, attempts: 3, stalled: true,
      opened: [], failed: [], windowId: null, placeholderTabId: null, groupId: null, baseline: {},
    };
    b.alarms.clear();
    for (let i = 0; i < 5; i++) {
      const w = await started(b);
      await w.startup();
      await w.installed({ reason: 'update' });
      await w.alarm('snooze:r');
      await b.settle();
      b.stopWorker();
    }
    expect(b.createCalls).toEqual([]);
    expect(b.notifications).toEqual([]);
    expect(b.snoozeAlarms()).toEqual([]);
    expect(b.record('r').waking.stalled).toBe(true);

    const w = await started(b);
    const reply = await w.send({ action: 'wakeSnoozed', id: 'r' });
    expect(reply).toEqual({ success: true, createdCount: 3, failedCount: 0 });
    expect(b.records()).toEqual([]);
  });

  // Claims left by a worker of an earlier boot that stalled (three attempts).
  const stalledEarlier = (extra = {}) => ({
    by: 'gone', boot: 'old-boot', since: 1, attempts: 3, stalled: true,
    opened: [], failed: [], windowId: null, placeholderTabId: null, groupId: null, baseline: {}, ...extra,
  });

  test('after a browser start, Wake now on one stalled record from an earlier boot wakes only that one', async () => {
    const r1 = record('r1', 'tabs', ['a', 'b']);
    const r2 = record('r2', 'tabs', ['c', 'd']);
    const { b } = browserWith([r1, r2]);
    b.local.snoozedItems[0].waking = stalledEarlier();
    b.local.snoozedItems[1].waking = stalledEarlier();
    b.alarms.clear();
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.createCalls).toEqual([]);

    const reply = await w.send({ action: 'wakeSnoozed', id: 'r1' });
    await b.settle();
    expect(reply).toEqual({ success: true, createdCount: 2, failedCount: 0 });
    expect(b.created.map((c) => c.url)).toEqual([url('a'), url('b')]);
    // The other stalled record still waits for you, as it was.
    expect(b.records().map((r) => r.id)).toEqual(['r2']);
    expect(b.record('r2').waking).toMatchObject({ boot: 'old-boot', attempts: 3, stalled: true });
    expect(b.snoozeAlarms()).toEqual([]);
  });

  test('Wake now resets the attempts of the pressed record only; another earlier-boot claim resumed with it counts one more', async () => {
    const r1 = record('r1', 'tabs', ['a']);
    const r2 = record('r2', 'tabs', ['c']);
    const r3 = record('r3', 'tabs', ['e']);
    const { b } = browserWith([r1, r2, r3]);
    b.local.snoozedItems[0].waking = stalledEarlier();
    b.local.snoozedItems[1].waking = stalledEarlier();
    b.local.snoozedItems[2].waking = stalledEarlier({ attempts: 1, stalled: false });
    b.alarms.clear();
    // No startup event yet: the worker start leaves every earlier-boot claim
    // to its alarm, and Wake now resumes with the reload check.
    const w = await started(b);
    b.pauseAt('after-create:0');
    w.send({ action: 'wakeSnoozed', id: 'r1' });
    await b.settle();
    expect(b.stageHits).toEqual(['after-create:0']);
    // Re-stamped in one write before the first tab opened.
    expect(b.record('r1').waking).toMatchObject({ attempts: 1, stalled: false });
    expect(b.record('r3').waking).toMatchObject({ attempts: 2, stalled: false });
    expect(b.record('r2').waking).toMatchObject({ boot: 'old-boot', attempts: 3, stalled: true });
  });

  test('a Wake now that could not resume an earlier-boot claim does not promise a retry that no alarm will make', async () => {
    const r = record('r', 'tabs', ['a']);
    const { b } = browserWith([r]);
    b.local.snoozedItems[0].waking = stalledEarlier();
    b.alarms.clear();
    const w = await started(b);
    // The claim read succeeds; the resume's own read fails.
    let reads = 0;
    b.failOnce('storage.local.get', () => ++reads === 2);
    const reply = await w.send({ action: 'wakeSnoozed', id: 'r' });
    expect(reply).toMatchObject({ success: false, waking: 'interrupted' });
    expect(reply.error).not.toMatch(/in a minute/);
    expect(reply.error).toMatch(/Wake now again/);
    expect(b.snoozeAlarms()).toEqual([]);
  });

  test('a record none of whose tabs reopened waits for Wake now: worker starts and the reconciler do not retry it', async () => {
    const r = { ...record('r', 'tab', ['a']), tabs: [{ url: 'file:///a.html', title: 'a', pinned: false, index: 0 }] };
    const { b } = browserWith([r]);
    const w1 = await started(b);
    await w1.alarm('snooze:r');
    await b.settle();
    expect(b.record('r').wakeFailedAt).toEqual(expect.any(Number));
    expect(b.record('r').waking).toBeUndefined();
    expect(b.snoozeAlarms()).toEqual([]);
    expect(b.notifications).toHaveLength(1);
    expect(b.createCalls).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      b.stopWorker();
      const w = await started(b);
      await w.startup();
      await b.settle();
    }
    expect(b.createCalls).toHaveLength(1);
    expect(b.notifications).toHaveLength(1);
  });
});

describe('after an extension reload (reload mode)', () => {
  test('ids are still valid: a wake stopped before removing the record creates no tab again', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('before-remove');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['before-remove']);
    b.reloadExtension();
    const w2 = await started(b);
    await w2.installed({ reason: 'update' });
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2)).toEqual([]);
    expect(b.records()).toEqual([]);
    for (const t of r.tabs) expect(b.urlCount(t.url)).toBe(1);
  });

  test('only the tabs that had not reopened are created', async () => {
    const r = record('r', 'group', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:1');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:1']);
    b.reloadExtension();
    const w2 = await started(b);
    await w2.installed({ reason: 'update' });
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual([url('c')]);
    const groups = [...b.groups.values()];
    expect(groups).toHaveLength(1);
    expect(b.allTabs().filter((t) => t.groupId === groups[0].id)).toHaveLength(3);
  });

  test('a stale tab id that now names an unrelated tab is not counted as reopened', async () => {
    const r = record('r', 'tabs', ['a', 'b']);
    const { b, home } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    const [entry] = b.record('r').waking.opened;
    b.closeTab(entry.tabId);
    b.openTab(home.windowId, 'https://unrelated.test/', { id: entry.tabId });
    b.reloadExtension();
    const w2 = await started(b);
    await w2.installed({ reason: 'update' });
    await b.settle();
    expect(b.urlCount(url('a'))).toBe(1);
    expect(b.urlCount(url('b'))).toBe(1);
    expect(b.urlCount('https://unrelated.test/')).toBe(1);
    expect(b.records()).toEqual([]);
  });

  test('with no startup event (a re-enable), the claim waits one alarm period, then resumes with the reload check', async () => {
    const r = record('r', 'tabs', ['a', 'b']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    b.reloadExtension();
    const w2 = await started(b);
    // The worker start armed its recovery alarm, and does not guess.
    expect(b.snoozeAlarms().map((a) => a.name)).toEqual(['snooze:r']);
    await w2.alarm('snooze:r');
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2)).toEqual([]);
    expect(b.snoozeAlarms().map((a) => a.name)).toEqual(['snooze:r']);
    await w2.alarm('snooze:r');
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual([url('b')]);
    expect(b.records()).toEqual([]);
  });
});

describe('after a browser restart (restart mode)', () => {
  // Stops a wake of `rec` at `stage`, then quits and relaunches.
  async function interruptedThenRestarted(records, stage, restart = {}) {
    const { b, home } = browserWith(records);
    const w1 = await started(b);
    b.dieAt(stage);
    w1.alarm('snooze:' + records[0].id);
    await b.settle();
    expect(b.stageHits).toEqual([stage]);
    b.clearHook();
    b.restart(restart);
    return { b, home };
  }

  test('session restore brought the reopened tabs back: nothing is created, the record goes', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = await interruptedThenRestarted([r], 'before-remove');
    const w2 = await started(b);
    await w2.startup();
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2)).toEqual([]);
    expect(b.records()).toEqual([]);
  });

  test('with session restore off, every tab reopens', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = await interruptedThenRestarted([r], 'before-remove', { restore: false });
    const w2 = await started(b);
    await w2.startup();
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual(r.tabs.map((t) => t.url));
    expect(b.records()).toEqual([]);
  });

  test('restore arriving a while after onStartup is waited for', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = await interruptedThenRestarted([r], 'before-remove', { restoreDelayMs: 25 });
    const w2 = await started(b);
    await w2.startup();
    await b.settle();
    expect(b.created.filter((c) => c.worker === 2)).toEqual([]);
    for (const t of r.tabs) expect(b.urlCount(t.url)).toBe(1);
  });

  test('resumed after a restart, interrupted again, then resumed by a later worker with no startup event: nothing lost', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = await interruptedThenRestarted([r], 'after-progress:0');
    const w2 = await started(b);
    b.dieAt('after-create:1');
    w2.startup();
    await b.settle();
    expect(b.stageHits).toContain('after-create:1');
    // Re-stamped with this boot before any tab was created.
    const stored = b.record('r');
    expect(stored.waking.boot).toBe(b.session.huddleBootId);
    expect(stored.waking.opened.map((e) => e.i)).toEqual([0]);

    b.startWorker();
    await b.settle();
    expect(b.records()).toEqual([]);
    expect(lost(b, r)).toEqual([]);
    expect(r.tabs.map((t) => b.urlCount(t.url))).toEqual([1, 2, 1]);
  });

  for (const gapMs of [0, 30]) {
    test(`onInstalled "update" ${gapMs ? `${gapMs} ms ` : ''}before onStartup (an update applied as Chrome starts): the reopened tabs are matched by URL, not opened twice`, async () => {
      const r = record('r', 'tabs', ['a', 'b', 'c']);
      const { b } = await interruptedThenRestarted([r], 'after-progress:1', { idsFrom: 50 });
      const w2 = await started(b);
      w2.installed({ reason: 'update' });
      if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
      w2.startup();
      await b.settle();
      expect(r.tabs.map((t) => b.urlCount(t.url))).toEqual([1, 1, 1]);
      expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual([url('c')]);
      expect(b.records()).toEqual([]);
    });
  }

  test('onStartup before onInstalled "update": the same', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = await interruptedThenRestarted([r], 'after-progress:1', { idsFrom: 50 });
    const w2 = await started(b);
    w2.startup();
    w2.installed({ reason: 'update' });
    await b.settle();
    expect(r.tabs.map((t) => b.urlCount(t.url))).toEqual([1, 1, 1]);
    expect(b.records()).toEqual([]);
  });

  test('a reopened tab whose address changed before the restart opens again (the stated bound)', async () => {
    const r = record('r', 'tabs', ['a', 'b']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    b.navigate(b.record('r').waking.opened[0].tabId, 'https://a.test/after-redirect');
    b.restart();
    const w2 = await started(b);
    await w2.startup();
    await b.settle();
    expect(b.urlCount(url('a'))).toBe(1);
    expect(b.urlCount('https://a.test/after-redirect')).toBe(1);
    expect(b.records()).toEqual([]);
  });

  // Claims left by a worker of an earlier session, seeded directly.
  function earlierClaim(rec, opened, { since = 1, baseline = {} } = {}) {
    return {
      ...rec,
      waking: {
        by: 'old-worker', boot: 'old-boot', since, attempts: 1, stalled: false,
        opened: opened.map((i) => ({ i, tabId: 900 + i, windowId: 900 })),
        failed: [], windowId: null, placeholderTabId: null, groupId: null, baseline,
      },
    };
  }

  test('two interrupted records that share a URL each get their own tab', async () => {
    const shared = url('shared');
    const r1 = earlierClaim({ ...record('r1', 'tabs', ['x']), tabs: [{ url: shared, title: 's', pinned: false, index: 0 }, { url: url('x'), title: 'x', pinned: false, index: 1 }] }, [0], { since: 1 });
    const r2 = earlierClaim({ ...record('r2', 'tabs', ['y']), tabs: [{ url: shared, title: 's', pinned: false, index: 0 }, { url: url('y'), title: 'y', pinned: false, index: 1 }] }, [0], { since: 2 });
    const { b } = browserWith([r1, r2], { homeUrls: [HOME, shared] });
    const w = await started(b);
    await w.startup();
    await b.settle();
    // One shared tab was open: it is the first record's; the second opens its own.
    expect(b.created.map((c) => c.url).sort()).toEqual([shared, url('x'), url('y')].sort());
    expect(b.urlCount(shared)).toBe(2);
    expect(b.records()).toEqual([]);
  });

  test('a tab that already showed the URL before the wake is not taken for the reopened one', async () => {
    const r = earlierClaim(record('r', 'tabs', ['a', 'b']), [0], { baseline: { [url('a')]: 1, [url('b')]: 0 } });
    const { b } = browserWith([r], { homeUrls: [HOME, url('a')] });
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.urlCount(url('a'))).toBe(2);
    expect(b.records()).toEqual([]);
  });

  test('an unrelated one-tab window with the same URL is not reused as the record\'s window', async () => {
    const r = earlierClaim(record('w', 'window', ['a', 'b']), [0], { baseline: { [url('a')]: 1, [url('b')]: 0 } });
    const { b } = browserWith([r]);
    const lone = b.openWindow([url('a')]);
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.tabsIn(lone.windowId).map((t) => t.url)).toEqual([url('a')]);
    const restored = [...b.windows.keys()].filter((id) => b.tabsIn(id).some((t) => t.url === url('b')));
    expect(restored).toHaveLength(1);
    expect(b.tabsIn(restored[0]).map((t) => t.url)).toEqual([url('a'), url('b')]);
  });

  test('a relaunch that reports onInstalled "install" and no onStartup (a command-line load) resumes in restart mode', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = await interruptedThenRestarted([r], 'after-progress:1');
    const w2 = await started(b);
    await w2.installed({ reason: 'install' });
    await b.settle();
    expect(b.session.huddleBootKind).toBe('restart');
    expect(b.created.filter((c) => c.worker === 2).map((c) => c.url)).toEqual([url('c')]);
    expect(b.records()).toEqual([]);
  });

  test('a restored group that also holds a New Tab (a tab restored before its page committed) is reused, and the New Tab closed', async () => {
    const r = earlierClaim(record('g', 'group', ['a', 'b', 'c']), [0, 1]);
    const { b } = browserWith([r]);
    const restored = b.openWindow([url('a'), 'chrome://newtab/']);
    b.makeGroup(restored.tabIds, { title: 'Research', color: 'blue' });
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.groups.size).toBe(1);
    const [g] = b.groups.values();
    expect(b.allTabs().filter((t) => t.groupId === g.id).map((t) => t.url)).toEqual([url('a'), url('b'), url('c')]);
    expect(b.urlCount('chrome://newtab/')).toBe(0);
  });

  test('the New Tab of a reused group is still closed when that resume is interrupted and the next worker of the same boot finishes it', async () => {
    const r = earlierClaim(record('g', 'group', ['a', 'b', 'c']), [0, 1]);
    const { b } = browserWith([r]);
    const restored = b.openWindow([url('a'), 'chrome://newtab/']);
    b.makeGroup(restored.tabIds, { title: 'Research', color: 'blue' });
    const w = await started(b);
    b.dieAt('after-progress:2');
    w.startup();
    await b.settle();
    expect(b.stageHits).toContain('after-progress:2');
    expect(b.urlCount('chrome://newtab/')).toBe(1);

    b.startWorker();
    await b.settle();
    expect(b.records()).toEqual([]);
    expect(b.groups.size).toBe(1);
    const [g] = b.groups.values();
    expect(b.allTabs().filter((t) => t.groupId === g.id).map((t) => t.url)).toEqual([url('a'), url('b'), url('c')]);
    expect(b.urlCount('chrome://newtab/')).toBe(0);
  });

  test('a restored group of the record\'s title and colour that holds only New Tabs (no page had committed) is its own group, reused', async () => {
    const r = earlierClaim(record('g', 'group', ['a', 'b', 'c']), [0, 1]);
    const { b } = browserWith([r]);
    const restored = b.openWindow(['chrome://newtab/', 'chrome://newtab/']);
    b.makeGroup(restored.tabIds, { title: 'Research', color: 'blue' });
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.groups.size).toBe(1);
    const [g] = b.groups.values();
    expect(b.allTabs().filter((t) => t.groupId === g.id).map((t) => t.url)).toEqual([url('a'), url('b'), url('c')]);
    expect(b.urlCount('chrome://newtab/')).toBe(0);
  });

  test('a group of New Tabs with another title is left alone', async () => {
    const r = earlierClaim(record('g', 'group', ['a']), [0]);
    const { b } = browserWith([r]);
    const other = b.openWindow(['chrome://newtab/']);
    const gid = b.makeGroup(other.tabIds, { title: 'Mine', color: 'red' });
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.allTabs().filter((t) => t.groupId === gid).map((t) => t.url)).toEqual(['chrome://newtab/']);
    expect(b.groups.size).toBe(2);
  });

  test('a restored window that holds only the record\'s tabs and a New Tab is reused', async () => {
    const r = earlierClaim(record('w', 'window', ['a', 'b']), [0]);
    const { b } = browserWith([r]);
    const restored = b.openWindow(['chrome://newtab/', url('a')]);
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.tabsIn(restored.windowId).map((t) => t.url)).toEqual([url('a'), url('b')]);
    expect(b.windows.size).toBe(2);
  });
});

describe('the startup reconciler (M2)', () => {
  test('wakes overdue records one at a time: a stop mid-way leaves every other record in storage', async () => {
    const rs = [record('p1', 'tabs', ['a1', 'a2']), record('p2', 'tabs', ['b1', 'b2']), record('p3', 'tabs', ['c1', 'c2'])];
    const { b } = browserWith(rs);
    b.alarms.clear();
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.startup();
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    expect(b.records().map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
    expect(b.record('p2').waking).toBeUndefined();
    // Each due record got an alarm before the first wake: the rest wake
    // without another browser start.
    expect(b.snoozeAlarms().map((a) => a.name).sort()).toEqual(['snooze:p1', 'snooze:p2', 'snooze:p3']);
    const w2 = await started(b);
    await w2.alarm('snooze:p2');
    await w2.alarm('snooze:p3');
    await b.settle();
    expect(b.records()).toEqual([]);
    for (const r of rs) expect(lost(b, r)).toEqual([]);
    expect(b.urlCount(url('b1'))).toBe(1);
  });

  test('a restart in the middle of the reconciler loses nothing either', async () => {
    const rs = [record('p1', 'tabs', ['a1', 'a2']), record('p2', 'tabs', ['b1', 'b2']), record('p3', 'tabs', ['c1', 'c2'])];
    const { b } = browserWith(rs);
    b.alarms.clear();
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.startup();
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    b.restart();
    const w2 = await started(b);
    await w2.startup();
    await b.settle();
    expect(b.records()).toEqual([]);
    for (const r of rs) expect(lost(b, r)).toEqual([]);
    expect(b.urlCount(url('a1'))).toBe(1);
  });

  test('re-arms a missing future alarm and keeps an earlier (recovery) one', async () => {
    const future = { ...record('f', 'tab', ['f']), wakeAt: Date.now() + 3600000 };
    const early = { ...record('e', 'tab', ['e']), wakeAt: Date.now() + 7200000 };
    const { b } = browserWith([future, early]);
    b.alarms.clear();
    b.alarms.set('snooze:e', { name: 'snooze:e', scheduledTime: Date.now() + 60000 });
    const w = await started(b);
    await w.startup();
    await b.settle();
    expect(b.alarms.get('snooze:f').scheduledTime).toBe(future.wakeAt);
    expect(b.alarms.get('snooze:e').scheduledTime).toBeLessThan(early.wakeAt);
  });
});

describe('concurrency and the handlers', () => {
  test('the alarm, the reconciler and Wake now at once open each URL once', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w = await started(b);
    const replies = [];
    w.alarm('snooze:r');
    w.startup();
    w.send({ action: 'wakeSnoozed', id: 'r' }).then((x) => replies.push(x));
    await b.settle();
    for (const t of r.tabs) expect(b.urlCount(t.url)).toBe(1);
    expect(b.records()).toEqual([]);
    expect(replies).toHaveLength(1);
    expect(replies[0].error).toBeUndefined();
  });

  test('Wake now and Discard on a wake in progress change nothing and say it is waking', async () => {
    const r = record('r', 'tabs', ['a', 'b']);
    const { b } = browserWith([r]);
    const w = await started(b);
    const release = b.pauseAt('after-progress:0');
    w.alarm('snooze:r');
    await b.settle();
    expect(await w.send({ action: 'wakeSnoozed', id: 'r' })).toEqual({ success: false, waking: 'active' });
    expect(await w.send({ action: 'cancelSnoozed', id: 'r' })).toEqual({ success: false, waking: 'active' });
    expect(b.record('r').tabs).toEqual(r.tabs);
    release();
    await b.settle();
    expect(b.created.map((c) => c.url)).toEqual([url('a'), url('b')]);
  });

  test('Discard on an interrupted wake drops only the tabs that had not reopened; Undo puts back a plain snooze', async () => {
    const r = record('r', 'tabs', ['a', 'b', 'c']);
    const { b } = browserWith([r]);
    const w1 = await started(b);
    b.dieAt('after-progress:0');
    w1.alarm('snooze:r');
    await b.settle();
    expect(b.stageHits).toEqual(['after-progress:0']);
    b.reloadExtension(); // no startup event: the claim stays interrupted
    const w2 = await started(b);
    const listed = await w2.send({ action: 'listSnoozed' });
    expect(listed.items[0].waking).toBe('interrupted');

    const reply = await w2.send({ action: 'cancelSnoozed', id: 'r' });
    expect(reply.success).toBe(true);
    expect(reply.interrupted).toBe(true);
    expect(reply.discardedCount).toBe(2);
    expect(reply.record.tabs.map((t) => t.url)).toEqual([url('b'), url('c')]);
    expect(reply.record.waking).toBeUndefined();
    expect(reply.record.summary).toBe('2 selected tabs');
    expect(b.records()).toEqual([]);
    expect(b.snoozeAlarms()).toEqual([]);

    expect(await w2.send({ action: 'restoreSnoozed', record: reply.record })).toEqual({ success: true });
    const [back] = b.records();
    expect(back.waking).toBeUndefined();
    expect(back.tabs.map((t) => t.url)).toEqual([url('b'), url('c')]);
  });

  test('Undo never puts back a claim, even when handed one', async () => {
    const { b } = browserWith([]);
    const w = await started(b);
    const r = { ...record('r', 'tab', ['a']), waking: { by: 'x', boot: 'y', opened: [] } };
    await w.send({ action: 'restoreSnoozed', record: r });
    expect(b.record('r').waking).toBeUndefined();
  });
});

describe('the AI key alarm on worker start (L12)', () => {
  test('a key with a deadline and no alarm gets its alarm back', async () => {
    const { b } = browserWith([]);
    const expiresAt = Date.now() + 3600000;
    b.local.aiConfig = { key: btoa('sk-or-test'), expiresAt, expiryDuration: 3600000, model: 'm' };
    await started(b);
    expect(b.alarms.get('huddle-ai-key-expiry')).toMatchObject({ scheduledTime: expiresAt });
  });

  test('a key whose deadline passed while the worker was off is purged', async () => {
    const { b } = browserWith([]);
    b.local.aiConfig = { key: btoa('sk-or-test'), expiresAt: Date.now() - 1000, expiryDuration: 3600000, model: 'm' };
    await started(b);
    expect(b.local.aiConfig.key).toBeNull();
    expect(b.local.aiConfig.keyExpiredAt).toEqual(expect.any(Number));
  });
});
