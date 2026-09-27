import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tests for src/ai-proposal.js — the AI grouping proposal tab UI logic.
// Functions are exposed globally by tests/setup.js.

describe('ai-proposal', () => {
  beforeEach(() => {
    // Match the body markup of ai-proposal.html so the exposed functions
    // find the elements they expect (#content, #actionsContainer,
    // #debugToggle, #debugSection, #applyButton, #cancelButton).
    document.body.innerHTML = `
      <div id="actionsContainer" class="actions" style="display: none;">
        <button class="confirm" id="applyButton">Apply</button>
        <button class="cancel" id="cancelButton">Cancel</button>
      </div>
      <div id="content"><div class="loading">Loading proposal...</div></div>
      <button class="debug-toggle" id="debugToggle" hidden>Show the model's raw output</button>
      <div class="debug-section" id="debugSection"></div>
    `;
  });

  function setProposal(overrides = {}) {
    const base = {
      type: 'ai-proposal',
      groups: [
        { name: 'Group A', color: 'blue', tabIds: [1, 2] },
        { name: 'Group B', color: 'red', tabIds: [3] },
      ],
      ungroupedTabIds: [4],
      tabs: [
        { id: 1, title: 'One', url: 'https://a.example.com/1' },
        { id: 2, title: 'Two', url: 'https://a.example.com/2' },
        { id: 3, title: 'Three', url: 'https://b.example.com/3' },
        { id: 4, title: 'Four', url: 'https://c.example.com/4' },
      ],
      windowId: 42,
    };
    handleMessage({ ...base, ...overrides });
  }

  function titlesIn(card) {
    return Array.from(card.querySelectorAll('.tab-title')).map((el) => el.textContent);
  }

  describe('escapeHtml', () => {
    test('escapes an XSS-shaped tab title and creates no live element', () => {
      const malicious = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(malicious);

      // Must not contain a raw/openable tag
      expect(escaped).not.toContain('<img');
      expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');

      // Re-parsing the escaped string must not create a live <img> element
      const container = document.createElement('div');
      container.innerHTML = escaped;
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe(malicious);
    });
  });

  describe('moveTab', () => {
    test('moves a tab between two groups', () => {
      setProposal();
      moveTab(3, 1, '0'); // tab 3 from Group B (index 1) into Group A (index 0)

      const cards = document.querySelectorAll('#content .group-card');
      expect(titlesIn(cards[0])).toEqual(['One', 'Two', 'Three']);
      expect(titlesIn(cards[1])).toEqual([]);
      expect(cards[0].querySelector('.tab-count').textContent).toBe('3 tabs');
      expect(cards[1].querySelector('.tab-count').textContent).toBe('0 tabs');
    });

    test('moves a tab from a group to ungrouped', () => {
      setProposal();
      moveTab(1, 0, 'ungrouped');

      const cards = document.querySelectorAll('#content .group-card');
      // cards[0] = Group A, cards[1] = Group B, cards[2] = Ungrouped
      expect(titlesIn(cards[0])).toEqual(['Two']);
      expect(titlesIn(cards[2])).toEqual(['Four', 'One']);
    });

    test('moves a tab from ungrouped into a group', () => {
      setProposal();
      moveTab(4, -1, '1'); // tab 4 from ungrouped into Group B (index 1)

      const cards = document.querySelectorAll('#content .group-card');
      expect(titlesIn(cards[1])).toEqual(['Three', 'Four']);
      // Ungrouped card should no longer render (empty list -> renderUngrouped returns null)
      expect(cards.length).toBe(2);
    });
  });

  describe('renderGroup pluralization', () => {
    test('shows singular "1 tab" for a single-tab group', () => {
      setProposal();
      const card = renderGroup({ name: 'Solo', color: 'blue', tabIds: [1] }, 0);
      expect(card.querySelector('.tab-count').textContent).toBe('1 tab');
    });

    test('shows plural "N tabs" for a multi-tab group', () => {
      setProposal();
      const card = renderGroup({ name: 'Multi', color: 'blue', tabIds: [1, 2, 3] }, 0);
      expect(card.querySelector('.tab-count').textContent).toBe('3 tabs');
    });
  });

  describe('apply button handler', () => {
    test('filters out zero-tabId groups before sending applyAiProposal', () => {
      setProposal({
        groups: [
          { name: 'Keep', color: 'blue', tabIds: [1, 2] },
          { name: 'Empty', color: 'red', tabIds: [] },
        ],
        ungroupedTabIds: [],
        windowId: 7,
      });
      setupActionButtons();

      document.getElementById('applyButton').click();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'applyAiProposal',
        groups: [{ name: 'Keep', color: 'blue', tabIds: [1, 2] }],
        ungroupedTabIds: [],
        respectGroups: true,
        windowId: 7,
      }, expect.any(Function));
    });

    test('sends the Ungrouped tabs so Flat mode can ungroup them', () => {
      setProposal();
      setupActionButtons();

      document.getElementById('applyButton').click();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'applyAiProposal', ungroupedTabIds: [4] }),
        expect.any(Function)
      );
    });

    test('disables Apply while it runs and shows a failure in the page', () => {
      let answer;
      chrome.runtime.sendMessage.mockImplementation((_msg, cb) => { answer = cb; });
      setProposal();
      setupActionButtons();
      const apply = document.getElementById('applyButton');

      apply.click();
      expect(apply.disabled).toBe(true);
      expect(apply.textContent).toBe('Applying...');

      answer({ success: false, error: 'No tab with id: 3' });
      expect(apply.disabled).toBe(false);
      expect(apply.textContent).toBe('Apply');
      const alert = document.getElementById('applyError');
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.hidden).toBe(false);
      expect(alert.textContent).toBe("Couldn't apply the groups: No tab with id: 3");
      // The proposal is still there to adjust and apply again.
      expect(document.querySelectorAll('#content .group-card').length).toBe(3);
    });

    test('a successful apply shows no error (the background closes the tab)', () => {
      chrome.runtime.sendMessage.mockImplementation((_msg, cb) => cb({ success: true }));
      setProposal();
      setupActionButtons();

      document.getElementById('applyButton').click();

      expect(document.getElementById('applyError')).toBeNull();
      expect(document.getElementById('applyButton').disabled).toBe(true);
    });
  });

  describe('handleMessage dispatch sequence', () => {
    test('handles ai-debug -> ai-chunk -> ai-proposal -> ai-error in order', () => {
      // 1. ai-debug: builds the debug section but keeps it closed; the toggle
      //    stays hidden because there is no raw output yet
      handleMessage({
        type: 'ai-debug',
        model: 'anthropic/claude-haiku-4.5',
        messages: [{ role: 'user', content: 'Group my tabs' }],
      });
      const debugSection = document.getElementById('debugSection');
      const debugToggle = document.getElementById('debugToggle');
      expect(debugSection.classList.contains('visible')).toBe(false);
      expect(debugToggle.hidden).toBe(true);
      expect(document.getElementById('rawResponsePre')).not.toBeNull();

      // 2. ai-chunk: appends streamed text into the raw response <pre>; the
      //    first output opens the section together with its toggle
      handleMessage({ type: 'ai-chunk', text: 'Hello ' });
      expect(debugToggle.hidden).toBe(false);
      expect(debugSection.classList.contains('visible')).toBe(true);
      expect(debugToggle.textContent).toBe('Hide the model\'s raw output');
      handleMessage({ type: 'ai-chunk', text: 'World' });
      expect(document.getElementById('rawResponsePre').textContent).toBe('Hello World');

      // 3. ai-proposal: renders the proposal and collapses the debug section
      handleMessage({
        type: 'ai-proposal',
        groups: [{ name: 'Group A', color: 'blue', tabIds: [1] }],
        ungroupedTabIds: [],
        tabs: [{ id: 1, title: 'One', url: 'https://a.example.com/1' }],
        windowId: 1,
      });
      expect(document.querySelectorAll('#content .group-card').length).toBe(1);
      expect(debugSection.classList.contains('visible')).toBe(false);
      expect(debugToggle.textContent).toBe('Show the model\'s raw output');

      // 4. ai-error: replaces content with an error message
      handleMessage({ type: 'ai-error', error: 'Something broke' });
      const content = document.getElementById('content');
      expect(content.innerHTML).toContain('error-msg');
      expect(content.textContent).toContain('Something broke');
    });

    test('an error before any output leaves no prompt dump without a toggle', () => {
      // A 401/402/network failure: ai-debug arrives, then ai-error, no chunk.
      handleMessage({
        type: 'ai-debug',
        model: 'anthropic/claude-haiku-4.5',
        messages: [{ role: 'user', content: 'Group my tabs' }],
      });
      handleMessage({ type: 'ai-error', error: 'Invalid API key' });

      const debugSection = document.getElementById('debugSection');
      const debugToggle = document.getElementById('debugToggle');
      expect(debugToggle.hidden).toBe(true);
      expect(debugSection.classList.contains('visible')).toBe(false);
      expect(document.getElementById('content').textContent).toContain('Invalid API key');
    });
  });
});

// The run handshake, Run again and the error view depend on the page's URL
// (respectGroups) and on what init() renders, so these re-evaluate the page
// script against a fresh DOM, like tests/ai-setup.test.js does.
describe('ai-proposal run lifecycle', () => {
  const source = readFileSync(resolve(__dirname, '../src/ai-proposal.js'), 'utf8');

  function loadAiProposal(search = '?respectGroups=true') {
    Object.defineProperty(window, 'location', {
      value: { search },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = `
      <div id="actionsContainer" class="actions" style="display: none;">
        <button class="confirm" id="applyButton">Apply</button>
        <button class="cancel" id="cancelButton">Cancel</button>
      </div>
      <div id="content"><div class="loading">Loading proposal...</div></div>
      <button class="debug-toggle" id="debugToggle" hidden>Show the model's raw output</button>
      <div class="debug-section" id="debugSection"></div>
    `;
    return eval(`(function() { ${source}\n return { handleMessage, showError }; })()`);
  }

  // Answers chrome.runtime.sendMessage callbacks by action.
  function answerMessages(replies) {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb && msg.action in replies) cb(replies[msg.action]);
    });
  }

  function buttonNamed(label) {
    return Array.from(document.querySelectorAll('#content button'))
      .find((b) => b.textContent === label);
  }

  function clickOrganize() {
    document.getElementById('startOrganize').click();
  }

  beforeEach(() => {
    window.close = vi.fn();
    chrome.runtime.lastError = null;
  });

  afterEach(() => {
    chrome.runtime.lastError = null;
    vi.restoreAllMocks();
  });

  test('stays on Starting... while its run is pending', () => {
    answerMessages({ aiProposalReady: { success: true, pending: true } });
    loadAiProposal();
    clickOrganize();

    expect(document.getElementById('content').textContent).toContain('Starting...');
  });

  test('shows "This run has ended" when no run is waiting for the tab', () => {
    answerMessages({ aiProposalReady: { success: true, pending: false } });
    const page = loadAiProposal();
    clickOrganize();

    const content = document.getElementById('content');
    expect(content.textContent).toContain('This run has ended');
    expect(content.querySelector('[role="status"]')).not.toBeNull();
    expect(buttonNamed('Run again')).toBeDefined();
    // Late messages from an old run no longer reach the page.
    expect(chrome.runtime.onMessage.hasListener(page.handleMessage)).toBe(false);
  });

  test('shows the ended state when the background cannot answer', () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
      if (cb) cb(undefined);
    });
    loadAiProposal();
    clickOrganize();

    expect(document.getElementById('content').textContent).toContain('This run has ended');
  });

  test('a refreshed page shows the ended state instead of the form', () => {
    vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' }]);
    loadAiProposal();

    expect(document.getElementById('startOrganize')).toBeNull();
    expect(document.getElementById('content').textContent).toContain('This run has ended');
  });

  test('Run again starts a new organize with the page\'s mode and closes this tab', () => {
    answerMessages({
      aiProposalReady: { success: true, pending: false },
      aiGroupTabs: { success: true, action: 'proposal' },
    });
    loadAiProposal('?respectGroups=false');
    clickOrganize();
    buttonNamed('Run again').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'aiGroupTabs', respectGroups: false },
      expect.any(Function)
    );
    expect(window.close).toHaveBeenCalled();
  });

  test('Run again that cannot start says why and keeps the tab', () => {
    answerMessages({
      aiProposalReady: { success: true, pending: false },
      aiGroupTabs: { success: false, error: 'storage is unavailable' },
    });
    loadAiProposal();
    clickOrganize();
    buttonNamed('Run again').click();

    expect(window.close).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]').textContent)
      .toBe("Couldn't start a new run: storage is unavailable");
  });

  test('the error view is announced and offers Retry and AI settings', () => {
    answerMessages({ aiGroupTabs: { success: true, action: 'proposal' } });
    const page = loadAiProposal('?respectGroups=false');
    page.handleMessage({ type: 'ai-error', error: 'Invalid API key' });

    const alert = document.querySelector('#content [role="alert"]');
    expect(alert.textContent).toBe('Invalid API key');
    expect(document.getElementById('actionsContainer').style.display).toBe('none');

    buttonNamed('Open AI settings').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'openAiSettings' });

    buttonNamed('Retry').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'aiGroupTabs', respectGroups: false },
      expect.any(Function)
    );
    expect(window.close).toHaveBeenCalled();
  });

  test('Organize does not reveal the raw-output toggle before any output', () => {
    answerMessages({ aiProposalReady: { success: true, pending: true } });
    loadAiProposal();
    clickOrganize();

    expect(document.getElementById('debugToggle').hidden).toBe(true);
    expect(document.getElementById('debugSection').classList.contains('visible')).toBe(false);
  });
});
