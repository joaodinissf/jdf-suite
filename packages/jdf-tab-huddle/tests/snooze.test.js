// Unit tests for the Tab Snoozing feature (background + popup helpers).
// Globals are exposed via tests/setup.js. Storage is mocked with an in-memory
// object; `now` is always passed explicitly to date helpers for determinism.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const workerSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/background.js'), 'utf8');

// A new worker, as Chrome starts one after the last one stopped:
// background.js evaluated afresh (so nothing in memory carries over), over the
// same mocked chrome APIs and storage.
function startWorker() {
  return (0, eval)(`(function () {\n${workerSource}\nreturn { wakeSnoozedRecord, handleSnoozeAlarm, reconcileSnoozeAlarms };\n})()`);
}

// Lets pending promise callbacks run.
const flush = () => new Promise((r) => setTimeout(r, 0));

// Wire chrome.storage.local.{get,set} to an in-memory object. Like
// chrome.storage, it copies on the way in and on the way out: a change the
// worker makes to a record it read is stored only when it saves it. (Handing
// out live references let an unsaved change look saved.)
function useMemoryStore(initial = {}) {
  const store = structuredClone(initial);
  chrome.storage.local.get.mockImplementation((keys) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of arr) if (k in store) out[k] = structuredClone(store[k]);
    return Promise.resolve(out);
  });
  chrome.storage.local.set.mockImplementation((obj) => {
    Object.assign(store, structuredClone(obj));
    return Promise.resolve();
  });
  return store;
}

// Reference dates in January 2024. 2024-01-01 is a Monday, so:
// Mon 1, Tue 2, Wed 3, Thu 4, Fri 5, Sat 6, Sun 7, Mon 8, ... Sat 13.
const at = (day, hour = 10, min = 0) => new Date(2024, 0, day, hour, min, 0, 0).getTime();

describe('Tab Snoozing', () => {
  describe('computePresetWakeTime', () => {
    test('laterToday returns exactly now + 3h', () => {
      const now = at(3, 10);
      expect(computePresetWakeTime('laterToday', now)).toBe(now + 3 * 60 * 60 * 1000);
    });

    test('tonight at Wed 10:00 → Wed 18:00', () => {
      expect(computePresetWakeTime('tonight', at(3, 10))).toBe(at(3, 18));
    });

    test('tonight at Wed 18:00 and 21:30 → now + 1h', () => {
      expect(computePresetWakeTime('tonight', at(3, 18))).toBe(at(3, 18) + 60 * 60 * 1000);
      expect(computePresetWakeTime('tonight', at(3, 21, 30))).toBe(at(3, 21, 30) + 60 * 60 * 1000);
    });

    test('tomorrow at Wed 10:00 and Wed 23:59 → Thu 09:00', () => {
      expect(computePresetWakeTime('tomorrow', at(3, 10))).toBe(at(4, 9));
      expect(computePresetWakeTime('tomorrow', at(3, 23, 59))).toBe(at(4, 9));
    });

    test('weekend: Wed → this Sat; Sat 08:00 → today; Sat 10:00 → next Sat; Sun → next Sat', () => {
      expect(computePresetWakeTime('weekend', at(3, 10))).toBe(at(6, 9)); // Wed → Sat 6
      expect(computePresetWakeTime('weekend', at(6, 8))).toBe(at(6, 9)); // Sat 08:00 → Sat 09:00
      expect(computePresetWakeTime('weekend', at(6, 10))).toBe(at(13, 9)); // Sat 10:00 → next Sat 13
      expect(computePresetWakeTime('weekend', at(7, 10))).toBe(at(13, 9)); // Sun → next Sat 13
    });

    test('nextWeek: Fri → Mon (3 days); Mon 08:00 → +7d; Sun → tomorrow', () => {
      expect(computePresetWakeTime('nextWeek', at(5, 10))).toBe(at(8, 9)); // Fri → Mon 8
      expect(computePresetWakeTime('nextWeek', at(1, 8))).toBe(at(8, 9)); // Mon 08:00 → Mon 8 (+7d)
      expect(computePresetWakeTime('nextWeek', at(7, 10))).toBe(at(8, 9)); // Sun → Mon 8 (tomorrow)
    });

    test('every preset result is strictly in the future', () => {
      const nows = [at(3, 10), at(6, 8), at(6, 10), at(7, 23, 59), at(1, 8)];
      for (const now of nows) {
        for (const p of SNOOZE_PRESETS) {
          expect(computePresetWakeTime(p.key, now)).toBeGreaterThan(now);
        }
      }
    });

    test('unknown preset throws', () => {
      expect(() => computePresetWakeTime('nope', at(3, 10))).toThrow();
    });
  });

  describe('nextWeekdayAt', () => {
    test('strictlyAfterToday pushes a same-day target to next week', () => {
      // Monday target, from Monday → 7 days out.
      expect(nextWeekdayAt(at(1, 8), 1, 9, true)).toBe(at(8, 9));
    });
    test('non-strict allows today when the hour is still ahead', () => {
      expect(nextWeekdayAt(at(6, 8), 6, 9, false)).toBe(at(6, 9));
    });
  });

  describe('clampWakeAt', () => {
    test('past and near-now clamp to now + 60s; future passes through', () => {
      const now = at(3, 10);
      expect(clampWakeAt(now - 100000, now)).toBe(now + 60000);
      expect(clampWakeAt(now + 30000, now)).toBe(now + 60000);
      expect(clampWakeAt(now + 120000, now)).toBe(now + 120000);
    });
  });

  describe('isSnoozeableUrl', () => {
    test('allows http/https/file/about:blank/foreign chrome-extension', () => {
      expect(isSnoozeableUrl('https://example.com/x')).toBe(true);
      expect(isSnoozeableUrl('http://example.com/x')).toBe(true);
      expect(isSnoozeableUrl('file:///home/user/page.html')).toBe(true);
      expect(isSnoozeableUrl('about:blank')).toBe(true);
      expect(isSnoozeableUrl('chrome-extension://some-other-ext-id/page.html')).toBe(true);
    });

    test('rejects chrome/data/javascript/own-extension/empty/null', () => {
      expect(isSnoozeableUrl('chrome://settings/')).toBe(false);
      expect(isSnoozeableUrl('data:text/html,<h1>x</h1>')).toBe(false);
      expect(isSnoozeableUrl('javascript:void(0)')).toBe(false);
      // Own extension id in the setup mock is "test-id".
      expect(isSnoozeableUrl('chrome-extension://test-id/popup.html')).toBe(false);
      expect(isSnoozeableUrl('')).toBe(false);
      expect(isSnoozeableUrl(null)).toBe(false);
    });
  });

  describe('buildSnoozeSummary', () => {
    test('tab summary is the (truncated) title', () => {
      expect(buildSnoozeSummary('tab', [{ title: 'Example Domain' }])).toBe('Example Domain');
      const long = 'x'.repeat(80);
      expect(buildSnoozeSummary('tab', [{ title: long }]).length).toBe(60);
    });
    test('tabs summary counts tabs', () => {
      expect(buildSnoozeSummary('tabs', [{}, {}, {}])).toBe('3 selected tabs');
      expect(buildSnoozeSummary('tabs', [{}])).toBe('1 selected tab');
    });
    test('group summary uses title, (unnamed) when empty', () => {
      expect(buildSnoozeSummary('group', [{}, {}], { title: 'Research' })).toBe('Group "Research" (2 tabs)');
      expect(buildSnoozeSummary('group', [{}], { title: '' })).toBe('Group "(unnamed)" (1 tab)');
    });
    test('window summary counts tabs', () => {
      expect(buildSnoozeSummary('window', [{}, {}, {}, {}])).toBe('Window (4 tabs)');
      expect(buildSnoozeSummary('window', [{}])).toBe('Window (1 tab)');
    });
  });

  describe('createSnoozeRecord', () => {
    test('has id/createdAt/summary and sorts tabs by index', () => {
      const record = createSnoozeRecord({
        type: 'tabs',
        tabs: [
          { url: 'https://b.example.com/', title: 'B', pinned: false, index: 5 },
          { url: 'https://a.example.com/', title: 'A', pinned: false, index: 1 },
        ],
        windowId: 1,
        wakeAt: at(4, 9),
        preset: 'tomorrow',
      });
      expect(typeof record.id).toBe('string');
      expect(record.id.length).toBeGreaterThan(0);
      expect(typeof record.createdAt).toBe('number');
      expect(record.summary).toBe('2 selected tabs');
      expect(record.tabs.map((t) => t.index)).toEqual([1, 5]);
    });

    test('captures pinned + groupIndex for window type and groups array', () => {
      const record = createSnoozeRecord({
        type: 'window',
        tabs: [
          { url: 'https://p/', title: 'P', pinned: true, index: 0 },
          { url: 'https://g/', title: 'G', pinned: false, index: 1, groupIndex: 0 },
        ],
        groups: [{ title: 'Work', color: 'green' }],
        windowId: 2,
        wakeAt: at(4, 9),
        preset: 'custom',
      });
      expect(record.tabs[0].pinned).toBe(true);
      expect(record.tabs[1].groupIndex).toBe(0);
      expect(record.groups).toEqual([{ title: 'Work', color: 'green' }]);
    });

    test('captures group {title,color} for group type', () => {
      const record = createSnoozeRecord({
        type: 'group',
        tabs: [{ url: 'https://x/', title: 'X', pinned: false, index: 0 }],
        group: { title: 'Research', color: 'blue' },
        windowId: 1,
        wakeAt: at(4, 9),
        preset: 'tomorrow',
      });
      expect(record.group).toEqual({ title: 'Research', color: 'blue' });
    });

    test('truncates tab titles to 60 chars', () => {
      const record = createSnoozeRecord({
        type: 'tab',
        tabs: [{ url: 'https://x/', title: 'y'.repeat(90), pinned: false, index: 0 }],
        windowId: 1,
        wakeAt: at(4, 9),
        preset: 'tomorrow',
      });
      expect(record.tabs[0].title.length).toBe(60);
    });
  });

  describe('snoozeTabs (via handleSnoozeTab)', () => {
    test('persists the record before removing tabs, and creates the alarm', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1 },
      ]);
      // Two tabs remain after close → last-window guard is a no-op.
      chrome.windows.getAll.mockResolvedValue([
        { id: 1, tabs: [{ id: 10 }, { id: 11 }] },
      ]);
      chrome.tabs.remove.mockResolvedValue(undefined);

      // Future wakeAt so the past-time clamp passes it through unchanged.
      const wakeAt = Date.now() + 3600000;
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt, preset: 'tomorrow' }, sendResponse);

      const res = sendResponse.mock.calls[0][0];
      expect(res.success).toBe(true);
      const record = res.record;

      // Persist (storage.set) happens before chrome.tabs.remove.
      expect(chrome.storage.local.set.mock.invocationCallOrder[0])
        .toBeLessThan(chrome.tabs.remove.mock.invocationCallOrder[0]);

      // Alarm created with the record id and correct when.
      expect(chrome.alarms.create).toHaveBeenCalledWith('snooze:' + record.id, { when: wakeAt });

      // The tab was removed.
      expect(chrome.tabs.remove).toHaveBeenCalledWith([10]);
    });

    test('a close Chrome refuses leaves no sleeping record or alarm behind', async () => {
      const store = useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1 },
      ]);
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      chrome.tabs.remove.mockRejectedValue(new Error('Tabs cannot be edited right now'));
      // The tab is still open after the refused close.
      chrome.tabs.get.mockImplementation((id) => Promise.resolve({ id }));

      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Tabs cannot be edited right now' });
      expect(store.snoozedItems).toEqual([]);
      const alarmName = chrome.alarms.create.mock.calls[0][0];
      expect(chrome.alarms.clear).toHaveBeenCalledWith(alarmName);
      chrome.tabs.remove.mockReset();
      chrome.tabs.get.mockReset();
    });

    test('a close that fails partway keeps the tabs that did close asleep', async () => {
      // An earlier snooze in the store must come through the rewrite untouched.
      const earlier = {
        id: 'earlier', type: 'tab', summary: 'Old', wakeAt: at(5, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://old.example/', title: 'Old', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [earlier] });
      const tabs = [10, 11, 12, 13, 14].map((id, index) => ({
        id, url: `https://example.com/${id}`, title: `T${id}`, pinned: false, index, windowId: 1,
      }));
      chrome.tabs.query.mockResolvedValue(tabs);
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      // Chrome closed 10 and 11, then stopped at 12 (gone before the remove).
      chrome.tabs.remove.mockRejectedValue(new Error('No tab with id: 12.'));
      const closed = new Set([10, 11, 12]);
      chrome.tabs.get.mockImplementation((id) =>
        closed.has(id) ? Promise.reject(new Error(`No tab with id: ${id}.`)) : Promise.resolve({ id })
      );

      const sendResponse = vi.fn();
      await handleSnoozeSelected({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Snoozed 3 of 5 tabs; No tab with id: 12.',
      });
      // The stored record is the corrected one: the store hands out copies,
      // so only a save can change what it holds.
      expect(store.snoozedItems).toHaveLength(2);
      expect(store.snoozedItems[0]).toEqual(earlier);
      expect(store.snoozedItems[1].tabs.map((t) => t.url)).toEqual([
        'https://example.com/10', 'https://example.com/11', 'https://example.com/12',
      ]);
      expect(store.snoozedItems[1].summary).toBe('3 selected tabs');
      expect(chrome.alarms.clear).not.toHaveBeenCalled();
      chrome.tabs.remove.mockReset();
      chrome.tabs.get.mockReset();
    });

    test('non-snoozeable active tab → error and nothing removed', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'chrome://settings/', title: 'Settings', pinned: false, index: 0, windowId: 1 },
      ]);
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: at(4, 9), preset: 'tomorrow' }, sendResponse);

      const res = sendResponse.mock.calls[0][0];
      expect(res.success).toBe(false);
      expect(res.error).toBe("This page can't be snoozed");
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });

    test('last-window guard creates a chrome://newtab/ tab before closing', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1 },
      ]);
      // Single normal window whose only tab is the one being closed.
      chrome.windows.getAll.mockResolvedValue([{ id: 1, tabs: [{ id: 10 }] }]);
      chrome.tabs.create.mockResolvedValue({ id: 99 });
      chrome.tabs.remove.mockResolvedValue(undefined);

      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: at(4, 9), preset: 'tomorrow' }, sendResponse);

      expect(chrome.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'chrome://newtab/', active: true })
      );
      // The guard tab is created before the close.
      expect(chrome.tabs.create.mock.invocationCallOrder[0])
        .toBeLessThan(chrome.tabs.remove.mock.invocationCallOrder[0]);
    });

    describe('custom wake times', () => {
      const NOW = at(3, 10);
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      test('a custom time an hour ahead is stored as is, and its alarm set for it', async () => {
        const store = useMemoryStore();
        chrome.tabs.query.mockResolvedValue([
          { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1 },
        ]);
        chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
        chrome.tabs.remove.mockResolvedValue(undefined);
        const wakeAt = NOW + 3600000;

        const sendResponse = vi.fn();
        await handleSnoozeTab({ wakeAt, preset: 'custom' }, sendResponse);

        const res = sendResponse.mock.calls[0][0];
        expect(res.success).toBe(true);
        expect(res.record.wakeAt).toBe(wakeAt);
        expect(res.record.preset).toBe('custom');
        expect(store.snoozedItems).toHaveLength(1);
        expect(store.snoozedItems[0].wakeAt).toBe(wakeAt);
        expect(chrome.alarms.create).toHaveBeenCalledWith('snooze:' + res.record.id, { when: wakeAt });
        expect(chrome.tabs.remove).toHaveBeenCalledWith([10]);
      });

      test.each([
        ['30 s from now', NOW + 30000],
        ['30 s ago', NOW - 30000],
        ['not a number', String(NOW + 3600000)],
        ['NaN', Number.NaN],
        ['missing', undefined],
      ])('a custom time %s is refused, and nothing is snoozed', async (_label, wakeAt) => {
        const store = useMemoryStore();
        chrome.tabs.query.mockResolvedValue([
          { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1 },
        ]);
        const sendResponse = vi.fn();
        await handleSnoozeTab({ wakeAt, preset: 'custom' }, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Wake time is in the past' });
        expect(chrome.tabs.remove).not.toHaveBeenCalled();
        expect(chrome.alarms.create).not.toHaveBeenCalled();
        expect(store.snoozedItems).toBeUndefined();
      });
    });

    test('custom time in the past is rejected', async () => {
      useMemoryStore();
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: Date.now() - 100000, preset: 'custom' }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Wake time is in the past' });
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
    });

    test('single active incognito tab → refused with a clear error, nothing removed or persisted', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1, incognito: true },
      ]);
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: at(4, 9), preset: 'tomorrow' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: "Incognito tabs can't be snoozed" });
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('snoozeTabs incognito exclusion (multi-tab units)', () => {
    test('incognito tabs are silently excluded from a multi-tab snooze; non-incognito tabs still snooze', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1, incognito: false },
        { id: 11, url: 'https://example.com/b', title: 'B', pinned: false, index: 1, windowId: 1, incognito: true },
      ]);
      chrome.windows.getAll.mockResolvedValue([{ id: 1, tabs: [{ id: 10 }, { id: 11 }, { id: 12 }] }]);
      chrome.tabs.remove.mockResolvedValue(undefined);

      const sendResponse = vi.fn();
      await handleSnoozeSelected({ wakeAt: at(4, 9), preset: 'tomorrow' }, sendResponse);

      const res = sendResponse.mock.calls[0][0];
      expect(res.success).toBe(true);
      expect(res.record.tabs).toHaveLength(1);
      expect(res.record.tabs[0].url).toBe('https://example.com/a');
      // Only the non-incognito tab was closed; the incognito tab is untouched.
      expect(chrome.tabs.remove).toHaveBeenCalledWith([10]);
    });

    test('a selection that is entirely incognito reports the generic "nothing here" error', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', pinned: false, index: 0, windowId: 1, incognito: true },
        { id: 11, url: 'https://example.com/b', title: 'B', pinned: false, index: 1, windowId: 1, incognito: true },
      ]);
      const sendResponse = vi.fn();
      await handleSnoozeSelected({ wakeAt: at(4, 9), preset: 'tomorrow' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Nothing here can be snoozed' });
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
    });
  });

  describe('handleSnoozeGroup', () => {
    test('ungrouped active tab → error, nothing removed', async () => {
      useMemoryStore();
      chrome.tabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/a', title: 'A', groupId: -1, index: 0, windowId: 1 },
      ]);
      const sendResponse = vi.fn();
      await handleSnoozeGroup({ wakeAt: at(4, 9), preset: 'tomorrow' }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Active tab is not in a group' });
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
    });
  });

  describe('handleWakeNow', () => {
    test('a wake that failed says it will try again, not "Snooze not found"', async () => {
      const record = {
        id: 'r8', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://example.com/a', title: 'A', pinned: false, index: 0 }],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockRejectedValue(new Error('no window'));
      chrome.windows.getAll.mockResolvedValue([]);
      chrome.windows.create.mockRejectedValue(new Error('cannot create window'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const sendResponse = vi.fn();
      await handleWakeNow({ id: 'r8' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Couldn\'t wake these tabs right now — Huddle will try again in a minute',
      });
      console.error.mockRestore();
    });

    test('a wake that reopens nothing reports it and keeps the record', async () => {
      const record = {
        id: 'r9', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'file:///secret.html', title: 'A', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockRejectedValue(new Error('Cannot access file URLs'));

      const sendResponse = vi.fn();
      await handleWakeNow({ id: 'r9' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Could not reopen 1 tab — kept in the nap room',
        createdCount: 0,
        failedCount: 1,
      });
      expect(store.snoozedItems).toEqual([record]);
      // No retry alarm: the same URL would be refused again. (The wake armed
      // one while it ran; keeping the record clears it.)
      expect(chrome.alarms.clear).toHaveBeenLastCalledWith('snooze:r9');
      const lastCreate = Math.max(...chrome.alarms.create.mock.invocationCallOrder);
      expect(Math.max(...chrome.alarms.clear.mock.invocationCallOrder)).toBeGreaterThan(lastCreate);
    });

    test('a partial wake reports how many tabs reopened and how many failed', async () => {
      const record = {
        id: 'r10', type: 'tabs', summary: '2 selected tabs', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        tabs: [
          { url: 'https://a/', title: 'A', pinned: false, index: 0 },
          { url: 'file:///b.html', title: 'B', pinned: false, index: 1 },
        ],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create
        .mockResolvedValueOnce({ id: 60 })
        .mockRejectedValueOnce(new Error('Cannot access file URLs'));

      const sendResponse = vi.fn();
      await handleWakeNow({ id: 'r10' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ success: true, createdCount: 1, failedCount: 1 });
      expect(store.snoozedItems).toEqual([]);
    });
  });

  describe('handleCancelSnooze', () => {
    test('removes the record, clears the alarm, never recreates tabs', async () => {
      const record = {
        id: 'abc', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://x/', title: 'A', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      const sendResponse = vi.fn();
      await handleCancelSnooze({ id: 'abc' }, sendResponse);

      expect(store.snoozedItems).toEqual([]);
      expect(chrome.alarms.clear).toHaveBeenCalledWith('snooze:abc');
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      // The removed record comes back so the UI can offer Undo.
      expect(sendResponse).toHaveBeenCalledWith({ success: true, record });
    });

    test('reports failure without a record when the id is unknown', async () => {
      useMemoryStore({ snoozedItems: [] });
      const sendResponse = vi.fn();
      await handleCancelSnooze({ id: 'missing' }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, record: undefined });
    });
  });

  describe('handleRestoreSnoozed (Undo a discard)', () => {
    const record = {
      id: 'abc', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
      windowId: 1, tabs: [{ url: 'https://x/', title: 'A', pinned: false, index: 0 }],
    };

    test('puts the record back and re-arms its alarm', async () => {
      const store = useMemoryStore({ snoozedItems: [] });
      const sendResponse = vi.fn();
      await handleRestoreSnoozed({ record }, sendResponse);
      expect(store.snoozedItems).toEqual([record]);
      expect(chrome.alarms.create).toHaveBeenCalledWith('snooze:abc', { when: record.wakeAt });
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('discard then undo round-trips to the original store', async () => {
      const store = useMemoryStore({ snoozedItems: [record] });
      const discarded = vi.fn();
      await handleCancelSnooze({ id: 'abc' }, discarded);
      await handleRestoreSnoozed({ record: discarded.mock.calls[0][0].record }, vi.fn());
      expect(store.snoozedItems).toEqual([record]);
    });

    test('never duplicates a record that is already present', async () => {
      const store = useMemoryStore({ snoozedItems: [record] });
      const sendResponse = vi.fn();
      await handleRestoreSnoozed({ record }, sendResponse);
      expect(store.snoozedItems).toEqual([record]);
      expect(chrome.alarms.create).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ success: false });
    });

    test('rejects a malformed record without touching storage', async () => {
      const store = useMemoryStore({ snoozedItems: [] });
      const sendResponse = vi.fn();
      await handleRestoreSnoozed({ record: { id: 'x' } }, sendResponse);
      expect(store.snoozedItems).toEqual([]);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid snooze record' });
    });

    test('rejects a record with an address Huddle never snoozes, so a wake can never open it', async () => {
      for (const url of ['chrome://settings/', 'chrome-extension://test-id/options.html', 'javascript:alert(1)', '']) {
        const store = useMemoryStore({ snoozedItems: [] });
        chrome.alarms.create.mockClear();
        const sendResponse = vi.fn();
        const tabs = [...record.tabs, { url, title: 'S', pinned: false, index: 1 }];
        await handleRestoreSnoozed({ record: { ...record, tabs } }, sendResponse);
        expect(store.snoozedItems).toEqual([]);
        expect(chrome.alarms.create).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid snooze record' });
      }
    });
  });

  describe('handleListSnoozed', () => {
    test('responds with items sorted ascending by wakeAt', async () => {
      useMemoryStore({
        snoozedItems: [
          { id: 'b', wakeAt: at(5, 9) },
          { id: 'a', wakeAt: at(4, 9) },
        ],
      });
      const sendResponse = vi.fn();
      await handleListSnoozed(sendResponse);
      const res = sendResponse.mock.calls[0][0];
      expect(res.success).toBe(true);
      expect(res.items.map((i) => i.id)).toEqual(['a', 'b']);
    });
  });

  describe('wakeSnoozedRecord / restoreSnoozedRecord', () => {
    test('restores tab records with active:false in the last-focused window, notifies when asked', async () => {
      const record = {
        id: 'r1', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        tabs: [{ url: 'https://example.com/a', title: 'A', pinned: false, index: 0 }],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockResolvedValue({ id: 50 });

      const result = await wakeSnoozedRecord('r1', { notify: true });

      expect(chrome.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({ windowId: 5, url: 'https://example.com/a', active: false, pinned: false })
      );
      expect(chrome.alarms.clear).toHaveBeenCalledWith('snooze:r1');
      expect(chrome.notifications.create).toHaveBeenCalled();
      expect(result.createdCount).toBe(1);
      // A single tab comes back on its own, in no group.
      expect(chrome.tabs.group).not.toHaveBeenCalled();
    });

    test('does not notify when notify:false', async () => {
      const record = {
        id: 'r2', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://example.com/a', title: 'A', pinned: false, index: 0 }],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockResolvedValue({ id: 50 });

      await wakeSnoozedRecord('r2', { notify: false });
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('restores pinned tabs and regroups group records with title/color', async () => {
      const record = {
        id: 'r3', type: 'group', summary: 'Group', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        group: { title: 'Research', color: 'blue' },
        tabs: [
          { url: 'https://a/', title: 'A', pinned: true, index: 0 },
          { url: 'https://b/', title: 'B', pinned: false, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      let next = 100;
      chrome.tabs.create.mockImplementation(() => Promise.resolve({ id: next++ }));
      chrome.tabs.group.mockResolvedValue(7);

      await wakeSnoozedRecord('r3', { notify: false });

      // Pinned tab created with pinned:true.
      expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a/', pinned: true }));
      // Regrouped with the stored title/color.
      expect(chrome.tabs.group).toHaveBeenCalledWith(
        expect.objectContaining({ tabIds: [100, 101], createProperties: { windowId: 5 } })
      );
      expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, { title: 'Research', color: 'blue' });
    });

    test('window records recreate a window via windows.create({ url: [...], focused: false })', async () => {
      const record = {
        id: 'r4', type: 'window', summary: 'Window (2 tabs)', wakeAt: at(4, 9), preset: 'custom',
        windowId: 9,
        tabs: [
          { url: 'https://one/', title: 'One', pinned: false, index: 0 },
          { url: 'https://two/', title: 'Two', pinned: true, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.create.mockResolvedValue({ id: 77, tabs: [{ id: 1 }, { id: 2 }] });
      chrome.tabs.update.mockResolvedValue(undefined);

      const result = await wakeSnoozedRecord('r4', { notify: false });

      expect(chrome.windows.create).toHaveBeenCalledWith({
        url: ['https://one/', 'https://two/'],
        focused: false,
      });
      // The pinned tab is re-pinned after window creation.
      expect(chrome.tabs.update).toHaveBeenCalledWith(2, { pinned: true });
      expect(result.createdCount).toBe(2);
    });

    test('unknown id → silent no-op (no creates, no notification)', async () => {
      useMemoryStore({ snoozedItems: [] });
      const result = await wakeSnoozedRecord('nope', { notify: true });
      expect(result).toBeNull();
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.windows.create).not.toHaveBeenCalled();
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('a failing tabs.create does not abort remaining tabs and increments failedCount', async () => {
      const record = {
        id: 'r5', type: 'tabs', summary: '2 selected tabs', wakeAt: at(4, 9), preset: 'laterToday',
        windowId: 1,
        tabs: [
          { url: 'https://a/', title: 'A', pinned: false, index: 0 },
          { url: 'https://b/', title: 'B', pinned: false, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create
        .mockRejectedValueOnce(new Error('cannot create'))
        .mockResolvedValueOnce({ id: 60 });

      const result = await wakeSnoozedRecord('r5', { notify: false });
      expect(result.failedCount).toBe(1);
      expect(result.createdCount).toBe(1);
      // Selected tabs come back as loose tabs, not in a new group.
      expect(chrome.tabs.group).not.toHaveBeenCalled();
    });

    test('waking a "tabs" record leaves every reopened tab ungrouped', async () => {
      const record = {
        id: 'r5b', type: 'tabs', summary: '2 selected tabs', wakeAt: at(4, 9), preset: 'laterToday',
        windowId: 1,
        tabs: [
          { url: 'https://a/', title: 'A', pinned: false, index: 0 },
          { url: 'https://b/', title: 'B', pinned: false, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      let next = 400;
      chrome.tabs.create.mockImplementation(() => Promise.resolve({ id: next++ }));

      const result = await wakeSnoozedRecord('r5b', { notify: false });
      expect(result.createdCount).toBe(2);
      expect(chrome.tabs.group).not.toHaveBeenCalled();
      expect(chrome.tabGroups.update).not.toHaveBeenCalled();
    });

    test('a group record none of whose tabs reopen makes no empty group', async () => {
      const record = {
        id: 'r5c', type: 'group', summary: 'Group', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, group: { title: 'Research', color: 'blue' },
        tabs: [{ url: 'file:///a.html', title: 'A', pinned: false, index: 0 }],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockRejectedValue(new Error('Cannot access file URLs'));

      const result = await wakeSnoozedRecord('r5c', { notify: false });
      expect(result.createdCount).toBe(0);
      expect(chrome.tabs.group).not.toHaveBeenCalled();
      chrome.tabs.create.mockReset();
    });

    test('a wake that throws (e.g. window creation) keeps the record and wakes it again in a minute', async () => {
      const record = {
        id: 'r6', type: 'tab', summary: 'A', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://example.com/a', title: 'A', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      // No window is open and the create-a-window fallback fails, so
      // getRestoreTargetWindowId (and therefore restoreSnoozedRecord) throws.
      chrome.windows.getLastFocused.mockRejectedValue(new Error('no window'));
      chrome.windows.getAll.mockResolvedValue([]);
      chrome.windows.create.mockRejectedValue(new Error('cannot create window'));

      const before = Date.now();
      await expect(wakeSnoozedRecord('r6', { notify: true })).rejects.toThrow('cannot create window');

      // The record never left storage.
      expect(store.snoozedItems).toEqual([record]);
      // Its alarm, armed about a minute out when the wake began, is not cleared.
      expect(chrome.alarms.create).toHaveBeenLastCalledWith('snooze:r6', { when: expect.any(Number) });
      const { when } = chrome.alarms.create.mock.lastCall[1];
      expect(when - before).toBeGreaterThanOrEqual(60000);
      expect(when - Date.now()).toBeLessThanOrEqual(60000);
      expect(chrome.alarms.clear).not.toHaveBeenCalled();
      // A failed restore must never fire the "tabs are back" notification.
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    test('notifyWake reports the ACTUAL restored count (createdCount), not the intended tab count', async () => {
      const record = {
        id: 'r7', type: 'tabs', summary: '3 selected tabs', wakeAt: at(4, 9), preset: 'laterToday',
        windowId: 1,
        tabs: [
          { url: 'https://a/', title: 'A', pinned: false, index: 0 },
          { url: 'https://b/', title: 'B', pinned: false, index: 1 },
          { url: 'https://c/', title: 'C', pinned: false, index: 2 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create
        .mockResolvedValueOnce({ id: 60 })
        .mockRejectedValueOnce(new Error('cannot create'))
        .mockResolvedValueOnce({ id: 61 });

      const result = await wakeSnoozedRecord('r7', { notify: true });

      expect(result.createdCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'snooze-wake:r7',
        expect.objectContaining({ message: '2 tabs are back — 1 could not be reopened' })
      );
    });
  });

  describe('where a wake opens (M6, L13)', () => {
    const twoTabs = (id) => ({
      id, type: 'tabs', summary: '2 selected tabs', wakeAt: at(4, 9), preset: 'tomorrow', windowId: 1,
      tabs: [
        { url: 'https://a/', title: 'A', pinned: false, index: 0 },
        { url: 'https://b/', title: 'B', pinned: false, index: 1 },
      ],
    });
    let next;
    beforeEach(() => {
      next = 500;
      chrome.tabs.create.mockImplementation(async (props) => ({ id: next++, windowId: props.windowId }));
      chrome.tabs.remove.mockResolvedValue(undefined);
    });

    test('with an incognito window focused, the tabs open in a regular window', async () => {
      useMemoryStore({ snoozedItems: [twoTabs('w1')] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 3, incognito: true });
      chrome.windows.getAll.mockResolvedValue([{ id: 3, incognito: true }, { id: 5, incognito: false }]);

      await wakeSnoozedRecord('w1', { notify: false });

      expect(chrome.tabs.create.mock.calls.map(([p]) => [p.windowId, p.url])).toEqual([[5, 'https://a/'], [5, 'https://b/']]);
      expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    test('with only incognito windows open, a regular window is made for them', async () => {
      useMemoryStore({ snoozedItems: [twoTabs('w2')] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 3, incognito: true });
      chrome.windows.getAll.mockResolvedValue([{ id: 3, incognito: true }]);
      chrome.windows.create.mockResolvedValue({ id: 40, incognito: false, tabs: [{ id: 400 }] });

      await wakeSnoozedRecord('w2', { notify: false });

      expect(chrome.windows.create).toHaveBeenCalledWith({ focused: false });
      expect(chrome.tabs.create.mock.calls.map(([p]) => p.windowId)).toEqual([40, 40]);
    });

    test('with no window open, the new window holds the woken tabs and no New Tab', async () => {
      const store = useMemoryStore({ snoozedItems: [twoTabs('w3')] });
      chrome.windows.getLastFocused.mockRejectedValue(new Error('No last-focused window'));
      chrome.windows.getAll.mockResolvedValue([]);
      chrome.windows.create.mockResolvedValue({ id: 40, incognito: false, tabs: [{ id: 400 }] });

      await wakeSnoozedRecord('w3', { notify: false });

      expect(chrome.tabs.create.mock.calls.map(([p]) => p.windowId)).toEqual([40, 40]);
      expect(chrome.tabs.remove.mock.calls).toEqual([[400]]);
      // The New Tab goes only once a woken tab is in, so the window never closes.
      expect(chrome.tabs.remove.mock.invocationCallOrder[0]).toBeGreaterThan(chrome.tabs.create.mock.invocationCallOrder[0]);
      expect(store.snoozedItems).toEqual([]);
    });

    test('with no window open and every tab failing, the New Tab stays so the window does not close', async () => {
      const record = twoTabs('w4');
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockRejectedValue(new Error('No last-focused window'));
      chrome.windows.getAll.mockResolvedValue([]);
      chrome.windows.create.mockResolvedValue({ id: 40, incognito: false, tabs: [{ id: 400 }] });
      chrome.tabs.create.mockRejectedValue(new Error('Cannot open'));

      await wakeSnoozedRecord('w4', { notify: false });

      expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
      expect(store.snoozedItems).toEqual([record]);
    });
  });

  describe('wake failures and counts', () => {
    test('an alarm wake that reopens nothing says so instead of "is back", and keeps the record', async () => {
      const record = {
        id: 'r11', type: 'tab', summary: 'Local page', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'file:///page.html', title: 'Local page', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockRejectedValue(new Error('Cannot access file URLs'));

      const result = await wakeSnoozedRecord('r11', { notify: true });

      expect(result.kept).toBe(true);
      expect(store.snoozedItems).toEqual([record]);
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'snooze-wake:r11',
        expect.objectContaining({ message: '"Local page" could not be reopened — it is still in the nap room' })
      );
    });

    test('Wake now on a record not due yet that reopens nothing keeps its own wake time', async () => {
      const wakeAt = Date.now() + 3600000;
      const record = {
        id: 'early', type: 'tab', summary: 'Local page', wakeAt, preset: 'custom',
        windowId: 1, tabs: [{ url: 'file:///page.html', title: 'Local page', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockRejectedValue(new Error('Cannot access file URLs'));

      const result = await wakeSnoozedRecord('early', { notify: false });

      expect(result.kept).toBe(true);
      expect(store.snoozedItems).toEqual([record]);
      expect(chrome.alarms.create).toHaveBeenLastCalledWith('snooze:early', { when: wakeAt });
    });

    test('several tabs that all fail to reopen read "they are still in the nap room"', async () => {
      const record = {
        id: 'r14', type: 'tabs', summary: '2 selected tabs', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        tabs: [
          { url: 'file:///a.html', title: 'A', pinned: false, index: 0 },
          { url: 'file:///b.html', title: 'B', pinned: false, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockRejectedValue(new Error('Cannot access file URLs'));

      await wakeSnoozedRecord('r14', { notify: true });

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'snooze-wake:r14',
        expect.objectContaining({ message: '2 tabs could not be reopened — they are still in the nap room' })
      );
    });

    test('one woken tab reads "1 tab is back"', async () => {
      const record = {
        id: 'r12', type: 'tabs', summary: '2 selected tabs', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        tabs: [
          { url: 'https://a/', title: 'A', pinned: false, index: 0 },
          { url: 'file:///b.html', title: 'B', pinned: false, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create
        .mockResolvedValueOnce({ id: 60 })
        .mockRejectedValueOnce(new Error('Cannot access file URLs'));

      await wakeSnoozedRecord('r12', { notify: true });

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'snooze-wake:r12',
        expect.objectContaining({ message: '1 tab is back — 1 could not be reopened' })
      );
    });

    test('a window Chrome refuses as a whole reopens its other tabs one by one', async () => {
      const record = {
        id: 'r13', type: 'window', summary: 'Window (3 tabs)', wakeAt: at(4, 9), preset: 'custom',
        windowId: 9,
        groups: [{ title: 'Work', color: 'blue' }],
        tabs: [
          { url: 'https://one/', title: 'One', pinned: false, index: 0, groupIndex: 0 },
          { url: 'file:///two.html', title: 'Two', pinned: false, index: 1 },
          { url: 'https://three/', title: 'Three', pinned: true, index: 2, groupIndex: 0 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.create
        .mockRejectedValueOnce(new Error('Cannot access file URLs'))
        .mockResolvedValueOnce({ id: 77, tabs: [{ id: 900 }] }); // the New Tab placeholder
      chrome.tabs.create
        .mockResolvedValueOnce({ id: 1 })
        .mockRejectedValueOnce(new Error('Cannot access file URLs'))
        .mockResolvedValueOnce({ id: 3 });
      chrome.tabs.update.mockResolvedValue(undefined);
      chrome.tabs.remove.mockResolvedValue(undefined);
      chrome.tabs.group.mockResolvedValue(40);

      const result = await wakeSnoozedRecord('r13', { notify: true });

      for (const url of ['https://one/', 'file:///two.html', 'https://three/']) {
        expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 77, url }));
      }
      expect(result.createdCount).toBe(2);
      expect(result.failedCount).toBe(1);
      // The placeholder New Tab goes, and is never pinned or grouped.
      expect(chrome.tabs.remove).toHaveBeenCalledWith(900);
      expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.update).toHaveBeenCalledWith(3, { pinned: true });
      expect(chrome.tabs.group).toHaveBeenCalledWith(expect.objectContaining({ tabIds: [1, 3] }));
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'snooze-wake:r13',
        expect.objectContaining({ message: 'Window restored (2 tabs) — 1 could not be reopened' })
      );
    });

    test('a window whose every tab is refused closes the empty window and keeps the record', async () => {
      const record = {
        id: 'r14', type: 'window', summary: 'Window (1 tab)', wakeAt: at(4, 9), preset: 'custom',
        windowId: 9, tabs: [{ url: 'file:///two.html', title: 'Two', pinned: false, index: 0 }],
      };
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.create
        .mockRejectedValueOnce(new Error('Cannot access file URLs'))
        .mockResolvedValueOnce({ id: 78, tabs: [{ id: 901 }] });
      chrome.windows.remove.mockResolvedValue(undefined);
      chrome.tabs.create.mockRejectedValue(new Error('Cannot access file URLs'));

      const result = await wakeSnoozedRecord('r14', { notify: false });

      expect(result.createdCount).toBe(0);
      expect(chrome.windows.remove).toHaveBeenCalledWith(78);
      expect(store.snoozedItems).toEqual([record]);
    });
  });

  describe('a window snooze keeps its tab groups', () => {
    // Window 1: two tabs in "Work" (blue), one loose tab, and one tab in a
    // group Chrome can no longer describe (tabGroups.get fails), which keeps
    // its members together with the fallback title and colour.
    const WINDOW_TABS = [
      { id: 10, url: 'https://a.example/', title: 'A', pinned: true, index: 0, windowId: 1, groupId: -1 },
      { id: 11, url: 'https://b.example/', title: 'B', pinned: false, index: 1, windowId: 1, groupId: 100 },
      { id: 12, url: 'https://c.example/', title: 'C', pinned: false, index: 2, windowId: 1, groupId: 100 },
      { id: 13, url: 'https://d.example/', title: 'D', pinned: false, index: 3, windowId: 1, groupId: -1 },
      { id: 14, url: 'https://e.example/', title: 'E', pinned: false, index: 4, windowId: 1, groupId: 200 },
    ];

    async function snoozeGroupedWindow() {
      const store = useMemoryStore();
      chrome.tabs.query.mockResolvedValue(WINDOW_TABS);
      chrome.tabGroups.get.mockImplementation((gid) => (gid === 100
        ? Promise.resolve({ id: 100, title: 'Work', color: 'blue' })
        : Promise.reject(new Error(`No group with id: ${gid}.`))));
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      chrome.tabs.remove.mockResolvedValue(undefined);
      const sendResponse = vi.fn();
      await handleSnoozeWindow({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, sendResponse);
      return { store, res: sendResponse.mock.calls[0][0] };
    }

    afterEach(() => {
      chrome.tabGroups.get.mockReset();
    });

    test('snoozing stores each group once and each tab\'s place in it', async () => {
      const { store, res } = await snoozeGroupedWindow();
      expect(res.success).toBe(true);
      expect(chrome.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
      const [record] = store.snoozedItems;
      expect(record.type).toBe('window');
      expect(record.windowId).toBe(1);
      expect(record.groups).toEqual([
        { title: 'Work', color: 'blue' },
        { title: '', color: 'grey' },
      ]);
      expect(record.tabs).toEqual([
        { url: 'https://a.example/', title: 'A', pinned: true, index: 0 },
        { url: 'https://b.example/', title: 'B', pinned: false, index: 1, groupIndex: 0 },
        { url: 'https://c.example/', title: 'C', pinned: false, index: 2, groupIndex: 0 },
        { url: 'https://d.example/', title: 'D', pinned: false, index: 3 },
        { url: 'https://e.example/', title: 'E', pinned: false, index: 4, groupIndex: 1 },
      ]);
      expect(chrome.tabs.remove).toHaveBeenCalledWith([10, 11, 12, 13, 14]);
    });

    test('a selected-tabs snooze of grouped tabs stores no groups: only a window keeps them', async () => {
      const store = useMemoryStore();
      chrome.tabs.query.mockResolvedValue(WINDOW_TABS.slice(1, 3).map((t) => ({ ...t, highlighted: true })));
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      chrome.tabs.remove.mockResolvedValue(undefined);
      await handleSnoozeSelected({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, vi.fn());
      const [record] = store.snoozedItems;
      expect(record.type).toBe('tabs');
      expect(record.groups).toBeUndefined();
      expect(record.tabs.some((t) => 'groupIndex' in t)).toBe(false);
    });

    test('a group none of whose tabs reopen is not recreated empty', async () => {
      const record = {
        id: 'w3', type: 'window', summary: 'Window (2 tabs)', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        groups: [{ title: 'Local', color: 'red' }, { title: 'Web', color: 'blue' }],
        tabs: [
          { url: 'file:///a.html', title: 'A', pinned: false, index: 0, groupIndex: 0 },
          { url: 'https://b/', title: 'B', pinned: false, index: 1, groupIndex: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      // Chrome refuses the whole URL list over the file: page, so the tabs
      // are reopened one by one, and the file: one fails.
      chrome.windows.create
        .mockRejectedValueOnce(new Error('Cannot access file URLs'))
        .mockResolvedValueOnce({ id: 72, tabs: [{ id: 720 }] });
      chrome.tabs.create.mockImplementation(({ url }) => (url.startsWith('file:')
        ? Promise.reject(new Error('Cannot access file URLs'))
        : Promise.resolve({ id: 721 })));
      chrome.tabs.remove.mockResolvedValue(undefined);
      chrome.tabs.group.mockResolvedValue(91);
      chrome.tabGroups.update.mockResolvedValue(undefined);

      const result = await wakeSnoozedRecord('w3', { notify: false });

      expect(result.createdCount).toBe(1);
      expect(chrome.tabs.group.mock.calls).toEqual([[{ tabIds: [721], createProperties: { windowId: 72 } }]]);
      expect(chrome.tabGroups.update.mock.calls).toEqual([[91, { title: 'Web', color: 'blue' }]]);
      chrome.tabs.create.mockReset();
      chrome.windows.create.mockReset();
    });

    test('a window with no groups stores none', async () => {
      const store = useMemoryStore();
      chrome.tabs.query.mockResolvedValue(WINDOW_TABS.map((t) => ({ ...t, groupId: -1 })));
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      chrome.tabs.remove.mockResolvedValue(undefined);
      await handleSnoozeWindow({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, vi.fn());
      const [record] = store.snoozedItems;
      expect(record.groups).toBeUndefined();
      expect(record.tabs.some((t) => 'groupIndex' in t)).toBe(false);
      expect(chrome.tabGroups.get).not.toHaveBeenCalled();
    });

    test('waking it recreates both groups with their titles, colours and exact members', async () => {
      const { store } = await snoozeGroupedWindow();
      const [record] = store.snoozedItems;
      chrome.windows.create.mockResolvedValue({
        id: 70, tabs: [{ id: 700 }, { id: 701 }, { id: 702 }, { id: 703 }, { id: 704 }],
      });
      chrome.tabs.update.mockResolvedValue(undefined);
      let nextGroup = 80;
      chrome.tabs.group.mockImplementation(() => Promise.resolve(nextGroup++));
      chrome.tabGroups.update.mockResolvedValue(undefined);

      const result = await wakeSnoozedRecord(record.id, { notify: false });

      expect(result.createdCount).toBe(5);
      expect(chrome.windows.create).toHaveBeenCalledWith({
        url: ['https://a.example/', 'https://b.example/', 'https://c.example/', 'https://d.example/', 'https://e.example/'],
        focused: false,
      });
      expect(chrome.tabs.group.mock.calls).toEqual([
        [{ tabIds: [701, 702], createProperties: { windowId: 70 } }],
        [{ tabIds: [704], createProperties: { windowId: 70 } }],
      ]);
      expect(chrome.tabGroups.update.mock.calls).toEqual([
        [80, { title: 'Work', color: 'blue' }],
        [81, { title: '', color: 'grey' }],
      ]);
      expect(chrome.tabs.update).toHaveBeenCalledWith(700, { pinned: true });
    });

    test('a stored group with no title or colour comes back unnamed and grey', async () => {
      const record = {
        id: 'w2', type: 'window', summary: 'Window (2 tabs)', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1,
        groups: [{}],
        tabs: [
          { url: 'https://a/', title: 'A', pinned: false, index: 0, groupIndex: 0 },
          { url: 'https://b/', title: 'B', pinned: false, index: 1 },
        ],
      };
      useMemoryStore({ snoozedItems: [record] });
      chrome.windows.create.mockResolvedValue({ id: 71, tabs: [{ id: 710 }, { id: 711 }] });
      chrome.tabs.group.mockResolvedValue(90);
      chrome.tabGroups.update.mockResolvedValue(undefined);

      await wakeSnoozedRecord('w2', { notify: false });

      expect(chrome.tabs.group.mock.calls).toEqual([[{ tabIds: [710], createProperties: { windowId: 71 } }]]);
      expect(chrome.tabGroups.update.mock.calls).toEqual([[90, { title: '', color: 'grey' }]]);
    });
  });

  describe('handleSnoozeAlarm', () => {
    // Two sleeping records, and no aiConfig: the AI key alarm's own listener
    // then has nothing to purge, so any change comes from the snooze handler.
    const seed = () => [
      {
        id: 'g1', type: 'tab', summary: 'One', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://one.example/', title: 'One', pinned: false, index: 0 }],
      },
      {
        id: 'g2', type: 'tab', summary: 'Two', wakeAt: at(5, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://two.example/', title: 'Two', pinned: false, index: 0 }],
      },
    ];
    // Lets every promise chain an alarm started run to its end.
    const settleAll = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };

    beforeEach(() => {
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      let next = 300;
      chrome.tabs.create.mockImplementation(() => Promise.resolve({ id: next++ }));
    });

    test('the AI key alarm and any other alarm wake nothing', async () => {
      const store = useMemoryStore({ snoozedItems: seed() });
      chrome.alarms.onAlarm.callListeners({ name: AI_KEY_ALARM });
      chrome.alarms.onAlarm.callListeners({ name: 'other' });
      // Same length of prefix as "snooze:", so without the prefix check its
      // tail would name record g1.
      chrome.alarms.onAlarm.callListeners({ name: 'wakeup:g1' });
      await settleAll();
      expect(AI_KEY_ALARM).toBe('huddle-ai-key-expiry');
      expect(store.snoozedItems).toEqual(seed());
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    test('an alarm with no name, or a name that is not a string, is ignored without throwing', async () => {
      const store = useMemoryStore({ snoozedItems: seed() });
      for (const alarm of [undefined, null, {}, { name: 42 }]) {
        expect(() => handleSnoozeAlarm(alarm)).not.toThrow();
      }
      await settleAll();
      expect(store.snoozedItems).toEqual(seed());
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    test('a snooze:<id> alarm wakes that record only', async () => {
      const store = useMemoryStore({ snoozedItems: seed() });
      chrome.alarms.onAlarm.callListeners({ name: 'snooze:g1' });
      await settleAll();
      expect(store.snoozedItems).toEqual([seed()[1]]);
      expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://one.example/', windowId: 5, active: false }));
      expect(chrome.notifications.create).toHaveBeenCalledWith('snooze-wake:g1', expect.anything());
    });
  });

  describe('clicking a notification', () => {
    test('a wake notification focuses the woken window and activates its first tab', async () => {
      useMemoryStore({ snoozedItems: [{
        id: 'g1', type: 'tab', summary: 'One', wakeAt: at(4, 9), preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://one.example/', title: 'One', pinned: false, index: 0 }],
      }] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockResolvedValue({ id: 300 });
      await wakeSnoozedRecord('g1', { notify: true });

      await handleWakeNotificationClicked('snooze-wake:g1');

      expect(chrome.notifications.clear).toHaveBeenCalledWith('snooze-wake:g1');
      expect(chrome.windows.update).toHaveBeenCalledWith(5, { focused: true });
      expect(chrome.tabs.update).toHaveBeenCalledWith(300, { active: true });
    });

    test('one with no stored target (a split notice, or one from a stopped worker) is only cleared', async () => {
      await handleWakeNotificationClicked('split:1700000000000');

      expect(chrome.notifications.clear).toHaveBeenCalledWith('split:1700000000000');
      expect(chrome.windows.update).not.toHaveBeenCalled();
      expect(chrome.tabs.update).not.toHaveBeenCalled();
    });
  });

  describe('reconcileSnoozeAlarms', () => {
    test('wakes past-due records; re-arms missing future alarms; leaves live ones', async () => {
      const now = Date.now();
      const pastRec = {
        id: 'past', type: 'tab', summary: 'A', wakeAt: now - 1000, preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://a/', title: 'A', pinned: false, index: 0 }],
      };
      const futureLive = { id: 'live', type: 'tab', wakeAt: now + 3600000, tabs: [] };
      const futureMissing = { id: 'missing', type: 'tab', wakeAt: now + 7200000, tabs: [] };
      const store = useMemoryStore({ snoozedItems: [pastRec, futureLive, futureMissing] });

      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockResolvedValue({ id: 50 });
      chrome.alarms.getAll.mockResolvedValue([{ name: 'snooze:live' }]);

      await reconcileSnoozeAlarms();

      // Past-due woken (restored + notified) and removed from storage.
      expect(chrome.notifications.create).toHaveBeenCalled();
      expect(store.snoozedItems.find((r) => r.id === 'past')).toBeUndefined();

      // Missing future alarm re-created; live one untouched.
      expect(chrome.alarms.create).toHaveBeenCalledWith('snooze:missing', { when: futureMissing.wakeAt });
      expect(chrome.alarms.create).not.toHaveBeenCalledWith('snooze:live', expect.anything());
    });

    test('wakes past-due records one at a time: none leaves storage before its own tabs are open (M2)', async () => {
      const now = Date.now();
      const mkPast = (id) => ({
        id, type: 'tab', summary: id, wakeAt: now - 1000, preset: 'tomorrow',
        windowId: 1, tabs: [{ url: `https://${id}/`, title: id, pinned: false, index: 0 }],
      });
      const store = useMemoryStore({ snoozedItems: [mkPast('p1'), mkPast('p2'), mkPast('p3')] });

      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      // What storage held as each tab was created.
      const storedAtCreate = [];
      chrome.tabs.create.mockImplementation(({ url }) => {
        storedAtCreate.push([url, store.snoozedItems.map((r) => r.id)]);
        return Promise.resolve({ id: 50 });
      });
      chrome.alarms.getAll.mockResolvedValue([]);

      await reconcileSnoozeAlarms();

      expect(storedAtCreate).toEqual([
        ['https://p1/', ['p1', 'p2', 'p3']],
        ['https://p2/', ['p2', 'p3']],
        ['https://p3/', ['p3']],
      ]);
      expect(store.snoozedItems).toEqual([]);
      expect(chrome.notifications.create).toHaveBeenCalledTimes(3);
    });

    test('per-tab restore failures are logged with the failing URL', async () => {
      const now = Date.now();
      const rec = {
        id: 'warn1', type: 'tab', summary: 'W', wakeAt: now - 1000, preset: 'tomorrow',
        windowId: 1, tabs: [{ url: 'https://fails.example/', title: 'W', pinned: false, index: 0 }],
      };
      useMemoryStore({ snoozedItems: [rec] });

      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      chrome.tabs.create.mockRejectedValue(new Error('boom'));
      chrome.alarms.getAll.mockResolvedValue([]);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await reconcileSnoozeAlarms();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restore snoozed tab'),
        'https://fails.example/',
        'boom'
      );
      warnSpy.mockRestore();
    });
  });

  // M1: a record stays in storage until its tabs are open. A wake cut short
  // is simply done again from scratch; a re-run may open a tab twice, but
  // never loses one.
  describe('a wake cut short is done again', () => {
    const mk = (id, n) => ({
      id, type: 'tabs', summary: `${n} selected tabs`, wakeAt: Date.now() - 1000, preset: 'custom',
      windowId: 1,
      tabs: Array.from({ length: n }, (_x, i) => ({ url: `https://t${i}.example/`, title: `T${i}`, pinned: false, index: i })),
    });

    test('a worker that stops mid-wake leaves the record and an alarm; the next worker reopens every tab', async () => {
      const record = mk('cut', 3);
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      let nextId = 100;
      // The first worker stops for good while it opens the second tab.
      chrome.tabs.create.mockImplementation(({ url }) => (url === 'https://t1.example/'
        ? new Promise(() => {})
        : Promise.resolve({ id: nextId++ })));

      wakeSnoozedRecord('cut', { notify: true });
      await flush();
      expect(chrome.tabs.create.mock.calls.map(([c]) => c.url)).toEqual(['https://t0.example/', 'https://t1.example/']);

      // Nothing is lost: the whole record is still stored, with an alarm.
      expect(store.snoozedItems).toEqual([record]);
      expect(chrome.alarms.create).toHaveBeenLastCalledWith('snooze:cut', { when: expect.any(Number) });
      expect(chrome.notifications.create).not.toHaveBeenCalled();

      // That alarm starts a new worker, which wakes the record from scratch.
      chrome.tabs.create.mockReset();
      chrome.tabs.create.mockImplementation(() => Promise.resolve({ id: nextId++ }));
      await startWorker().handleSnoozeAlarm({ name: 'snooze:cut' });

      expect(chrome.tabs.create.mock.calls.map(([c]) => c.url)).toEqual(record.tabs.map((t) => t.url));
      expect(store.snoozedItems).toEqual([]);
      expect(chrome.alarms.clear).toHaveBeenLastCalledWith('snooze:cut');
      expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    });

    test('two wakes of one record at once open it once; Discard and the list see it waking', async () => {
      const record = mk('twice', 2);
      const store = useMemoryStore({ snoozedItems: [record] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      let release;
      const gate = new Promise((r) => { release = r; });
      let nextId = 200;
      chrome.tabs.create.mockImplementation(() => gate.then(() => ({ id: nextId++ })));

      const first = wakeSnoozedRecord('twice', { notify: true });
      const byAlarm = handleSnoozeAlarm({ name: 'snooze:twice' });
      const wakeNow = vi.fn();
      const nowReply = handleWakeNow({ id: 'twice' }, wakeNow);
      await flush();

      const discard = vi.fn();
      await handleCancelSnooze({ id: 'twice' }, discard);
      expect(discard).toHaveBeenCalledWith({ success: false, waking: true });
      const list = vi.fn();
      await handleListSnoozed(list);
      expect(list.mock.calls[0][0].items.map((r) => [r.id, r.waking])).toEqual([['twice', true]]);

      release();
      await Promise.all([first, byAlarm, nowReply]);
      expect(await byAlarm).toEqual({ waking: true });
      expect(wakeNow).toHaveBeenCalledWith({ success: false, waking: true });
      expect(chrome.tabs.create.mock.calls.map(([c]) => c.url)).toEqual(record.tabs.map((t) => t.url));
      expect(store.snoozedItems).toEqual([]);
      expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    });

    test('a wake arms its alarm before it reads the record, and a second wake while it runs re-arms it', async () => {
      const record = mk('arm', 1);
      useMemoryStore({ snoozedItems: [record] });
      // The worker stops while it reads the sleeping list (a worker of its
      // own, since its snooze lock is never released).
      const worker = startWorker();
      chrome.storage.local.get.mockImplementation(() => new Promise(() => {}));
      worker.handleSnoozeAlarm({ name: 'snooze:arm' });
      await flush();
      expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
      expect(chrome.alarms.create).toHaveBeenLastCalledWith('snooze:arm', { when: expect.any(Number) });
      // The alarm fires again while that wake is still running (a wake longer
      // than a minute used it up): it is armed again.
      expect(await worker.handleSnoozeAlarm({ name: 'snooze:arm' })).toEqual({ waking: true });
      expect(chrome.alarms.create).toHaveBeenCalledTimes(2);
      expect(chrome.alarms.create).toHaveBeenLastCalledWith('snooze:arm', { when: expect.any(Number) });
    });

    test('a record that is gone leaves no alarm behind', async () => {
      useMemoryStore({ snoozedItems: [] });
      expect(await wakeSnoozedRecord('gone')).toBeNull();
      expect(chrome.alarms.clear).toHaveBeenLastCalledWith('snooze:gone');
    });

    test('the reconciler arms every due record before it wakes the first, so a worker that stops mid-loop strands none', async () => {
      const store = useMemoryStore({ snoozedItems: [mk('d1', 1), mk('d2', 1), mk('d3', 1)] });
      chrome.windows.getLastFocused.mockResolvedValue({ id: 5 });
      // The worker stops while it wakes the first record.
      chrome.tabs.create.mockImplementation(() => new Promise(() => {}));
      startWorker().reconcileSnoozeAlarms();
      await flush();
      expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
      expect(chrome.alarms.create.mock.calls.map(([name]) => name).sort()).toEqual(['snooze:d1', 'snooze:d1', 'snooze:d2', 'snooze:d3']);
      expect(store.snoozedItems.map((r) => r.id)).toEqual(['d1', 'd2', 'd3']);
    });

  });

  describe('a failed read of the sleeping list (L67)', () => {
    const earlier = {
      id: 'kept', type: 'tab', summary: 'Kept', wakeAt: at(9, 9), preset: 'tomorrow',
      windowId: 1, tabs: [{ url: 'https://kept.example/', title: 'Kept', pinned: false, index: 0 }],
    };
    const readFails = (store) => {
      chrome.storage.local.get.mockImplementationOnce(() => Promise.reject(new Error('IO error: storage read failed')));
      return store;
    };
    const tab = { id: 7, url: 'https://new.example/', title: 'New', index: 0, windowId: 1 };
    beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
    afterEach(() => console.error.mockRestore());

    test('a snooze is refused, nothing is written and the tab stays open', async () => {
      const store = readFails(useMemoryStore({ snoozedItems: [earlier] }));
      chrome.tabs.query.mockResolvedValue([tab]);
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'IO error: storage read failed' });
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
      expect(store.snoozedItems).toEqual([earlier]);
    });

    test('a stored value that is not a list is moved aside, reported once, and snoozing carries on', async () => {
      const store = useMemoryStore({ snoozedItems: { not: 'a list' } });
      chrome.tabs.query.mockResolvedValue([tab]);
      chrome.tabs.remove.mockResolvedValue(undefined);
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, sendResponse);
      expect(sendResponse.mock.calls[0][0].success).toBe(true);
      const backups = Object.keys(store).filter((k) => k.startsWith('snoozedItemsCorrupt:'));
      expect(backups).toHaveLength(1);
      expect(store[backups[0]]).toEqual({ not: 'a list' });
      expect(store.snoozedItems.map((r) => r.tabs[0].url)).toEqual(['https://new.example/']);
      const list = vi.fn();
      await handleListSnoozed(list);
      expect(list.mock.calls[0][0].items).toHaveLength(1);
      expect(console.error.mock.calls.filter(([m]) => String(m).includes('snoozedItemsCorrupt'))).toHaveLength(1);
    });

    test('listSnoozed says the read failed instead of listing nothing', async () => {
      readFails(useMemoryStore({ snoozedItems: [earlier] }));
      const sendResponse = vi.fn();
      await handleListSnoozed(sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'IO error: storage read failed' });
    });

    test('Undo and Discard refuse, and write nothing', async () => {
      const store = readFails(useMemoryStore({ snoozedItems: [earlier] }));
      const undo = vi.fn();
      await handleRestoreSnoozed({ record: { ...earlier, id: 'other' } }, undo);
      expect(undo).toHaveBeenCalledWith({ success: false, error: 'IO error: storage read failed' });
      readFails(store);
      const discard = vi.fn();
      await handleCancelSnooze({ id: 'kept' }, discard);
      expect(discard).toHaveBeenCalledWith({ success: false, error: 'IO error: storage read failed' });
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(store.snoozedItems).toEqual([earlier]);
    });

    test('a close that fails partway, then a failed read, keeps the whole record rather than erasing the list', async () => {
      const store = useMemoryStore({ snoozedItems: [earlier] });
      chrome.tabs.query.mockResolvedValue([
        { id: 7, url: 'https://a.example/', title: 'A', index: 0, windowId: 1, highlighted: true },
        { id: 8, url: 'https://b.example/', title: 'B', index: 1, windowId: 1, highlighted: true },
      ]);
      chrome.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      chrome.tabs.remove.mockRejectedValue(new Error('Tabs cannot be edited right now'));
      chrome.tabs.get.mockImplementation((id) => (id === 7 ? Promise.reject(new Error('gone')) : Promise.resolve({ id })));
      const sendResponse = vi.fn();
      // The first read (persist) works; the second (keep only the closed tab) fails.
      chrome.storage.local.get
        .mockImplementationOnce((keys) => Promise.resolve({ snoozedItems: structuredClone(store.snoozedItems), keys }))
        .mockImplementationOnce(() => Promise.reject(new Error('IO error: storage read failed')));
      await handleSnoozeSelected({ wakeAt: Date.now() + 3600000, preset: 'tomorrow' }, sendResponse);
      expect(sendResponse.mock.calls[0][0].success).toBe(false);
      expect(store.snoozedItems.map((r) => r.id)).toContain('kept');
      expect(store.snoozedItems).toHaveLength(2);
    });

    test('a wake whose read fails keeps the record and tries again in a minute', async () => {
      const store = readFails(useMemoryStore({ snoozedItems: [earlier] }));
      await handleSnoozeAlarm({ name: 'snooze:kept' });
      expect(store.snoozedItems).toEqual([earlier]);
      expect(chrome.alarms.create).toHaveBeenLastCalledWith('snooze:kept', { when: expect.any(Number) });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });
  });

  describe('the AI key alarm on worker start (L12)', () => {
    test('a key with a deadline and no alarm gets its alarm back', async () => {
      const expiresAt = Date.now() + 3600000;
      useMemoryStore({ aiConfig: { key: btoa('sk-or-test'), expiresAt, expiryDuration: 3600000, model: 'm' } });
      chrome.alarms.get.mockResolvedValue(undefined);
      startWorker();
      await flush();
      expect(chrome.alarms.create).toHaveBeenCalledWith('huddle-ai-key-expiry', { when: expiresAt });
    });

    test('a key whose deadline passed while the worker was off is purged', async () => {
      const store = useMemoryStore({
        aiConfig: { key: btoa('sk-or-test'), expiresAt: Date.now() - 1000, expiryDuration: 3600000, model: 'm' },
      });
      startWorker();
      await flush();
      expect(store.aiConfig.key).toBeNull();
      expect(store.aiConfig.keyExpiredAt).toEqual(expect.any(Number));
    });
  });

  describe('formatWakeTime (popup)', () => {
    test('Today / Tomorrow / weekday / date buckets', () => {
      const now = at(3, 10); // Wed Jan 3 10:00
      expect(formatWakeTime(at(3, 18), now)).toBe('Today 18:00');
      expect(formatWakeTime(at(4, 9), now)).toBe('Tomorrow 09:00');
      // Sat Jan 6 is 3 days out → weekday short name.
      expect(formatWakeTime(at(6, 9), now)).toBe('Sat 09:00');
      // Jan 12 is 9 days out → absolute date.
      expect(formatWakeTime(at(12, 9), now)).toBe('12 Jan, 09:00');
    });
  });
});
