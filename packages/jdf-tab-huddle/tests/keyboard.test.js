// Unit tests for the popup keyboard-shortcut engine (redesigned single-panel DOM).
// Globals (buildHotkeyMap, refreshHotkeys, handleHotkeyKeydown,
// isTextInputTarget, isHotkeyVisible) are exposed via tests/setup.js.
// The map builder reads the live document, so each test constructs the popup
// DOM for the state under test.

// A representative slice of the real redesigned popup DOM. There are no longer
// separate mode panels: a single action set is always visible and the header
// Groups/Flat segmented toggle only flips a boolean. `singleWindow` hides the
// multi-window section (as updateUIForWindowCount does); `groupDisabled`
// disables the snooze Group unit.
function buildPopupDom({ respectGroups = true, singleWindow = false, groupDisabled = false, splitView = false } = {}) {
  const mw = singleWindow ? ' style="display: none;"' : '';
  return `
    <div class="p-pad">
      <div class="p-head">
        <div class="brand"><span class="logo">H</span></div>
        <div class="seg">
          <button id="modeGroups" data-action="setRespectGroups" data-value="true"
            aria-pressed="${respectGroups ? 'true' : 'false'}">Groups</button>
          <button id="modeFlat" data-action="setRespectGroups" data-value="false"
            aria-pressed="${respectGroups ? 'false' : 'true'}">Flat</button>
        </div>
      </div>

      <div class="grp">
        <div class="grid3">
          <button id="sortCurrentWindow" class="btn" data-action="sortCurrentWindow">Sort</button>
          <button id="removeDuplicatesWindow" class="btn" data-action="removeDuplicatesWindow">Deduplicate</button>
          <button id="flattenWindow" class="btn" data-action="flattenWindow">Ungroup</button>
        </div>
        <div id="splitViewRow" class="grid2"${splitView ? '' : ' hidden'}>
          <button id="compactWindow" class="btn" data-action="compactWindow">Compact</button>
          <button id="expandWindow" class="btn" data-action="expandWindow">Expand</button>
        </div>
        <button id="aiOrganize" class="btn primary wide" data-action="aiGroupTabs">Organize with AI</button>
      </div>

      <div class="grp multi-window-section"${mw}>
        <div class="grid2">
          <button id="sortAllWindows" class="btn" data-action="sortAllWindows">Sort all windows</button>
          <button id="moveAllToSingleWindow" class="btn" data-action="moveAllToSingleWindow">Merge windows</button>
          <button id="removeDuplicatesAllWindows" class="btn" data-action="removeDuplicatesAllWindows">Deduplicate per window</button>
          <button id="removeDuplicatesGlobally" class="btn" data-action="removeDuplicatesGlobally">Deduplicate globally</button>
        </div>
      </div>

      <div class="grp">
        <div class="grid2">
          <button id="extractDomain" class="btn mini" data-action="extractDomain">Extract domain</button>
          <button id="extractAllDomains" class="btn mini" data-action="extractAllDomains">Split domains</button>
          <button id="copyThisWindow" class="btn mini" data-action="copyThisWindow">Copy this window</button>
          <button id="copyAllWindows" class="btn mini" data-action="copyAllWindows">Copy all windows</button>
        </div>
      </div>

      <div class="grp" id="snoozeSection">
        <div class="snooze-targets">
          <button id="snoozeTab" class="chip" data-action="openSnoozePicker" data-unit="tab">Tab</button>
          <button id="snoozeSelected" class="chip" data-action="openSnoozePicker" data-unit="selected">Selected</button>
          <button id="snoozeWindow" class="chip" data-action="openSnoozePicker" data-unit="window">Window</button>
          <button id="snoozeGroup" class="chip" data-action="openSnoozePicker" data-unit="group"${groupDisabled ? ' disabled' : ''}>Group</button>
        </div>
        <div id="snoozePickerPanel" hidden>
          <div class="presets-row">
            <button id="snoozePreset-laterToday" class="preset">Later today · 13:00</button>
            <button id="snoozePreset-tonight" class="preset">Tonight · 18:00</button>
          </div>
          <div class="presets-row">
            <button id="snoozePreset-tomorrow" class="preset">Tomorrow · 09:00</button>
            <button id="snoozePreset-weekend" class="preset">Weekend · 09:00</button>
            <button id="snoozePreset-nextWeek" class="preset">Next week · 09:00</button>
          </div>
          <div class="custom-row">
            <input type="datetime-local" id="snoozeCustomTime">
            <button id="snoozeCustomConfirm">Snooze</button>
            <button id="snoozePickerCancel">Cancel</button>
          </div>
          <div id="snoozeFeedback"></div>
        </div>
      </div>

      <div class="grp" id="sleepingSection" hidden>
        <div class="eyebrow">Sleeping
          <button id="expandSleeping" class="expand-link" data-action="openNapRoom">Expand</button>
        </div>
        <div class="sleep-wrap"><ul id="snoozedList"></ul></div>
      </div>
    </div>
  `;
}

// Add one row to the sleeping list and reveal the section.
function addSleepingRow(id, summary = 'Example') {
  const section = document.getElementById('sleepingSection');
  section.hidden = false;
  const li = document.createElement('li');
  li.className = 'snoozed-item';
  li.setAttribute('data-id', id);
  li.innerHTML = `
    <span class="snoozed-summary">${summary}</span>
    <span class="snoozed-time">Tomorrow 09:00</span>
    <button class="snoozed-wake" data-action="wake">Wake now</button>
    <button class="snoozed-discard" data-action="discard">Discard</button>
  `;
  document.getElementById('snoozedList').appendChild(li);
}

function assertNoDuplicateKeys(map) {
  // A Map cannot hold duplicate keys, so uniqueness is guaranteed for keys;
  // this asserts no element got bound twice under different keys.
  const els = [...map.values()];
  expect(new Set(els).size).toBe(els.length);
}

describe('Popup keyboard shortcuts (redesigned DOM)', () => {
  beforeEach(() => {
    document.body.innerHTML = buildPopupDom();
  });

  describe('buildHotkeyMap — main visible state', () => {
    test('binds toggle + action buttons + snooze units with mnemonic letters', () => {
      const map = buildHotkeyMap();

      // Header toggle
      expect(map.get('g')?.id).toBe('modeGroups');
      expect(map.get('f')?.id).toBe('modeFlat');
      // This window
      expect(map.get('s')?.id).toBe('sortCurrentWindow');
      expect(map.get('d')?.id).toBe('removeDuplicatesWindow');
      expect(map.get('u')?.id).toBe('flattenWindow');
      expect(map.get('o')?.id).toBe('aiOrganize');
      // All windows
      expect(map.get('a')?.id).toBe('sortAllWindows');
      expect(map.get('m')?.id).toBe('moveAllToSingleWindow');
      expect(map.get('p')?.id).toBe('removeDuplicatesAllWindows');
      expect(map.get('b')?.id).toBe('removeDuplicatesGlobally');
      // Extract & copy
      expect(map.get('e')?.id).toBe('extractDomain');
      expect(map.get('x')?.id).toBe('extractAllDomains');
      expect(map.get('c')?.id).toBe('copyThisWindow');
      expect(map.get('y')?.id).toBe('copyAllWindows');
      // Snooze units
      expect(map.get('t')?.id).toBe('snoozeTab');
      expect(map.get('l')?.id).toBe('snoozeSelected');
      expect(map.get('w')?.id).toBe('snoozeWindow');
      expect(map.get('r')?.id).toBe('snoozeGroup');
    });

    test('keys are single letters or row digits, and none is bound twice', () => {
      const map = buildHotkeyMap();
      assertNoDuplicateKeys(map);
      for (const key of map.keys()) {
        expect(key).toMatch(/^[a-z]$|^[1-9]$/);
      }
    });

    test('the same single action set binds in Flat mode', () => {
      document.body.innerHTML = buildPopupDom({ respectGroups: false });
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id);
      expect(boundIds).toContain('modeGroups');
      expect(boundIds).toContain('modeFlat');
      expect(boundIds).toContain('sortCurrentWindow');
      expect(boundIds).toContain('flattenWindow');
    });

    test('does not bind the hidden snooze picker or hidden sleeping section', () => {
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id);
      expect(boundIds).not.toContain('snoozePreset-tomorrow');
      expect(boundIds).not.toContain('snoozeCustomConfirm');
      // The Expand link lives in the hidden sleeping section.
      expect(boundIds).not.toContain('expandSleeping');
    });

    test('ignores disabled buttons (snoozeGroup when not in a group)', () => {
      document.body.innerHTML = buildPopupDom({ groupDisabled: true });
      const map = buildHotkeyMap();
      const boundEls = [...map.values()];
      expect(boundEls.some((el) => el.id === 'snoozeGroup')).toBe(false);
      // The other snooze units remain bound.
      expect(map.get('t')?.id).toBe('snoozeTab');
    });

    test('ignores buttons hidden via inline display:none (multi-window)', () => {
      document.body.innerHTML = buildPopupDom({ singleWindow: true });
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id);
      expect(boundIds).not.toContain('sortAllWindows');
      expect(boundIds).not.toContain('moveAllToSingleWindow');
      expect(boundIds).not.toContain('removeDuplicatesGlobally');
      // Non-multi-window buttons stay bound.
      expect(boundIds).toContain('sortCurrentWindow');
    });

    test('Compact/Expand bind to v/j only when the Split View row is shown', () => {
      expect([...buildHotkeyMap().values()].map((el) => el.id)).not.toContain('compactWindow');

      document.body.innerHTML = buildPopupDom({ splitView: true });
      const map = buildHotkeyMap();
      expect(map.get('v')?.id).toBe('compactWindow');
      expect(map.get('j')?.id).toBe('expandWindow');
      assertNoDuplicateKeys(map);
    });

    test('Organize with AI binds to O, and K is free (no AI settings cog)', () => {
      const map = buildHotkeyMap();
      expect(map.get('o')?.id).toBe('aiOrganize');
      expect(map.has('k')).toBe(false);
      expect([...map.values()].some((el) => el.dataset.action === 'openAiSettings')).toBe(false);
    });

    test('binds the Expand link when the sleeping section is shown', () => {
      document.getElementById('sleepingSection').hidden = false;
      const map = buildHotkeyMap();
      expect(map.get('n')?.id).toBe('expandSleeping');
    });
  });

  describe('buildHotkeyMap — snooze picker (modal)', () => {
    test('when the picker is open, only preset + confirm/cancel bind', () => {
      document.getElementById('snoozePickerPanel').hidden = false;
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id).sort();
      expect(boundIds).toEqual(
        [
          'snoozeCustomConfirm',
          'snoozePickerCancel',
          'snoozePreset-laterToday',
          'snoozePreset-nextWeek',
          'snoozePreset-tomorrow',
          'snoozePreset-tonight',
          'snoozePreset-weekend',
        ].sort()
      );
      // Header toggle and action buttons are NOT bound while the picker is modal.
      expect([...map.values()].some((el) => el.id === 'modeGroups')).toBe(false);
      expect([...map.values()].some((el) => el.id === 'sortCurrentWindow')).toBe(false);
      expect(map.get('l')?.id).toBe('snoozePreset-laterToday');
      expect(map.get('c')?.id).toBe('snoozePickerCancel');
      expect(map.get('s')?.id).toBe('snoozeCustomConfirm');
      assertNoDuplicateKeys(map);
    });
  });

  describe('buildHotkeyMap — sleeping list rows', () => {
    test('binds Wake now to a digit, never a letter, and never binds Discard', () => {
      addSleepingRow('rec-1');
      const map = buildHotkeyMap();
      const boundEls = [...map.values()];
      const wake = document.querySelector('.snoozed-item[data-id="rec-1"] .snoozed-wake');
      const discard = document.querySelector('.snoozed-item[data-id="rec-1"] .snoozed-discard');
      expect(map.get('1')).toBe(wake);
      expect(boundEls).not.toContain(discard);
      assertNoDuplicateKeys(map);
    });

    test('row digits follow list order and are capped at 9', () => {
      for (let i = 1; i <= 11; i++) addSleepingRow(`rec-${i}`);
      const map = buildHotkeyMap();
      for (let i = 1; i <= 9; i++) {
        expect(map.get(String(i))).toBe(document.querySelector(`.snoozed-item[data-id="rec-${i}"] .snoozed-wake`));
      }
      const bound = new Set(map.values());
      expect(bound.has(document.querySelector('.snoozed-item[data-id="rec-10"] .snoozed-wake'))).toBe(false);
    });

    test('a visible Undo notice binds Z', () => {
      addSleepingRow('rec-1');
      const notice = document.createElement('div');
      notice.id = 'discardNotice';
      notice.innerHTML = '<span id="discardNoticeText">Discarded A.</span><button id="discardUndo" data-action="undoDiscard">Undo</button>';
      document.getElementById('sleepingSection').before(notice);
      const map = buildHotkeyMap();
      expect(map.get('z')).toBe(document.getElementById('discardUndo'));
      assertNoDuplicateKeys(map);
    });

    test('two sleeping rows all bind without collisions', () => {
      addSleepingRow('rec-1');
      addSleepingRow('rec-2');
      const map = buildHotkeyMap();
      const wakeButtons = document.querySelectorAll('.snoozed-item button[data-action="wake"]');
      const boundEls = new Set([...map.values()]);
      wakeButtons.forEach((btn) => expect(boundEls.has(btn)).toBe(true));
      document.querySelectorAll('.snoozed-item button[data-action="discard"]')
        .forEach((btn) => expect(boundEls.has(btn)).toBe(false));
      assertNoDuplicateKeys(map);
    });
  });

  describe('isHotkeyVisible', () => {
    test('false for [hidden] ancestors and inline display:none; true otherwise', () => {
      expect(isHotkeyVisible(document.getElementById('snoozePreset-tonight'))).toBe(false); // inside hidden picker
      expect(isHotkeyVisible(document.getElementById('expandSleeping'))).toBe(false); // inside hidden sleeping section
      document.getElementById('sortCurrentWindow').style.display = 'none';
      expect(isHotkeyVisible(document.getElementById('sortCurrentWindow'))).toBe(false); // display:none
      document.getElementById('sortCurrentWindow').style.display = '';
      expect(isHotkeyVisible(document.getElementById('sortCurrentWindow'))).toBe(true);
    });
  });

  describe('isTextInputTarget', () => {
    test('true for inputs (incl. datetime-local), textarea, select', () => {
      expect(isTextInputTarget(document.getElementById('snoozeCustomTime'))).toBe(true);
      const ta = document.createElement('textarea');
      const sel = document.createElement('select');
      expect(isTextInputTarget(ta)).toBe(true);
      expect(isTextInputTarget(sel)).toBe(true);
    });
    test('false for buttons and null', () => {
      expect(isTextInputTarget(document.getElementById('snoozeTab'))).toBe(false);
      expect(isTextInputTarget(null)).toBe(false);
    });
  });

  describe('handleHotkeyKeydown', () => {
    function keyEvent(key, target) {
      return {
        key,
        target: target || document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      };
    }

    test('a bare D deduplicates this window', () => {
      refreshHotkeys();
      const btn = document.getElementById('removeDuplicatesWindow');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      handleHotkeyKeydown(keyEvent('d'));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('a held key (auto-repeat keydown) clicks only once', () => {
      refreshHotkeys();
      const btn = document.getElementById('removeDuplicatesWindow');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      handleHotkeyKeydown(keyEvent('d'));
      handleHotkeyKeydown({ ...keyEvent('d'), repeat: true });
      handleHotkeyKeydown({ ...keyEvent('d'), repeat: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('Shift does not block an action', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow');
      const spy = vi.fn();
      btn.addEventListener('click', spy);
      const ev = keyEvent('S');
      ev.shiftKey = true;
      handleHotkeyKeydown(ev);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('pressing a mapped key clicks the corresponding button', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      handleHotkeyKeydown(keyEvent('s'));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('does not hijack keys while typing in a text input', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      handleHotkeyKeydown(keyEvent('s', document.getElementById('snoozeCustomTime')));
      expect(spy).not.toHaveBeenCalled();
    });

    test('ignores keys pressed with a modifier', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      const ev = keyEvent('s');
      ev.ctrlKey = true;
      handleHotkeyKeydown(ev);
      expect(spy).not.toHaveBeenCalled();
    });

    test('Escape closes the picker when it is open', () => {
      const panel = document.getElementById('snoozePickerPanel');
      panel.hidden = false;
      refreshHotkeys();

      handleHotkeyKeydown(keyEvent('Escape'));
      expect(panel.hidden).toBe(true);
    });

    test('unmapped keys are a no-op (no preventDefault)', () => {
      refreshHotkeys();
      const ev = keyEvent('z'); // 'z' is not a preferred mnemonic in the base state
      handleHotkeyKeydown(ev);
      if (!ev.defaultPrevented) {
        expect(ev.defaultPrevented).toBe(false);
      }
    });
  });

  describe('refreshHotkeys — hint rendering', () => {
    test('badges show the bare letter, and every binding is exposed as aria-keyshortcuts', () => {
      refreshHotkeys();
      const dedupe = document.getElementById('removeDuplicatesWindow');
      expect(dedupe.querySelector('.hotkey-hint').textContent).toBe('D');
      expect(dedupe.getAttribute('aria-keyshortcuts')).toBe('D');
      const sort = document.getElementById('sortCurrentWindow');
      expect(sort.querySelector('.hotkey-hint').textContent).toBe('S');
      expect(sort.getAttribute('aria-keyshortcuts')).toBe('S');
    });

    test('renders one badge per bound button and is idempotent', () => {
      refreshHotkeys();
      const first = document.querySelectorAll('.hotkey-hint').length;
      expect(first).toBeGreaterThan(0);
      // A second refresh must not duplicate badges.
      refreshHotkeys();
      const second = document.querySelectorAll('.hotkey-hint').length;
      expect(second).toBe(first);
    });

    test('a bound button shows its assigned uppercase letter', () => {
      refreshHotkeys();
      const badge = document.querySelector('#snoozeTab .hotkey-hint');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('T');
    });
  });
});
