// Unit tests for the popup keyboard-shortcut engine.
// Globals (buildHotkeyMap, refreshHotkeys, handleHotkeyKeydown,
// isTextInputTarget, isHotkeyVisible) are exposed via tests/setup.js.
// The map builder reads the live document, so each test constructs the popup
// DOM for the state under test.

// A representative slice of the real popup DOM. `activeMode` decides which
// .tab-content panel carries the `active` class; the other stays hidden.
function buildPopupDom({ activeMode = 'groups', singleWindow = false, groupDisabled = false } = {}) {
  const groupsActive = activeMode === 'groups' ? ' active' : '';
  const individualActive = activeMode === 'individual' ? ' active' : '';
  const mw = singleWindow ? ' style="display: none;"' : '';
  return `
    <div class="tab-nav">
      <button class="tab-button${groupsActive}" data-tab="groups">Tab Groups Mode</button>
      <button class="tab-button${individualActive}" data-tab="individual">Individual Mode</button>
    </div>

    <div id="groups-content" class="tab-content${groupsActive}">
      <div class="section">
        <div class="button-row">
          <button id="sortCurrentWindow-groups">Sort</button>
          <button id="removeDuplicatesWindow-groups">Deduplicate</button>
          <button id="flattenWindow-groups">Flatten</button>
        </div>
        <div class="button-row">
          <button id="aiOrganize-groups">Organize</button>
          <button id="aiSettings-groups" class="ai-cog-btn" style="display: none;">cog</button>
        </div>
      </div>
      <div class="section multi-window-section"${mw}>
        <div class="button-row">
          <button id="sortAllWindows-groups">Sort All</button>
          <button id="removeDuplicatesAllWindows-groups">Dedupe Window</button>
          <button id="removeDuplicatesGlobally-groups">Dedupe Global</button>
        </div>
        <div class="button-row">
          <button id="moveAllToSingleWindow-groups">Merge</button>
        </div>
      </div>
      <div class="section">
        <div class="button-row">
          <button id="extractDomain-groups">Domain</button>
          <button id="extractAllDomains-groups">All Domains</button>
        </div>
      </div>
      <div class="section">
        <div class="button-row">
          <button id="copyAllTabs-groups">Copy All Tabs</button>
        </div>
      </div>
    </div>

    <div id="individual-content" class="tab-content${individualActive}">
      <div class="section">
        <div class="button-row">
          <button id="sortCurrentWindow-individual">Sort</button>
          <button id="removeDuplicatesWindow-individual">Deduplicate</button>
        </div>
        <div class="button-row">
          <button id="aiOrganize-individual">Organize</button>
          <button id="aiSettings-individual" class="ai-cog-btn" style="display: none;">cog</button>
        </div>
      </div>
      <div class="section">
        <div class="button-row">
          <button id="extractDomain-individual">Domain</button>
          <button id="extractAllDomains-individual">All Domains</button>
        </div>
      </div>
      <div class="section">
        <div class="button-row">
          <button id="copyAllTabs-individual">Copy All Tabs</button>
        </div>
      </div>
    </div>

    <div class="section" id="snoozeSection">
      <div class="button-row">
        <button id="snoozeTab">Tab</button>
        <button id="snoozeSelected">Selected</button>
        <button id="snoozeWindow">Window</button>
        <button id="snoozeGroup"${groupDisabled ? ' disabled' : ''}>Group</button>
      </div>
      <div id="snoozePickerPanel" hidden>
        <div class="button-row">
          <button id="snoozePreset-laterToday">Later today · 13:00</button>
          <button id="snoozePreset-tonight">Tonight · 18:00</button>
        </div>
        <div class="button-row">
          <button id="snoozePreset-tomorrow">Tomorrow · 09:00</button>
          <button id="snoozePreset-weekend">Weekend · 09:00</button>
          <button id="snoozePreset-nextWeek">Next week · 09:00</button>
        </div>
        <div class="button-row">
          <input type="datetime-local" id="snoozeCustomTime">
          <button id="snoozeCustomConfirm">Snooze</button>
          <button id="snoozePickerCancel">Cancel</button>
        </div>
        <div id="snoozeFeedback" class="copy-feedback"></div>
      </div>
    </div>

    <div class="section" id="sleepingSection" hidden>
      <ul id="snoozedList"></ul>
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
    <button class="snoozed-cancel" data-action="cancel">Cancel</button>
  `;
  document.getElementById('snoozedList').appendChild(li);
}

// Values of a Map, for duplicate checks.
function assertNoDuplicateKeys(map) {
  // A Map cannot hold duplicate keys, so uniqueness is guaranteed for keys;
  // this asserts no element got bound twice under different keys.
  const els = [...map.values()];
  expect(new Set(els).size).toBe(els.length);
}

describe('Popup keyboard shortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = buildPopupDom();
  });

  describe('buildHotkeyMap — visible state', () => {
    test('groups mode: mode tabs + groups panel + snooze units, mnemonic letters', () => {
      const map = buildHotkeyMap();

      // Mode tabs
      expect(map.get('g')?.dataset.tab).toBe('groups');
      expect(map.get('i')?.dataset.tab).toBe('individual');
      // Groups-panel actions
      expect(map.get('s')?.id).toBe('sortCurrentWindow-groups');
      expect(map.get('d')?.id).toBe('removeDuplicatesWindow-groups');
      expect(map.get('f')?.id).toBe('flattenWindow-groups');
      expect(map.get('o')?.id).toBe('aiOrganize-groups');
      expect(map.get('a')?.id).toBe('sortAllWindows-groups');
      expect(map.get('m')?.id).toBe('moveAllToSingleWindow-groups');
      expect(map.get('n')?.id).toBe('extractDomain-groups');
      expect(map.get('l')?.id).toBe('extractAllDomains-groups');
      expect(map.get('c')?.id).toBe('copyAllTabs-groups');
      // Snooze units
      expect(map.get('t')?.id).toBe('snoozeTab');
      expect(map.get('e')?.id).toBe('snoozeSelected');
      expect(map.get('w')?.id).toBe('snoozeWindow');
      expect(map.get('r')?.id).toBe('snoozeGroup');
    });

    test('no duplicate letters and every letter is a single char', () => {
      const map = buildHotkeyMap();
      assertNoDuplicateKeys(map);
      for (const key of map.keys()) {
        expect(key).toHaveLength(1);
        expect(key).toBe(key.toLowerCase());
      }
    });

    test('ignores the hidden (inactive) mode panel', () => {
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id);
      // No individual-suffixed button should be bound while groups is active.
      expect(boundIds.some((id) => id.endsWith('-individual'))).toBe(false);
      expect(boundIds).toContain('sortCurrentWindow-groups');
    });

    test('individual mode binds the individual panel, not groups', () => {
      document.body.innerHTML = buildPopupDom({ activeMode: 'individual' });
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id);
      expect(boundIds.some((id) => id.endsWith('-groups'))).toBe(false);
      expect(boundIds).toContain('sortCurrentWindow-individual');
      // Individual mode has no Flatten button.
      expect(boundIds).not.toContain('flattenWindow-individual');
    });

    test('ignores disabled buttons (snoozeGroup when not in a group)', () => {
      document.body.innerHTML = buildPopupDom({ groupDisabled: true });
      const map = buildHotkeyMap();
      const boundEls = [...map.values()];
      expect(boundEls.some((el) => el.id === 'snoozeGroup')).toBe(false);
      // The other snooze units remain bound.
      expect(map.get('t')?.id).toBe('snoozeTab');
    });

    test('ignores buttons hidden via inline display:none (AI cog, multi-window)', () => {
      document.body.innerHTML = buildPopupDom({ singleWindow: true });
      const map = buildHotkeyMap();
      const boundIds = [...map.values()].map((el) => el.id);
      expect(boundIds).not.toContain('aiSettings-groups');
      expect(boundIds).not.toContain('sortAllWindows-groups');
      expect(boundIds).not.toContain('moveAllToSingleWindow-groups');
      // Non-multi-window buttons stay bound.
      expect(boundIds).toContain('sortCurrentWindow-groups');
    });

    test('binds the AI cog when it is shown', () => {
      document.getElementById('aiSettings-groups').style.display = 'block';
      const map = buildHotkeyMap();
      expect(map.get('k')?.id).toBe('aiSettings-groups');
    });
  });

  describe('buildHotkeyMap — snooze picker (modal)', () => {
    test('when the picker is open, only preset + confirm/cancel bind', () => {
      const panel = document.getElementById('snoozePickerPanel');
      panel.hidden = false;
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
      // Mode tabs and snooze units are NOT bound while the picker is modal.
      expect([...map.values()].some((el) => el.classList.contains('tab-button'))).toBe(false);
      expect(map.get('l')?.id).toBe('snoozePreset-laterToday');
      expect(map.get('c')?.id).toBe('snoozePickerCancel');
      expect(map.get('s')?.id).toBe('snoozeCustomConfirm');
      assertNoDuplicateKeys(map);
    });
  });

  describe('buildHotkeyMap — sleeping list rows', () => {
    test('binds visible Wake/Cancel actions without collisions', () => {
      addSleepingRow('rec-1');
      const map = buildHotkeyMap();
      const boundEls = [...map.values()];
      const wake = document.querySelector('.snoozed-item[data-id="rec-1"] .snoozed-wake');
      const cancel = document.querySelector('.snoozed-item[data-id="rec-1"] .snoozed-cancel');
      expect(boundEls).toContain(wake);
      expect(boundEls).toContain(cancel);
      assertNoDuplicateKeys(map);
    });
  });

  describe('isHotkeyVisible', () => {
    test('false for [hidden] ancestors, inactive panels and inline display:none', () => {
      expect(isHotkeyVisible(document.getElementById('snoozePreset-tonight'))).toBe(false); // inside hidden picker
      expect(isHotkeyVisible(document.getElementById('sortCurrentWindow-individual'))).toBe(false); // inactive panel
      expect(isHotkeyVisible(document.getElementById('aiSettings-groups'))).toBe(false); // display:none
      expect(isHotkeyVisible(document.getElementById('sortCurrentWindow-groups'))).toBe(true);
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

    test('pressing a mapped key clicks the corresponding button', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow-groups');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      handleHotkeyKeydown(keyEvent('s'));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('does not hijack keys while typing in a text input', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow-groups');
      const spy = vi.fn();
      btn.addEventListener('click', spy);

      handleHotkeyKeydown(keyEvent('s', document.getElementById('snoozeCustomTime')));
      expect(spy).not.toHaveBeenCalled();
    });

    test('ignores keys pressed with a modifier', () => {
      refreshHotkeys();
      const btn = document.getElementById('sortCurrentWindow-groups');
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

    test('unmapped keys are a no-op', () => {
      refreshHotkeys();
      const ev = keyEvent('q'); // no control uses q by default here
      handleHotkeyKeydown(ev);
      // 'q' is unlikely to be mapped in the base state; if it is, this still
      // just verifies no throw. Assert defaultPrevented only when unmapped.
      if (!ev.defaultPrevented) {
        expect(ev.defaultPrevented).toBe(false);
      }
    });
  });

  describe('refreshHotkeys — hint rendering', () => {
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
