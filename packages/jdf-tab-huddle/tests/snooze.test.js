// Unit tests for the Tab Snoozing feature (background + popup helpers).
// Globals are exposed via tests/setup.js. Storage is mocked with an in-memory
// object; `now` is always passed explicitly to date helpers for determinism.

// Wire chrome.storage.local.{get,set} to an in-memory object.
function useMemoryStore(initial = {}) {
  const store = { ...initial };
  chrome.storage.local.get.mockImplementation((keys) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of arr) if (k in store) out[k] = store[k];
    return Promise.resolve(out);
  });
  chrome.storage.local.set.mockImplementation((obj) => {
    Object.assign(store, obj);
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
    });
    test('group summary uses title, (unnamed) when empty', () => {
      expect(buildSnoozeSummary('group', [{}, {}], { title: 'Research' })).toBe('Group "Research" (2 tabs)');
      expect(buildSnoozeSummary('group', [{}], { title: '' })).toBe('Group "(unnamed)" (1 tabs)');
    });
    test('window summary counts tabs', () => {
      expect(buildSnoozeSummary('window', [{}, {}, {}, {}])).toBe('Window (4 tabs)');
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

    test('custom time in the past is rejected', async () => {
      useMemoryStore();
      const sendResponse = vi.fn();
      await handleSnoozeTab({ wakeAt: Date.now() - 100000, preset: 'custom' }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Wake time is in the past' });
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
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
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
    });
  });

  describe('handleSnoozeAlarm', () => {
    test('ignores alarms without the snooze: prefix', () => {
      useMemoryStore({ snoozedItems: [] });
      handleSnoozeAlarm({ name: 'someOtherAlarm' });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.windows.create).not.toHaveBeenCalled();
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
