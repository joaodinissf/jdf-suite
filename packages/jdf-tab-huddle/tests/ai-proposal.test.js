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

// The run handshake, Run again, the model bar, the inline key form and the
// error view depend on the page's URL and on what init() renders, so these
// re-evaluate the page script against the real page markup.
describe('ai-proposal run lifecycle', () => {
  const source = readFileSync(resolve(__dirname, '../src/ai-proposal.js'), 'utf8');
  const html = readFileSync(resolve(__dirname, '../src/ai-proposal.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '');

  const MODELS = [
    { id: 'm1', name: 'Model One', cost: '$0.01/tab', curated: true, supportsStructuredOutputs: true },
    { id: 'm2', name: 'Model Two', cost: '$0.02/tab', curated: false, supportsStructuredOutputs: false },
  ];
  const EXPIRY_PRESETS = [{ value: 86400000, label: '1 day' }, { value: null, label: 'Never' }];
  const MODELS_META = { fetchedAt: Date.now(), fromCache: true, stale: false, fallback: false, error: null };
  const KEYED = { key: btoa('sk-or-k'), model: 'm1', expiresAt: null, expiryDuration: 86400000 };
  const configReply = (config) => ({
    config, models: MODELS, expiryPresets: EXPIRY_PRESETS, modelsMeta: MODELS_META, defaultModel: 'm1',
  });

  function loadAiProposal(search = '?respectGroups=true') {
    Object.defineProperty(window, 'location', {
      value: { search },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = body;
    return eval(`(function() { ${source}\n return { handleMessage, showError }; })()`);
  }

  // Answers chrome.runtime.sendMessage callbacks by action: a reply object,
  // or (message) => reply.
  function answerMessages(replies) {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (!cb || !(msg.action in replies)) return;
      const reply = replies[msg.action];
      cb(typeof reply === 'function' ? reply(msg) : reply);
    });
  }

  function flushPromises() {
    return new Promise((r) => setTimeout(r, 0));
  }

  const sent = (action) => chrome.runtime.sendMessage.mock.calls
    .map(([m]) => m)
    .filter((m) => m.action === action);

  function buttonNamed(label) {
    return Array.from(document.querySelectorAll('#content button'))
      .find((b) => b.textContent === label);
  }

  function clickOrganize() {
    document.getElementById('startOrganize').click();
  }

  const proposalMessage = {
    type: 'ai-proposal',
    groups: [{ name: 'Group A', color: 'blue', tabIds: [1] }],
    ungroupedTabIds: [],
    tabs: [{ id: 1, title: 'One', url: 'https://a.example.com/1' }],
    windowId: 1,
  };

  beforeEach(() => {
    window.close = vi.fn();
    chrome.runtime.lastError = null;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
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

  test('Run again starts a new run in this same tab, with the page\'s mode', () => {
    answerMessages({
      aiProposalReady: { success: true, pending: false },
      aiRestartRun: { success: true },
    });
    loadAiProposal('?respectGroups=false');
    document.getElementById('userInstructions').value = 'by topic';
    clickOrganize();
    answerMessages({
      aiProposalReady: { success: true, pending: true },
      aiRestartRun: { success: true },
    });
    buttonNamed('Run again').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'aiRestartRun', respectGroups: false },
      expect.any(Function)
    );
    // The new run is started here, with the same instructions.
    const readies = sent('aiProposalReady');
    expect(readies).toHaveLength(2);
    expect(readies[1].instructions).toBe('by topic');
    expect(window.close).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(document.getElementById('content').textContent).toContain('Starting...');
  });

  test('Run again that cannot start says why and keeps the tab', () => {
    answerMessages({
      aiProposalReady: { success: true, pending: false },
      aiRestartRun: { success: false, error: 'storage is unavailable' },
    });
    loadAiProposal();
    clickOrganize();
    buttonNamed('Run again').click();

    expect(window.close).not.toHaveBeenCalled();
    expect(document.querySelector('#content [role="alert"]').textContent)
      .toBe("Couldn't start a new run: storage is unavailable");
  });

  test('the error view is announced and offers Retry and Settings', () => {
    answerMessages({ aiRestartRun: { success: true }, aiProposalReady: { success: true, pending: true } });
    const page = loadAiProposal('?respectGroups=false');
    page.handleMessage({ type: 'ai-error', error: 'Invalid API key' });

    const alert = document.querySelector('#content [role="alert"]');
    expect(alert.textContent).toBe('Invalid API key');
    expect(document.getElementById('actionsContainer').style.display).toBe('none');

    buttonNamed('Open Settings').click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    buttonNamed('Retry').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'aiRestartRun', respectGroups: false },
      expect.any(Function)
    );
    expect(sent('aiProposalReady')).toHaveLength(1);
    expect(window.close).not.toHaveBeenCalled();
  });

  test('Organize does not reveal the raw-output toggle before any output', () => {
    answerMessages({ aiProposalReady: { success: true, pending: true } });
    loadAiProposal();
    clickOrganize();

    expect(document.getElementById('debugToggle').hidden).toBe(true);
    expect(document.getElementById('debugSection').classList.contains('visible')).toBe(false);
  });

  describe('model picker', () => {
    test('shows the saved default at the top, filled from the catalog', async () => {
      answerMessages({ loadAiConfig: configReply({ ...KEYED, model: 'm2' }) });
      loadAiProposal();
      await flushPromises();

      expect(document.getElementById('modelName').textContent).toBe('Model Two');
      expect(document.getElementById('defaultTag').hidden).toBe(false);
      expect(document.getElementById('makeDefault').hidden).toBe(true);
      expect(document.getElementById('runSelect').value).toBe('m2');
      expect(document.getElementById('runFilter')).not.toBeNull();
      expect(document.getElementById('runCustom')).not.toBeNull();
    });

    test('Change opens the picker', async () => {
      answerMessages({ loadAiConfig: configReply(KEYED) });
      loadAiProposal();
      await flushPromises();
      const change = document.getElementById('changeModel');

      expect(document.getElementById('modelPanel').hidden).toBe(true);
      change.click();
      expect(document.getElementById('modelPanel').hidden).toBe(false);
      expect(change.getAttribute('aria-expanded')).toBe('true');
    });

    test('the picked model goes with this run and does not change the default', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        aiProposalReady: { success: true, pending: true },
      });
      loadAiProposal();
      await flushPromises();

      const select = document.getElementById('runSelect');
      select.value = 'm2';
      select.dispatchEvent(new window.Event('change'));
      expect(document.getElementById('modelName').textContent).toBe('Model Two');
      expect(document.getElementById('makeDefault').hidden).toBe(false);

      clickOrganize();

      expect(sent('aiProposalReady')[0]).toEqual({ action: 'aiProposalReady', instructions: '', model: 'm2' });
      expect(sent('saveAiDefaultModel')).toHaveLength(0);
      expect(sent('saveAiConfig')).toHaveLength(0);
    });

    test('a custom model id goes with the run, with the JSON-output warning', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        aiProposalReady: { success: true, pending: true },
      });
      loadAiProposal();
      await flushPromises();

      const custom = document.getElementById('runCustom');
      custom.value = 'acme/model';
      custom.dispatchEvent(new window.Event('input'));
      expect(document.querySelector('#modelPanel .model-schema-hint').textContent)
        .toMatch(/may not support JSON output/);
      clickOrganize();

      expect(sent('aiProposalReady')[0].model).toBe('acme/model');
    });

    test('Make default saves the picked model as the default', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        saveAiDefaultModel: (m) => ({ success: true, config: { ...KEYED, model: m.model } }),
      });
      loadAiProposal();
      await flushPromises();

      const select = document.getElementById('runSelect');
      select.value = 'm2';
      select.dispatchEvent(new window.Event('change'));
      document.getElementById('makeDefault').click();
      await flushPromises();

      expect(sent('saveAiDefaultModel')).toEqual([{ action: 'saveAiDefaultModel', model: 'm2' }]);
      expect(document.getElementById('makeDefault').hidden).toBe(true);
      expect(document.getElementById('defaultTag').hidden).toBe(false);
      expect(document.getElementById('modelNote').textContent).toBe('Model Two is now your default model.');
    });

    test('a failed Make default says why', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        saveAiDefaultModel: { success: false, error: 'quota exceeded' },
      });
      loadAiProposal();
      await flushPromises();
      const select = document.getElementById('runSelect');
      select.value = 'm2';
      select.dispatchEvent(new window.Event('change'));
      document.getElementById('makeDefault').click();
      await flushPromises();

      expect(document.getElementById('modelNote').textContent)
        .toBe("Couldn't save the default model: quota exceeded");
      expect(document.getElementById('makeDefault').hidden).toBe(false);
    });

    test('a model picked mid-run is not promised a Run again button that is not there yet', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        aiProposalReady: { success: true, pending: true },
      });
      const page = loadAiProposal();
      await flushPromises();

      clickOrganize();
      page.handleMessage({ type: 'ai-debug', model: 'm1', messages: [] });
      const select = document.getElementById('runSelect');
      select.value = 'm2';
      select.dispatchEvent(new window.Event('change'));
      expect(document.getElementById('runAgainButton').hidden).toBe(true);
      expect(document.getElementById('modelNote').textContent)
        .toBe('This run uses Model One. Model Two applies when you run again after it finishes.');

      page.handleMessage(proposalMessage);
      expect(document.getElementById('runAgainButton').hidden).toBe(false);
      expect(document.getElementById('modelNote').textContent)
        .toBe('This run used Model One. Run again to use Model Two.');
    });

    test('after a proposal, Run again in the bar re-runs here with the newly picked model', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        aiProposalReady: { success: true, pending: true },
        aiRestartRun: { success: true },
      });
      const page = loadAiProposal();
      await flushPromises();
      const runAgainButton = document.getElementById('runAgainButton');
      expect(runAgainButton.hidden).toBe(true);

      clickOrganize();
      page.handleMessage({ type: 'ai-debug', model: 'm1', messages: [] });
      page.handleMessage(proposalMessage);
      expect(runAgainButton.hidden).toBe(false);

      const select = document.getElementById('runSelect');
      select.value = 'm2';
      select.dispatchEvent(new window.Event('change'));
      expect(document.getElementById('modelNote').textContent)
        .toBe('This run used Model One. Run again to use Model Two.');

      runAgainButton.click();

      const readies = sent('aiProposalReady');
      expect(readies.map((m) => m.model)).toEqual(['m1', 'm2']);
      expect(sent('aiRestartRun')).toHaveLength(1);
      expect(runAgainButton.hidden).toBe(true);
      expect(document.getElementById('actionsContainer').style.display).toBe('none');
      expect(sent('saveAiDefaultModel')).toHaveLength(0);
    });
  });

  describe('no key, or an expired one', () => {
    test('shows the inline key form, with a link to Settings', async () => {
      answerMessages({ loadAiConfig: configReply(null) });
      loadAiProposal('?respectGroups=true&key=missing');

      const section = document.getElementById('keySetup');
      expect(section.hidden).toBe(false);
      expect(document.getElementById('inlineKeyInput').type).toBe('password');
      expect(document.querySelector('#keySetup .key-toggle')).not.toBeNull();
      expect(document.getElementById('startOrganize').textContent).toBe('Save key and organize');

      document.getElementById('openSettingsLink').click();
      expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

      await flushPromises();
      expect(document.getElementById('inlineExpiry').options.length).toBe(2);
    });

    test('Organize waits for the expiry choices before a key can be saved', async () => {
      let answer;
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.action === 'loadAiConfig') answer = cb;
      });
      loadAiProposal('?key=missing');

      expect(document.getElementById('startOrganize').disabled).toBe(true);
      answer(configReply(null));
      await flushPromises();
      expect(document.getElementById('startOrganize').disabled).toBe(false);
    });

    test('an accepted key is saved and the run starts in this tab', async () => {
      answerMessages({
        loadAiConfig: configReply(null),
        saveAiConfig: (m) => ({ success: true, config: { key: btoa(m.config.key), model: 'm1', expiresAt: null, expiryDuration: null } }),
        aiProposalReady: { success: true, pending: true },
      });
      loadAiProposal('?respectGroups=true&key=missing');
      await flushPromises();

      document.getElementById('inlineKeyInput').value = 'sk-or-v1-new';
      document.getElementById('inlineExpiry').value = 'null';
      document.getElementById('userInstructions').value = 'by project';
      clickOrganize();
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.anything());
      // The key and its expiry are saved; the default model is left alone.
      expect(sent('saveAiConfig')).toEqual([
        { action: 'saveAiConfig', config: { key: 'sk-or-v1-new', expiryDuration: null } },
      ]);
      expect(sent('aiProposalReady')).toEqual([
        { action: 'aiProposalReady', instructions: 'by project', model: 'm1' },
      ]);
      expect(sent('aiGroupTabs')).toHaveLength(0);
      expect(window.close).not.toHaveBeenCalled();
      expect(document.getElementById('content').textContent).toContain('Starting...');
    });

    test('a key OpenRouter rejects is not saved and no run starts', async () => {
      answerMessages({ loadAiConfig: configReply(null), saveAiConfig: { success: true } });
      loadAiProposal('?key=missing');
      await flushPromises();
      global.fetch.mockResolvedValue({ ok: false, status: 401 });

      document.getElementById('inlineKeyInput').value = 'sk-or-v1-revoked';
      clickOrganize();
      await flushPromises();

      expect(document.getElementById('keyError').textContent).toBe('OpenRouter rejected this key.');
      expect(document.getElementById('keyError').hidden).toBe(false);
      expect(sent('saveAiConfig')).toHaveLength(0);
      expect(sent('aiProposalReady')).toHaveLength(0);
      expect(document.getElementById('startOrganize').disabled).toBe(false);
    });

    test('a key that is not an OpenRouter key is refused before any network call', async () => {
      answerMessages({ loadAiConfig: configReply(null) });
      loadAiProposal('?key=missing');
      await flushPromises();

      document.getElementById('inlineKeyInput').value = 'sk-proj-openai';
      clickOrganize();
      await flushPromises();

      expect(document.getElementById('keyError').textContent).toMatch(/start with "sk-or-"/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('a failed save shows the reason and no run starts', async () => {
      answerMessages({ loadAiConfig: configReply(null), saveAiConfig: { success: false, error: 'quota exceeded' } });
      loadAiProposal('?key=missing');
      await flushPromises();

      document.getElementById('inlineKeyInput').value = 'sk-or-v1-abc';
      clickOrganize();
      await flushPromises();

      expect(document.getElementById('keyError').textContent).toBe('quota exceeded');
      expect(sent('aiProposalReady')).toHaveLength(0);
    });

    test('an expired key says so', async () => {
      answerMessages({ loadAiConfig: configReply({ ...KEYED, expiresAt: Date.now() - 1000 }) });
      loadAiProposal('?key=expired');
      await flushPromises();

      expect(document.getElementById('keySetup').hidden).toBe(false);
      expect(document.getElementById('keyIntro').textContent).toMatch(/expired/);
    });

    test('with a usable key on file the key form stays hidden', async () => {
      answerMessages({ loadAiConfig: configReply(KEYED) });
      loadAiProposal();
      await flushPromises();

      expect(document.getElementById('keySetup').hidden).toBe(true);
      expect(document.getElementById('startOrganize').textContent).toBe('Organize');
    });

    test('a run that finds no key brings the key form back on Retry', async () => {
      answerMessages({
        loadAiConfig: configReply(KEYED),
        aiProposalReady: { success: true, pending: true },
        aiRestartRun: { success: true },
      });
      const page = loadAiProposal();
      await flushPromises();
      clickOrganize();
      page.handleMessage({ type: 'ai-error', needsKey: 'missing', error: 'Huddle has no OpenRouter key yet. Add one to organize.' });

      buttonNamed('Retry').click();

      expect(document.getElementById('keySetup').hidden).toBe(false);
      expect(sent('aiProposalReady')).toHaveLength(1);
    });
  });
});
