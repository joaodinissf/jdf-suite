import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

describe('getAllowedKeys', () => {
  it('returns 26 letters + 10 digits = 36 entries', () => {
    const keys = global.getAllowedKeys();
    expect(keys.length).toBe(36);
  });

  it('includes all lowercase ASCII letters', () => {
    const keys = global.getAllowedKeys();
    for (let i = 0; i < 26; i++) {
      expect(keys).toContain(String.fromCharCode(97 + i));
    }
  });

  it('includes all digits 0-9', () => {
    const keys = global.getAllowedKeys();
    for (let i = 0; i < 10; i++) {
      expect(keys).toContain(String.fromCharCode(48 + i));
    }
  });

  it('letters come before digits in order', () => {
    const keys = global.getAllowedKeys();
    expect(keys[0]).toBe('a');
    expect(keys[25]).toBe('z');
    expect(keys[26]).toBe('0');
    expect(keys[35]).toBe('9');
  });
});

describe('applyDefaults (options.js)', () => {
  it('empty input → all defaults', () => {
    expect(global.optionsApplyDefaults({})).toEqual({ key: 'z', modifier: null });
    expect(global.optionsApplyDefaults(null)).toEqual({ key: 'z', modifier: null });
    expect(global.optionsApplyDefaults(undefined)).toEqual({ key: 'z', modifier: null });
  });

  it('respects valid overrides', () => {
    expect(global.optionsApplyDefaults({ key: 'x', modifier: 'shift' }))
      .toEqual({ key: 'x', modifier: 'shift' });
  });

  it('normalizes uppercase keys to lowercase', () => {
    expect(global.optionsApplyDefaults({ key: 'X' }).key).toBe('x');
  });

  it('ignores multi-character key values', () => {
    expect(global.optionsApplyDefaults({ key: 'ab' }).key).toBe('z');
    expect(global.optionsApplyDefaults({ key: '' }).key).toBe('z');
  });

  it('ignores non-string keys', () => {
    expect(global.optionsApplyDefaults({ key: 123 }).key).toBe('z');
    expect(global.optionsApplyDefaults({ key: null }).key).toBe('z');
  });

  it('rejects unknown modifier values', () => {
    expect(global.optionsApplyDefaults({ modifier: 'meta' }).modifier).toBe(null);
    expect(global.optionsApplyDefaults({ modifier: 'Shift' }).modifier).toBe(null); // case-sensitive
    expect(global.optionsApplyDefaults({ modifier: '' }).modifier).toBe(null);
  });

  it('drops the old enabled setting: starting it on a page is the opt-in now', () => {
    expect(global.optionsApplyDefaults({ enabled: false, key: 'x' })).toEqual({ key: 'x', modifier: null });
  });
});

describe('loadClumpingSettings / saveClumpingSettings', () => {
  beforeEach(() => {
    global.chrome.storage.sync.get.mockReset();
    global.chrome.storage.sync.set.mockReset();
  });

  it('loadClumpingSettings returns defaults when storage is empty', async () => {
    global.chrome.storage.sync.get.mockImplementation((_keys, cb) => cb({}));
    const settings = await global.loadClumpingSettings();
    expect(settings).toEqual({ key: 'z', modifier: null });
  });

  it('loadClumpingSettings returns stored values', async () => {
    global.chrome.storage.sync.get.mockImplementation((_keys, cb) => cb({
      clumping: { enabled: false, key: 'x', modifier: 'shift' },
    }));
    const settings = await global.loadClumpingSettings();
    expect(settings).toEqual({ key: 'x', modifier: 'shift' });
  });

  it('loadClumpingSettings applies defaults for partial stored values', async () => {
    global.chrome.storage.sync.get.mockImplementation((_keys, cb) => cb({
      clumping: { key: 'a' },
    }));
    const settings = await global.loadClumpingSettings();
    expect(settings).toEqual({ key: 'a', modifier: null });
  });

  it('saveClumpingSettings round-trips through apply-defaults', async () => {
    global.chrome.storage.sync.set.mockImplementation((_payload, cb) => cb && cb());
    const saved = await global.saveClumpingSettings({ enabled: false, key: 'Q', modifier: 'alt' });
    expect(saved).toEqual({ key: 'q', modifier: 'alt' });
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
      { clumping: { key: 'q', modifier: 'alt' } },
      expect.any(Function),
    );
  });

  it('saveClumpingSettings rejects if chrome.runtime.lastError is set', async () => {
    global.chrome.storage.sync.set.mockImplementation((_payload, cb) => {
      global.chrome.runtime.lastError = { message: 'quota exceeded' };
      cb && cb();
      global.chrome.runtime.lastError = null;
    });
    await expect(global.saveClumpingSettings({ key: 'a' })).rejects.toThrow('quota exceeded');
  });
});

describe('populateKeyDropdown', () => {
  it('fills a select with all 36 allowed keys', () => {
    const select = document.createElement('select');
    global.populateKeyDropdown(select, 'z');
    expect(select.options.length).toBe(36);
  });

  it('marks the provided key as selected', () => {
    const select = document.createElement('select');
    global.populateKeyDropdown(select, 'q');
    expect(select.value).toBe('q');
  });

  it('re-populating replaces existing options rather than appending', () => {
    const select = document.createElement('select');
    global.populateKeyDropdown(select, 'a');
    global.populateKeyDropdown(select, 'b');
    expect(select.options.length).toBe(36);
    expect(select.value).toBe('b');
  });
});

describe('readFormState / writeFormState', () => {
  beforeEach(() => {
    document.body.innerHTML = '<kbd id="openLinksKey">Z</kbd>';
    const key = document.createElement('select');
    key.id = 'clumping-key';
    document.body.appendChild(key);

    const modifier = document.createElement('select');
    modifier.id = 'clumping-modifier';
    document.body.appendChild(modifier);
    for (const v of ['', 'shift', 'ctrl', 'alt']) {
      const option = document.createElement('option');
      option.value = v;
      modifier.appendChild(option);
    }
  });

  it('writeFormState populates both controls, and the help line names the key', () => {
    global.writeFormState({ key: 'x', modifier: 'shift' });
    expect(document.getElementById('clumping-key').value).toBe('x');
    expect(document.getElementById('clumping-modifier').value).toBe('shift');
    expect(document.getElementById('openLinksKey').textContent).toBe('Shift+X');
  });

  it('readFormState reflects user-set values with defaults applied', () => {
    global.writeFormState({ key: 'z', modifier: null });
    document.getElementById('clumping-key').value = 'a';
    document.getElementById('clumping-modifier').value = 'alt';
    expect(global.readFormState()).toEqual({ key: 'a', modifier: 'alt' });
  });

  it('readFormState treats empty modifier as null', () => {
    global.writeFormState({ key: 'z', modifier: null });
    document.getElementById('clumping-modifier').value = '';
    expect(global.readFormState().modifier).toBe(null);
  });
});

describe('showStatus / handleFormChange', () => {
  let statusEl;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    statusEl = document.createElement('div');
    statusEl.id = 'clumping-status';
    document.body.appendChild(statusEl);
    global.chrome.storage.sync.set.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a success message fades after 1.8s', () => {
    global.showStatus('Saved');
    expect(statusEl.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(statusEl.classList.contains('visible')).toBe(false);
  });

  it('a quick second save is not hidden by the first save\'s timer', () => {
    global.showStatus('first');
    vi.advanceTimersByTime(1000);
    global.showStatus('second');
    vi.advanceTimersByTime(1000);
    expect(statusEl.classList.contains('visible')).toBe(true);
    expect(statusEl.textContent).toBe('second');
    vi.advanceTimersByTime(800);
    expect(statusEl.classList.contains('visible')).toBe(false);
  });

  it('a save error stays visible until the next successful save', async () => {
    global.chrome.storage.sync.set.mockImplementation((_payload, cb) => {
      global.chrome.runtime.lastError = { message: 'quota exceeded' };
      cb && cb();
      global.chrome.runtime.lastError = null;
    });
    await global.handleFormChange();
    expect(statusEl.textContent).toBe('Error: quota exceeded');
    expect(statusEl.classList.contains('error')).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(statusEl.classList.contains('visible')).toBe(true);

    global.chrome.storage.sync.set.mockImplementation((_payload, cb) => cb && cb());
    await global.handleFormChange();
    expect(statusEl.textContent).toMatch(/^Saved/);
    expect(statusEl.classList.contains('error')).toBe(false);
    vi.advanceTimersByTime(1800);
    expect(statusEl.classList.contains('visible')).toBe(false);
  });

  it('an error cancels a pending fade from an earlier success', () => {
    global.showStatus('Saved');
    vi.advanceTimersByTime(1000);
    global.showStatus('Error: boom', { error: true });
    vi.advanceTimersByTime(5000);
    expect(statusEl.classList.contains('visible')).toBe(true);
  });
});

describe('content-clumper integration: clumperApplySettings', () => {
  beforeEach(() => {
    global.clumperResetStateForTest();
  });

  it('sets activation key from stored settings', () => {
    global.clumperApplySettings({ key: 'x', modifier: null });
    // Test via behavior: keydown for 'x' should now arm, but 'z' should not
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    // restore default for subsequent tests
    global.clumperApplySettings({ key: 'z', modifier: null });
  });

  it('an old enabled: false no longer turns it off: starting it on the page is the opt-in', () => {
    global.clumperApplySettings({ enabled: false, key: 'z', modifier: null });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    global.clumperApplySettings({ key: 'z', modifier: null });
  });

  it('arms on Shift+digit, whose event.key is the shifted symbol', () => {
    global.clumperApplySettings({ key: '1', modifier: 'shift' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: '1', code: 'Digit1', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    global.clumperApplySettings({ key: 'z', modifier: null });
  });

  it('arms on macOS Option+letter, whose event.key is a composed character', () => {
    global.clumperApplySettings({ key: 'z', modifier: 'alt' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Ω', code: 'KeyZ', altKey: true, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Ω', code: 'KeyZ', altKey: true, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    global.clumperApplySettings({ key: 'z', modifier: null });
  });

  it('requires the configured modifier', () => {
    global.clumperApplySettings({ key: 'z', modifier: 'shift' });
    // Without shift: no arm
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: false, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    // With shift: arms
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: true, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    global.clumperApplySettings({ key: 'z', modifier: null });
  });
});

describe('Settings: Open links as tabs', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/options.html'), 'utf8');

  beforeEach(() => {
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  });

  it('has no on/off setting, and comes after the tab-organization sections', () => {
    expect(document.getElementById('clumping-enabled')).toBeNull();
    expect(document.body.textContent).not.toMatch(/link clumping/i);
    const chips = [...document.querySelectorAll('section .group-chip')].map((c) => c.textContent);
    expect(chips.at(-1)).toBe('Open links as tabs');
    expect(document.getElementById('openLinksSection').contains(document.getElementById('clumping-key'))).toBe(true);
  });

  it('the help line names the shortcut Chrome has bound, and the key to hold', () => {
    global.showOpenLinksShortcut();
    global.writeFormState({ key: 'q', modifier: null });
    expect(document.getElementById('openLinksHelp').textContent.replace(/\s+/g, ' ')).toBe(
      "Start it on a page with ⌥⇧L or the popup's Open links as tabs, then hold Q and drag. It stays on until the page reloads.");
    expect(document.querySelector('#openLinksShortcut kbd').textContent).toBe('⌥⇧L');
  });

  it('with no shortcut bound, the help line says where to set one', () => {
    chrome.commands.getAll.mockImplementationOnce((callback) => callback([{ name: '_execute_action', shortcut: '⌥⇧U' }, { name: 'open-links', shortcut: '' }]));
    global.showOpenLinksShortcut();
    expect(document.getElementById('openLinksShortcut').textContent).toBe('a shortcut you set at chrome://extensions/shortcuts');
  });

  it('saving the key says what to hold, and the help line follows it', async () => {
    chrome.storage.sync.set.mockImplementation((_payload, cb) => cb && cb());
    global.writeFormState({ key: 'z', modifier: null });
    document.getElementById('clumping-key').value = 'x';
    document.getElementById('clumping-modifier').value = 'alt';
    await global.handleFormChange();
    expect(document.getElementById('clumping-status').textContent).toBe('Saved · hold Alt+X and drag');
    expect(document.getElementById('openLinksKey').textContent).toBe('Alt+X');
  });
});
