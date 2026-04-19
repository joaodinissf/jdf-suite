import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    expect(global.optionsApplyDefaults({})).toEqual({ enabled: true, key: 'z', modifier: null });
    expect(global.optionsApplyDefaults(null)).toEqual({ enabled: true, key: 'z', modifier: null });
    expect(global.optionsApplyDefaults(undefined)).toEqual({ enabled: true, key: 'z', modifier: null });
  });

  it('respects valid overrides', () => {
    expect(global.optionsApplyDefaults({ enabled: false, key: 'x', modifier: 'shift' }))
      .toEqual({ enabled: false, key: 'x', modifier: 'shift' });
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

  it('coerces non-boolean enabled to default (true)', () => {
    expect(global.optionsApplyDefaults({ enabled: 'yes' }).enabled).toBe(true);
    expect(global.optionsApplyDefaults({ enabled: 1 }).enabled).toBe(true);
    expect(global.optionsApplyDefaults({ enabled: 0 }).enabled).toBe(true);
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
    expect(settings).toEqual({ enabled: true, key: 'z', modifier: null });
  });

  it('loadClumpingSettings returns stored values', async () => {
    global.chrome.storage.sync.get.mockImplementation((_keys, cb) => cb({
      clumping: { enabled: false, key: 'x', modifier: 'shift' },
    }));
    const settings = await global.loadClumpingSettings();
    expect(settings).toEqual({ enabled: false, key: 'x', modifier: 'shift' });
  });

  it('loadClumpingSettings applies defaults for partial stored values', async () => {
    global.chrome.storage.sync.get.mockImplementation((_keys, cb) => cb({
      clumping: { key: 'a' },
    }));
    const settings = await global.loadClumpingSettings();
    expect(settings).toEqual({ enabled: true, key: 'a', modifier: null });
  });

  it('saveClumpingSettings round-trips through apply-defaults', async () => {
    global.chrome.storage.sync.set.mockImplementation((_payload, cb) => cb && cb());
    const saved = await global.saveClumpingSettings({ enabled: false, key: 'Q', modifier: 'alt' });
    expect(saved).toEqual({ enabled: false, key: 'q', modifier: 'alt' });
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
      { clumping: { enabled: false, key: 'q', modifier: 'alt' } },
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
    document.body.innerHTML = '';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.id = 'clumping-enabled';
    document.body.appendChild(enabled);

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

  it('writeFormState populates all three controls', () => {
    global.writeFormState({ enabled: false, key: 'x', modifier: 'shift' });
    expect(document.getElementById('clumping-enabled').checked).toBe(false);
    expect(document.getElementById('clumping-key').value).toBe('x');
    expect(document.getElementById('clumping-modifier').value).toBe('shift');
  });

  it('readFormState reflects user-set values with defaults applied', () => {
    global.writeFormState({ enabled: true, key: 'z', modifier: null });
    document.getElementById('clumping-enabled').checked = true;
    document.getElementById('clumping-key').value = 'a';
    document.getElementById('clumping-modifier').value = 'alt';
    expect(global.readFormState()).toEqual({ enabled: true, key: 'a', modifier: 'alt' });
  });

  it('readFormState treats empty modifier as null', () => {
    global.writeFormState({ enabled: true, key: 'z', modifier: null });
    document.getElementById('clumping-modifier').value = '';
    expect(global.readFormState().modifier).toBe(null);
  });
});

describe('content-clumper integration: clumperApplySettings', () => {
  beforeEach(() => {
    global.clumperResetStateForTest();
  });

  it('sets activation key from stored settings', () => {
    global.clumperApplySettings({ enabled: true, key: 'x', modifier: null });
    // Test via behavior: keydown for 'x' should now arm, but 'z' should not
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    // restore default for subsequent tests
    global.clumperApplySettings({ enabled: true, key: 'z', modifier: null });
  });

  it('disabled=false prevents arming even on the activation key', () => {
    global.clumperApplySettings({ enabled: false, key: 'z', modifier: null });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    global.clumperApplySettings({ enabled: true, key: 'z', modifier: null });
  });

  it('requires the configured modifier', () => {
    global.clumperApplySettings({ enabled: true, key: 'z', modifier: 'shift' });
    // Without shift: no arm
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: false, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(false);
    // With shift: arms
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: true, bubbles: true }));
    expect(global.clumperGetStateForTest().keyHeld).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    global.clumperApplySettings({ enabled: true, key: 'z', modifier: null });
  });
});
