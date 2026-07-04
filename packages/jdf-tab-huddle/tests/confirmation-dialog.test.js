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
      <div id="windowCount">Loading...</div>
      <ul id="operationList"></ul>
      <button id="confirmButton">Confirm</button>
      <button id="cancelButton">Cancel</button>
    `;

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

    test('respond function should send Chrome messages', () => {
      expect(typeof respond).toBe('function');

      respond(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'extractAllDomainsConfirmation',
        confirmed: true,
      });

      respond(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'extractAllDomainsConfirmation',
        confirmed: false,
      });
    });
  });

  describe('DOM Updates', () => {
    test('updateContent should update DOM elements using the mocked URL params', () => {
      const windowCountEl = document.getElementById('windowCount');
      const confirmButtonEl = document.getElementById('confirmButton');

      updateContent();

      // extractable=2, single=3 -> totalWindows = 2 + 1 = 3
      expect(windowCountEl.textContent).toBe('This will create 3 new browser windows.');
      expect(confirmButtonEl.textContent).toBe('🚀 Create 3 Windows');
    });

    test('operationList includes both extractable and miscellaneous list items', () => {
      updateContent();
      const html = document.getElementById('operationList').innerHTML;
      expect(html).toContain('<strong>2 windows</strong> will be created, one for each domain with 2+ tabs');
      expect(html).toContain('<strong>1 miscellaneous window</strong> will be created for 3 single-tab domains');
    });

    test('setupEventListeners should attach click handlers', () => {
      const confirmBtn = document.getElementById('confirmButton');
      const cancelBtn = document.getElementById('cancelButton');

      // Mock addEventListener to verify it's called
      confirmBtn.addEventListener = vi.fn();
      cancelBtn.addEventListener = vi.fn();

      setupEventListeners();

      expect(confirmBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
      expect(cancelBtn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });

  describe('DOM Updates - branch coverage', () => {
    test('totalWindows === 1 uses the singular "Window" label', () => {
      setLocationSearch('?extractable=1&single=0');
      loadConfirmationDialog();

      updateContent();

      expect(document.getElementById('windowCount').textContent).toBe(
        'This will create 1 new browser windows.'
      );
      expect(document.getElementById('confirmButton').textContent).toBe('🚀 Create 1 Window');
    });

    test('extractableCount === 0 omits the extractable-domains list item', () => {
      setLocationSearch('?extractable=0&single=3');
      loadConfirmationDialog();

      updateContent();

      const html = document.getElementById('operationList').innerHTML;
      expect(html).not.toContain('windows</strong> will be created, one for each domain');
      expect(html).toContain('<strong>1 miscellaneous window</strong> will be created for 3 single-tab domains');
      // totalWindows = 0 + 1 = 1
      expect(document.getElementById('confirmButton').textContent).toBe('🚀 Create 1 Window');
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
      expect(document.getElementById('confirmButton').textContent).toBe('🚀 Create 2 Windows');
    });
  });

  describe('Error Handling', () => {
    test('respond should handle Chrome API errors gracefully', () => {
      chrome.runtime.sendMessage.mockImplementation(() => {
        throw new Error('Chrome API error');
      });

      window.close = vi.fn();

      expect(() => respond(true)).not.toThrow();
      expect(window.close).toHaveBeenCalled();
    });
  });
});
