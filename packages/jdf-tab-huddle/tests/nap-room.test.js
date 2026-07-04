describe('Nap Room', () => {
  // Fixed reference "now": Wed 2024-01-10 12:00 local time.
  const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();

  function at(daysFromNow, hour, minute = 0) {
    const d = new Date(NOW);
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  describe('napFormatClock', () => {
    test('zero-pads hours and minutes', () => {
      expect(napFormatClock(new Date(2024, 0, 1, 9, 5).getTime())).toBe('09:05');
      expect(napFormatClock(new Date(2024, 0, 1, 18, 0).getTime())).toBe('18:00');
    });
  });

  describe('napDayInfo', () => {
    // Subtitle formatting uses the runtime's default Intl locale, so assert
    // on the presence of the month name and day number rather than a fixed
    // month-day ordering (which is locale-dependent).
    test('labels same-day wakes as "Today"', () => {
      const info = napDayInfo(at(0, 15), NOW);
      expect(info.label).toBe('Today');
      expect(info.subtitle).toContain('January');
      expect(info.subtitle).toContain('10');
    });

    test('labels next-day wakes as "Tomorrow"', () => {
      const info = napDayInfo(at(1, 9), NOW);
      expect(info.label).toBe('Tomorrow');
      expect(info.subtitle).toContain('January');
      expect(info.subtitle).toContain('11');
    });

    test('labels further-out wakes with the weekday name and a date subtitle', () => {
      const info = napDayInfo(at(3, 9), NOW); // Saturday
      expect(info.label).toBe('Saturday');
      expect(info.subtitle).toContain('January');
      expect(info.subtitle).toContain('13');
    });

    test('buckets items into the same dayKey regardless of time of day', () => {
      const morning = napDayInfo(at(0, 8), NOW);
      const evening = napDayInfo(at(0, 22), NOW);
      expect(morning.dayKey).toBe(evening.dayKey);
    });
  });

  describe('napNextWakeSummary', () => {
    test('returns null for an empty list', () => {
      expect(napNextWakeSummary([], NOW)).toBeNull();
    });

    test('describes today\'s next wake in lowercase', () => {
      const items = [{ wakeAt: at(0, 15, 0) }];
      expect(napNextWakeSummary(items, NOW)).toBe('next wakes today at 15:00');
    });

    test('describes tomorrow\'s next wake in lowercase', () => {
      const items = [{ wakeAt: at(1, 9, 0) }];
      expect(napNextWakeSummary(items, NOW)).toBe('next wakes tomorrow at 09:00');
    });

    test('describes a further-out wake with the weekday name', () => {
      const items = [{ wakeAt: at(3, 9, 0) }];
      expect(napNextWakeSummary(items, NOW)).toBe('next wakes Saturday at 09:00');
    });
  });

  describe('napRowTitle', () => {
    test('uses the tab\'s own title for a single-tab snooze', () => {
      const record = { type: 'tab', tabs: [{ title: 'PR #402', url: 'https://github.com/x' }], summary: 'PR #402' };
      expect(napRowTitle(record)).toBe('PR #402');
    });

    test('falls back to the URL when a tab has no title', () => {
      const record = { type: 'tab', tabs: [{ title: '', url: 'https://example.com/a' }], summary: 'https://example.com/a' };
      expect(napRowTitle(record)).toBe('https://example.com/a');
    });

    test('uses the captured summary for group/window/multi-tab snoozes', () => {
      const record = { type: 'group', tabs: [{ url: 'a' }, { url: 'b' }], summary: 'Group "Research" (2 tabs)' };
      expect(napRowTitle(record)).toBe('Group "Research" (2 tabs)');
    });
  });

  describe('napRowUrl', () => {
    test('shows the single tab\'s URL as-is', () => {
      const record = { tabs: [{ url: 'https://example.com/a' }] };
      expect(napRowUrl(record)).toBe('https://example.com/a');
    });

    test('appends an honest "+N more" suffix for multi-tab records', () => {
      const record = { tabs: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }, { url: 'https://example.com/c' }] };
      expect(napRowUrl(record)).toBe('https://example.com/a (+2 more)');
    });

    test('returns an empty string when there are no tabs', () => {
      expect(napRowUrl({ tabs: [] })).toBe('');
    });
  });

  describe('napGroupBadge', () => {
    test('returns the group title for a "group" record', () => {
      const record = { type: 'group', group: { title: 'Research', color: 'blue' } };
      expect(napGroupBadge(record)).toBe('Research');
    });

    test('returns null for a "group" record with no title (unnamed group)', () => {
      const record = { type: 'group', group: { title: '', color: 'grey' } };
      expect(napGroupBadge(record)).toBeNull();
    });

    test('returns the joined titles for a "window" record with groups', () => {
      const record = { type: 'window', groups: [{ title: 'Work', color: 'blue' }, { title: 'Docs', color: 'red' }] };
      expect(napGroupBadge(record)).toBe('Work, Docs');
    });

    test('returns null for a "window" record whose groups all lack titles', () => {
      const record = { type: 'window', groups: [{ title: '', color: 'grey' }] };
      expect(napGroupBadge(record)).toBeNull();
    });

    test('returns null for "tab" and "tabs" records (no group data carried)', () => {
      expect(napGroupBadge({ type: 'tab', tabs: [{ url: 'a' }] })).toBeNull();
      expect(napGroupBadge({ type: 'tabs', tabs: [{ url: 'a' }, { url: 'b' }] })).toBeNull();
    });
  });

  describe('napGroupByDay', () => {
    test('buckets sorted items into day sections, preserving chronological order', () => {
      const items = [
        { id: '1', wakeAt: at(0, 9) },
        { id: '2', wakeAt: at(0, 18) },
        { id: '3', wakeAt: at(1, 9) },
        { id: '4', wakeAt: at(3, 9) },
      ];
      const sections = napGroupByDay(items, NOW);
      expect(sections.length).toBe(3);
      expect(sections[0].label).toBe('Today');
      expect(sections[0].items.map((i) => i.id)).toEqual(['1', '2']);
      expect(sections[1].label).toBe('Tomorrow');
      expect(sections[1].items.map((i) => i.id)).toEqual(['3']);
      expect(sections[2].label).toBe('Saturday');
      expect(sections[2].items.map((i) => i.id)).toEqual(['4']);
    });

    test('returns an empty array for an empty list', () => {
      expect(napGroupByDay([], NOW)).toEqual([]);
    });
  });
});
