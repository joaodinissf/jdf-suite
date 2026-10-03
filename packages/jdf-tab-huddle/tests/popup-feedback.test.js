// Popup feedback: failures are reported, partial failures read as errors,
// actions and snoozes can't be started twice, and toasts stay readable and off
// the footer. Globals are exposed via tests/setup.js.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupHtml = readFileSync(resolve(__dirname, '../src/popup.html'), 'utf8');

const TOASTS = `
  <div class="toasts">
    <div id="actionResult" class="action-result" role="status" hidden></div>
    <div id="copyFeedback" class="copy-feedback" role="status">Copied!</div>
    <div id="discardNotice" class="undo-notice" hidden><span id="discardNoticeText"></span></div>
  </div>`;

// Replies to sendMessage are held until the test releases them, like a
// background still busy with the work.
function holdReplies() {
  const held = [];
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    // log() also messages the background, with no callback; only hold actions.
    if (callback) held.push({ message, callback });
    return Promise.resolve();
  });
  return held;
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = popupHtml.match(new RegExp(`\\n\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

beforeEach(() => {
  document.body.innerHTML = TOASTS;
  document.body.className = '';
  document.body.removeAttribute('style');
  chrome.runtime.lastError = null;
});

describe('Copy this / all windows report failures', () => {
  let writeText;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('a runtime error shows an error toast instead of nothing', () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (!callback) return Promise.resolve();
      chrome.runtime.lastError = { message: 'Could not establish connection.' };
      callback(undefined);
      chrome.runtime.lastError = null;
    });
    copyTabsToClipboard('window');
    const el = document.getElementById('actionResult');
    expect(el.hidden).toBe(false);
    expect(el.classList.contains('error')).toBe(true);
    expect(el.textContent).toBe("Couldn't copy: Could not establish connection.");
    expect(writeText).not.toHaveBeenCalled();
  });

  test('a { success: false } reply shows the background error', () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (!callback) return Promise.resolve();
      callback({ success: false, error: 'No tab with id: 4.' });
      return Promise.resolve();
    });
    copyTabsToClipboard('all');
    const el = document.getElementById('actionResult');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("Couldn't copy: No tab with id: 4.");
  });

  test('a refused clipboard write shows an error, not "Copied"', async () => {
    writeText.mockRejectedValue(new Error('Document is not focused.'));
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (!callback) return Promise.resolve();
      callback({ success: true, text: 'https://a.test', tabCount: 1 });
      return Promise.resolve();
    });
    copyTabsToClipboard('window');
    await flush();
    expect(document.getElementById('copyFeedback').classList.contains('visible')).toBe(false);
    const el = document.getElementById('actionResult');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe("Couldn't copy: Document is not focused.");
  });

  test("a second copy's message is not hidden early by the first copy's timer", async () => {
    vi.useFakeTimers();
    try {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (!callback) return Promise.resolve();
        callback({ success: true, text: 'x', tabCount: message.scope === 'window' ? 2 : 5 });
        return Promise.resolve();
      });
      const feedback = document.getElementById('copyFeedback');
      copyTabsToClipboard('window');
      await vi.advanceTimersByTimeAsync(1000);
      copyTabsToClipboard('all');
      await vi.advanceTimersByTimeAsync(0);
      expect(feedback.textContent).toBe('Copied 5 tabs (all windows)');
      // The first copy's 1.5 s would have ended here.
      await vi.advanceTimersByTimeAsync(700);
      expect(feedback.classList.contains('visible')).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(feedback.classList.contains('visible')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Partial failures read as errors', () => {
  test.each([
    [{ paired: 1, failed: 1 }, 'error'],
    [{ unsplit: 0, failed: 2 }, 'error'],
    [{ removed: 2, sortFailed: true }, 'error'],
    [{ moved: 4, notMoved: 1 }, 'error'],
    [{ removed: 2, sortFailed: false }, 'ok'],
    [{ paired: 2, failed: 0 }, 'ok'],
  ])('%j → %s', (response, kind) => {
    expect(actionResultKind(response)).toBe(kind);
  });

  test('sendAction shows a Compact that paired nothing as an error', () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (callback) callback({ success: true, paired: 0, failed: 2 });
      return Promise.resolve();
    });
    sendAction('compactWindow');
    const el = document.getElementById('actionResult');
    expect(el.textContent).toBe("Couldn't pair any tabs");
    expect(el.classList.contains('error')).toBe(true);
  });

  test('sendAction does not say "and sorted" when the sort failed', () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (callback) callback({ success: true, removed: 2, sortFailed: true });
      return Promise.resolve();
    });
    sendAction('removeDuplicatesWindow');
    const el = document.getElementById('actionResult');
    expect(el.textContent).toBe("Closed 2 duplicates; couldn't sort, try Sort");
    expect(el.classList.contains('error')).toBe(true);
  });
});

describe('An action already running is not started again', () => {
  test('a second sendAction for the same action is ignored until the reply', () => {
    const held = holdReplies();
    sendAction('removeDuplicatesWindow', { respectGroups: true });
    sendAction('removeDuplicatesWindow', { respectGroups: true });
    expect(held).toHaveLength(1);

    held[0].callback({ success: true, removed: 1 });
    sendAction('removeDuplicatesWindow', { respectGroups: true });
    expect(held).toHaveLength(2);
    held[1].callback({ success: true, removed: 0 });
  });

  test('a different action is not blocked', () => {
    const held = holdReplies();
    sendAction('sortCurrentWindow');
    sendAction('flattenWindow');
    expect(held.map((h) => h.message.action)).toEqual(['sortCurrentWindow', 'flattenWindow']);
    held.forEach((h) => h.callback({ success: true }));
  });

  test('the running action\'s button is aria-busy until the reply, and dims (L40)', () => {
    document.body.insertAdjacentHTML('beforeend',
      '<button id="moveAllToSingleWindow" class="btn" data-action="moveAllToSingleWindow">Merge windows</button>');
    const button = document.getElementById('moveAllToSingleWindow');
    const held = holdReplies();
    sendAction('moveAllToSingleWindow', { activeTabId: 1, respectGroups: true });
    expect(button.getAttribute('aria-busy')).toBe('true');
    held[0].callback({ success: true, moved: 150 });
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(cssRule('.btn[aria-busy="true"]')).toMatch(/cursor:\s*progress/);
  });

  test('a failed reply also releases the action', () => {
    const held = holdReplies();
    sendAction('sortCurrentWindow');
    held[0].callback({ success: false, error: 'boom' });
    sendAction('sortCurrentWindow');
    expect(held).toHaveLength(2);
    held[1].callback({ success: true });
  });
});

describe('A snooze preset cannot snooze twice', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="grp" id="snoozeSection">
        <button id="snoozeTab" class="chip">Tab</button>
        <div id="snoozePickerPanel" hidden></div>
        <div id="snoozeFeedback"></div>
      </div>${TOASTS}`;
  });

  test('a double click sends one snooze while the first is in flight', () => {
    const held = holdReplies();
    openSnoozePicker('tab');
    submitSnooze(Date.now() + 3600000, 'tomorrow');
    submitSnooze(Date.now() + 3600000, 'tomorrow');
    expect(held).toHaveLength(1);
    held[0].callback({ success: true, record: { wakeAt: Date.now() + 3600000 } });
  });

  test('after a failed snooze the user can try again', () => {
    const held = holdReplies();
    openSnoozePicker('tab');
    submitSnooze(Date.now() + 3600000, 'tomorrow');
    held[0].callback({ success: false, error: 'Tabs cannot be edited right now' });
    expect(document.getElementById('snoozeFeedback').textContent).toBe('Tabs cannot be edited right now');
    submitSnooze(Date.now() + 3600000, 'tomorrow');
    expect(held).toHaveLength(2);
    held[1].callback({ success: true, record: { wakeAt: Date.now() + 3600000 } });
    closeSnoozePicker();
  });
});

describe('Toasts stay readable and off the footer', () => {
  test('an error toast keeps an opaque surface', () => {
    const rule = cssRule('.action-result.error');
    expect(rule).not.toBeNull();
    expect(rule).toMatch(/background:\s*color-mix\(.*var\(--comp-hi\)\)/);
    expect(rule).not.toMatch(/transparent/);
  });

  test('a long result wraps instead of being cut with an ellipsis', () => {
    const rule = cssRule('.action-result');
    expect(rule).not.toBeNull();
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
  });

  test('an error stays up longer than a success', () => {
    vi.useFakeTimers();
    try {
      const el = document.getElementById('actionResult');
      showActionResult("Couldn't organize with AI: Invalid API key. Please check your OpenRouter key.", 'error');
      vi.advanceTimersByTime(8000);
      expect(el.hidden).toBe(false);
      vi.advanceTimersByTime(7000);
      expect(el.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('the page reserves space at the bottom while a toast shows', () => {
    expect(cssRule('body.has-toast')).toMatch(/padding-bottom/);
    // ...and keyboard focus scrolls a control clear of it, toast inset included (L37).
    expect(cssRule('html:has(body.has-toast)')).toMatch(/scroll-padding-bottom:\s*calc\(var\(--toast-space,\s*34px\)\s*\+\s*10px\)/);
    vi.useFakeTimers();
    try {
      showActionResult('Sorted 3 tabs');
      expect(document.body.classList.contains('has-toast')).toBe(true);
      vi.advanceTimersByTime(8000);
      expect(document.body.classList.contains('has-toast')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('the reserved space follows the measured toast height', () => {
    const stack = document.querySelector('.toasts');
    stack.getBoundingClientRect = () => ({ height: 57.2 });
    showActionResult('A result long enough to wrap onto a second line');
    expect(document.documentElement.style.getPropertyValue('--toast-space')).toBe('58px');
    document.getElementById('actionResult').hidden = true;
    updateToastSpace();
    expect(document.body.classList.contains('has-toast')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--toast-space')).toBe('');
  });

  test('a hidden "Copied!" toast does not count as showing', () => {
    updateToastSpace();
    expect(document.body.classList.contains('has-toast')).toBe(false);
  });
});
