import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const confirmationJsSource = readFileSync(
  resolve(__dirname, '../src/confirmation-dialog.js'),
  'utf8'
);

// src/confirmation-dialog.js computes its `extractableCount` / `singleTabCount` /
// `totalWindows` constants at *module-eval* time by reading window.location.search.
// tests/setup.js evals the source exactly once, before any test's beforeEach has a
// chance to mock window.location — so those constants get baked in from jsdom's
// default (empty) location and never reflect what an individual test configures.
//
// Rather than changing src (the constants intentionally read the URL once, matching
// how the real confirmation-dialog.html page is loaded fresh per navigation), we
// re-eval the source here, per test, *after* window.location has been mocked. This
// mirrors setup.js's own loading pattern (IIFE wrapper + global exposure) but runs
// on demand instead of once at suite bootstrap.
function loadConfirmationDialog() {
  const wrapper = `
    (function() {
      ${confirmationJsSource}
      global.updateContent = updateContent;
      global.setupEventListeners = setupEventListeners;
      global.respond = respond;
    })();
  `;
  eval(wrapper);
}

function setLocationSearch(search) {
  Object.defineProperty(window, 'location', {
    value: { search },
    writable: true,
    configurable: true,
  });
}

describe('Confirmation Dialog', () => {
  beforeEach(() => {
    // Setup minimal DOM for testing
    document.body.innerHTML = `
      <main>
        <div id="windowCount">Loading...</div>
        <ul id="operationList"></ul>
        <p id="dialogResult" hidden></p>
        <p id="dialogError" hidden></p>
        <button id="confirmButton">Confirm</button>
        <button id="cancelButton">Cancel</button>
      </main>
    `;
    // A real close would tear down jsdom's window for the rest of the file.
    window.close = vi.fn();

    // Mock URL parameters BEFORE re-evaluating the source, so the module-level
    // extractableCount/singleTabCount/totalWindows constants pick this up.
    setLocationSearch('?extractable=2&single=3');
    loadConfirmationDialog();
  });

  describe('Dialog Functions', () => {
    test('updateContent should be defined and callable', () => {
      expect(typeof updateContent).toBe('function');
      expect(() => updateContent()).not.toThrow();
    });

    test('setupEventListeners should be defined and callable', () => {
      expect(typeof setupEventListeners).toBe('function');
      expect(() => setupEventListeners()).not.toThrow();
    });
  });

  // The page is loaded as it is in Chrome (beforeEach), so these go through
  // its real listeners.
  describe('Buttons and keys', () => {
    const click = (id) => document.getElementById(id).click();
    const key = (init) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    const sent = () => chrome.runtime.sendMessage.mock.calls.map(([m]) => m);

    test('Confirm sends confirmed: true', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, windows: 3 });
      click('confirmButton');
      expect(sent()).toEqual([{ action: 'extractAllDomainsConfirmation', confirmed: true }]);
    });

    test('Cancel sends confirmed: false', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, cancelled: true });
      click('cancelButton');
      expect(sent()).toEqual([{ action: 'extractAllDomainsConfirmation', confirmed: false }]);
    });

    test('Cancel has the focus when the page opens', () => {
      expect(document.activeElement).toBe(document.getElementById('cancelButton'));
    });

    test('Escape cancels', () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, cancelled: true });
      key({ key: 'Escape' });
      expect(sent()).toEqual([{ action: 'extractAllDomainsConfirmation', confirmed: false }]);
    });

    test.each([['Cmd', { metaKey: true }], ['Ctrl', { ctrlKey: true }]])('%s+Enter confirms', (_name, mods) => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, windows: 3 });
      key({ key: 'Enter', ...mods });
      expect(sent()).toEqual([{ action: 'extractAllDomainsConfirmation', confirmed: true }]);
    });

    test('plain Enter is left to the focused button', () => {
      key({ key: 'Enter' });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('while the split runs, Confirm says so, the page is busy and the keys do nothing', async () => {
      let answer;
      chrome.runtime.sendMessage.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      click('confirmButton');

      const confirmBtn = document.getElementById('confirmButton');
      expect(confirmBtn.textContent).toBe('Creating 3 windows…');
      expect(confirmBtn.disabled).toBe(true);
      expect(document.getElementById('cancelButton').disabled).toBe(true);
      expect(document.querySelector('main').getAttribute('aria-busy')).toBe('true');
      key({ key: 'Escape' });
      key({ key: 'Enter', metaKey: true });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

      answer({ success: true, windows: 3, notMoved: 0, sortFailed: false });
      await vi.waitFor(() => expect(document.getElementById('dialogResult').hidden).toBe(false));
      expect(document.querySelector('main').hasAttribute('aria-busy')).toBe(false);
    });
  });

  describe("The split's result", () => {
    test('a Confirm shows what the split did and leaves only Close, which closes the tab', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, windows: 6, notMoved: 2, sortFailed: true });

      await respond(true);

      const resultEl = document.getElementById('dialogResult');
      expect(resultEl.hidden).toBe(false);
      expect(resultEl.textContent).toBe("Split into 6 windows; 2 tabs couldn't be moved; couldn't sort, try Sort");
      expect(document.getElementById('dialogError').hidden).toBe(true);
      expect(document.getElementById('confirmButton').hidden).toBe(true);
      const closeBtn = document.getElementById('cancelButton');
      expect(closeBtn.textContent).toBe('Close');
      expect(closeBtn.disabled).toBe(false);
      expect(document.activeElement).toBe(closeBtn);
      expect(window.close).not.toHaveBeenCalled();

      closeBtn.click();
      expect(window.close).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('a clean split says only how many windows it made', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, windows: 1, notMoved: 0, sortFailed: false });
      await respond(true);
      expect(document.getElementById('dialogResult').textContent).toBe('Split into 1 window');
    });

    test('Escape closes the tab once the result is shown', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, windows: 3 });
      await respond(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(window.close).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('Answers the background could not act on', () => {
    test('a Confirm the background no longer knows about says so and leaves only Close', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({
        success: false, expired: true, error: 'This split request has ended.',
      });

      await respond(true);

      const errorEl = document.getElementById('dialogError');
      expect(errorEl.hidden).toBe(false);
      expect(errorEl.textContent).toBe('This split request has ended.');
      expect(document.getElementById('confirmButton').disabled).toBe(true);
      const cancelBtn = document.getElementById('cancelButton');
      expect(cancelBtn.disabled).toBe(false);
      expect(cancelBtn.textContent).toBe('Close');
      expect(document.activeElement).toBe(cancelBtn);
      expect(window.close).not.toHaveBeenCalled();
    });

    test('a Confirm nobody answers says so instead of doing nothing', async () => {
      chrome.runtime.sendMessage.mockResolvedValue(undefined);

      await respond(true);

      expect(document.getElementById('dialogError').hidden).toBe(false);
      expect(document.getElementById('dialogError').textContent).toContain('run Split domains again');
    });

    test('a Cancel the background could not handle still closes the tab', async () => {
      chrome.runtime.sendMessage.mockRejectedValue(new Error('Could not establish connection.'));

      await respond(false);

      expect(window.close).toHaveBeenCalled();
    });

    test('an answered Cancel leaves closing the tab to the background', async () => {
      chrome.runtime.sendMessage.mockResolvedValue({ success: true, cancelled: true });

      await respond(false);

      expect(window.close).not.toHaveBeenCalled();
    });
  });

  describe('DOM Updates', () => {
    test('updateContent should update DOM elements using the mocked URL params', () => {
      const windowCountEl = document.getElementById('windowCount');
      const confirmButtonEl = document.getElementById('confirmButton');

      updateContent();

      // extractable=2, single=3 -> totalWindows = 2 + 1 = 3
      expect(windowCountEl.textContent).toBe('This will create 3 new browser windows.');
      expect(confirmButtonEl.textContent).toBe('Create 3 windows');
    });

    test('operationList includes both extractable and miscellaneous list items', () => {
      updateContent();
      const html = document.getElementById('operationList').innerHTML;
      expect(html).toContain('<strong>2 windows</strong> will be created, one for each domain with 2+ tabs');
      expect(html).toContain('<strong>1 miscellaneous window</strong> will be created for 3 single-tab domains');
    });
  });

  describe('What the page says', () => {
    const html = readFileSync(resolve(__dirname, '../src/confirmation-dialog.html'), 'utf8');

    test('it is called Split domains, like the button that opens it', () => {
      expect(html).toContain('<title>Huddle — Split domains</title>');
      expect(html).toContain('<h1>Split domains</h1>');
      expect(html).not.toMatch(/extract/i);
      updateContent();
      expect(document.getElementById('operationList').innerHTML).toContain('sorted alphabetically by URL after splitting');
    });

    test('one single-tab domain is singular', () => {
      setLocationSearch('?extractable=5&single=1');
      loadConfirmationDialog();
      updateContent();
      expect(document.getElementById('operationList').innerHTML).toContain('will be created for 1 single-tab domain</li>');
    });

    test.each([
      ['keep', 'Tab groups are kept', 'Tabs leave their groups'],
      ['flat', 'Tabs leave their groups (Flat mode)', 'Tab groups are kept'],
    ])('groups=%s says "%s"', (mode, line, other) => {
      setLocationSearch(`?extractable=6&single=0&groups=${mode}`);
      loadConfirmationDialog();
      updateContent();
      const list = document.getElementById('operationList').innerHTML;
      expect(list).toContain(`<li>${line}</li>`);
      expect(list).not.toContain(other);
    });
  });

  describe('DOM Updates - branch coverage', () => {
    test('totalWindows === 1 uses the singular "Window" label (button and window-count text)', () => {
      setLocationSearch('?extractable=1&single=0');
      loadConfirmationDialog();

      updateContent();

      expect(document.getElementById('windowCount').textContent).toBe(
        'This will create 1 new browser window.'
      );
      expect(document.getElementById('confirmButton').textContent).toBe('Create 1 window');
    });

    test('totalWindows > 1 uses the plural "windows" label (button and window-count text)', () => {
      setLocationSearch('?extractable=2&single=0');
      loadConfirmationDialog();

      updateContent();

      expect(document.getElementById('windowCount').textContent).toBe(
        'This will create 2 new browser windows.'
      );
      expect(document.getElementById('confirmButton').textContent).toBe('Create 2 windows');
    });

    test('extractableCount === 0 omits the extractable-domains list item', () => {
      setLocationSearch('?extractable=0&single=3');
      loadConfirmationDialog();

      updateContent();

      const html = document.getElementById('operationList').innerHTML;
      expect(html).not.toContain('windows</strong> will be created, one for each domain');
      expect(html).toContain('<strong>1 miscellaneous window</strong> will be created for 3 single-tab domains');
      // totalWindows = 0 + 1 = 1
      expect(document.getElementById('confirmButton').textContent).toBe('Create 1 window');
    });

    test('singleTabCount === 0 omits the miscellaneous-window list item', () => {
      setLocationSearch('?extractable=2&single=0');
      loadConfirmationDialog();

      updateContent();

      const html = document.getElementById('operationList').innerHTML;
      expect(html).toContain('<strong>2 windows</strong> will be created, one for each domain with 2+ tabs');
      expect(html).not.toContain('miscellaneous window');
      // totalWindows = 2 + 0 = 2
      expect(document.getElementById('windowCount').textContent).toBe(
        'This will create 2 new browser windows.'
      );
      expect(document.getElementById('confirmButton').textContent).toBe('Create 2 windows');
    });
  });

  describe('Error Handling', () => {
    test('respond should handle Chrome API errors gracefully', async () => {
      chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Chrome API error');
      });

      await expect(respond(true)).resolves.toBeUndefined();
      expect(document.getElementById('dialogError').hidden).toBe(false);
    });
  });
});
