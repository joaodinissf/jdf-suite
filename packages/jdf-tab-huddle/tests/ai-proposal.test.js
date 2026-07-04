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
      <button class="debug-toggle" id="debugToggle">Show raw model I/O</button>
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
        windowId: 7,
      });
    });
  });

  describe('handleMessage dispatch sequence', () => {
    test('handles ai-debug -> ai-chunk -> ai-proposal -> ai-error in order', () => {
      // 1. ai-debug: builds the debug section and shows it
      handleMessage({
        type: 'ai-debug',
        model: 'anthropic/claude-haiku-4.5',
        messages: [{ role: 'user', content: 'Group my tabs' }],
      });
      const debugSection = document.getElementById('debugSection');
      const debugToggle = document.getElementById('debugToggle');
      expect(debugSection.classList.contains('visible')).toBe(true);
      expect(debugToggle.textContent).toBe('Hide raw model I/O');
      expect(document.getElementById('rawResponsePre')).not.toBeNull();

      // 2. ai-chunk: appends streamed text into the raw response <pre>
      handleMessage({ type: 'ai-chunk', text: 'Hello ' });
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
      expect(debugToggle.textContent).toBe('Show raw model I/O');

      // 4. ai-error: replaces content with an error message
      handleMessage({ type: 'ai-error', error: 'Something broke' });
      const content = document.getElementById('content');
      expect(content.innerHTML).toContain('error-msg');
      expect(content.textContent).toContain('Something broke');
    });
  });
});
