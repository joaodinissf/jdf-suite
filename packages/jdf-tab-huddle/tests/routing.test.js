import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  popupSender, popupTabSender, napSender, optionsSender, dialogSender, organizeSender, contentSender,
} from './senders.js';

// Every action the worker's chrome.runtime.onMessage listener handles, sent
// through that listener (dispatch, in tests/setup.js) from the page that
// really sends it. Each row checks that the action is routed (no
// unknown-action, no forbidden), that the reply has the action's shape, and
// that the handler did its work: the chrome call it makes was made.
//
// A new worker action needs a row here: the last tests compare this table
// with the dispatcher's action names and with the actions each page's
// scripts send, both read from the source. The dispatcher is an if/else
// chain on message.action. Its first branch is the sender check (only
// Huddle's own pages may send anything but clumpOpenUrls), and its second
// the popup's logging message, which is keyed on message.type; that row has
// `type`, not `action`. Every row but clumpOpenUrls is also sent from the
// content script, and must be refused.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(__dirname, '../src', file), 'utf8');

const HAIKU = 'anthropic/claude-haiku-4.5';

// ---- a small fake browser ---------------------------------------------------
// Window 1 (focused): a.test, b.test (grouped, group 7), a duplicate of
// a.test, and split-view pair 8. Window 2: c.test.

let windows;
let store;
let nextId;

const allTabs = () => windows.flatMap((w) => w.tabs);

function tab(id, windowId, index, url, extra = {}) {
  return { id, windowId, index, url, title: url, pinned: false, active: false, highlighted: false, groupId: -1, incognito: false, ...extra };
}

function matches(t, q = {}) {
  if (q.windowId !== undefined && t.windowId !== q.windowId) return false;
  if (q.currentWindow && t.windowId !== 1) return false;
  if (q.active !== undefined && t.active !== q.active) return false;
  if (q.highlighted !== undefined && t.highlighted !== q.highlighted) return false;
  if (q.groupId !== undefined && t.groupId !== q.groupId) return false;
  if (q.url !== undefined && !t.url.startsWith(String(q.url).replace(/\*$/, ''))) return false;
  return true;
}

function installFakeBrowser() {
  windows = [
    {
      id: 1, focused: true, type: 'normal', incognito: false,
      tabs: [
        tab(11, 1, 0, 'https://a.test/1', { active: true, highlighted: true }),
        tab(12, 1, 1, 'https://b.test/1', { groupId: 7 }),
        tab(13, 1, 2, 'https://a.test/1'),
        tab(14, 1, 3, 'https://d.test/1', { splitViewId: 8 }),
        tab(15, 1, 4, 'https://e.test/1', { splitViewId: 8 }),
      ],
    },
    { id: 2, focused: false, type: 'normal', incognito: false, tabs: [tab(21, 2, 0, 'https://c.test/1')] },
  ];
  store = {};
  nextId = 900;

  chrome.tabs.query.mockImplementation(async (q) => allTabs().filter((t) => matches(t, q)).map((t) => ({ ...t })));
  chrome.tabs.get.mockImplementation(async (id) => {
    const t = allTabs().find((x) => x.id === id);
    if (!t) throw new Error(`No tab with id: ${id}.`);
    return { ...t };
  });
  chrome.tabs.create.mockImplementation(async (props) => ({ id: nextId++, windowId: props.windowId ?? 1, index: 0, url: props.url }));
  chrome.tabs.remove.mockResolvedValue(undefined);
  chrome.tabs.move.mockResolvedValue(undefined);
  chrome.tabs.update.mockResolvedValue(undefined);
  chrome.tabs.group.mockResolvedValue(77);
  chrome.tabs.ungroup.mockResolvedValue(undefined);
  chrome.tabs.sendMessage.mockResolvedValue(undefined);
  chrome.tabGroups.query.mockImplementation(async (q = {}) =>
    [{ id: 7, windowId: 1, title: 'Seven', color: 'blue', collapsed: false }].filter((g) => q.windowId === undefined || g.windowId === q.windowId));
  chrome.tabGroups.get.mockResolvedValue({ id: 7, windowId: 1, title: 'Seven', color: 'blue' });
  chrome.tabGroups.update.mockResolvedValue(undefined);
  chrome.windows.getAll.mockImplementation(async (opts = {}) =>
    windows.map((w) => (opts.populate ? { ...w, tabs: w.tabs.map((t) => ({ ...t })) } : { ...w, tabs: undefined })));
  chrome.windows.getCurrent.mockResolvedValue({ id: 1, focused: true, type: 'normal' });
  chrome.windows.getLastFocused.mockResolvedValue({ id: 1, focused: true, type: 'normal' });
  chrome.windows.create.mockImplementation(async () => ({ id: 9, tabs: [{ id: nextId++, windowId: 9, index: 0 }] }));
  chrome.windows.update.mockResolvedValue(undefined);
  chrome.windows.remove.mockResolvedValue(undefined);
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  });
  chrome.storage.local.set.mockImplementation(async (items) => { Object.assign(store, structuredClone(items)); });
  chrome.storage.local.remove.mockImplementation(async (keys) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
  });
  chrome.notifications.create.mockResolvedValue('n');
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{
        id: HAIKU,
        name: 'Anthropic: Claude Haiku 4.5',
        pricing: { prompt: '0.000001', completion: '0.000005' },
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['max_tokens', 'response_format', 'structured_outputs'],
      }],
    }),
  });
}

const sleeping = (id, url = 'https://sleep.test/1') => ({
  id, type: 'tab', summary: url, wakeAt: Date.now() + 3600000, preset: 'tomorrow', createdAt: Date.now(),
  tabs: [{ url, title: url, pinned: false, index: 0 }],
});

// ---- the table --------------------------------------------------------------
// page: the extension page (or content script) whose scripts send the action.
// senders: the senders it arrives with. message: what that page sends.
// setup(): state the row needs. reply: the reply's shape (toMatchObject).
// effect(): the chrome call the handler makes.

const POPUP = [popupSender, popupTabSender];
const later = Date.now() + 3600000;

const ROUTES = [
  {
    type: 'log', page: 'popup.html', senders: POPUP,
    message: { type: 'log', data: { message: 'hello', args: [1] } },
    reply: { success: true },
    effect: () => expect(console.log).toHaveBeenCalledWith('[Huddle]', 'hello', 1),
  },
  {
    action: 'clumpOpenUrls', page: 'content-clumper.js', senders: [contentSender],
    message: { action: 'clumpOpenUrls', urls: ['https://site.example/one'] },
    reply: { success: true, opened: 1 },
    effect: () => expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://site.example/one', active: false, index: 3, windowId: 1, openerTabId: 506,
    }),
  },
  {
    action: 'sortAllWindows', page: 'popup.html', senders: POPUP,
    message: { action: 'sortAllWindows', respectGroups: false },
    reply: { success: true, tabs: 6, windows: 2 },
    effect: () => expect(chrome.windows.getAll).toHaveBeenCalledWith({ populate: true }),
  },
  {
    action: 'sortCurrentWindow', page: 'popup.html', senders: POPUP,
    message: { action: 'sortCurrentWindow', respectGroups: false },
    reply: { success: true, tabs: 5 },
    effect: () => expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 1 }),
  },
  {
    action: 'removeDuplicatesWindow', page: 'popup.html', senders: POPUP,
    message: { action: 'removeDuplicatesWindow', respectGroups: false },
    reply: { success: true, removed: 1 },
    effect: () => expect(chrome.tabs.remove).toHaveBeenCalledWith([13]),
  },
  {
    action: 'removeDuplicatesAllWindows', page: 'popup.html', senders: POPUP,
    message: { action: 'removeDuplicatesAllWindows', respectGroups: false },
    reply: { success: true, removed: 1 },
    effect: () => expect(chrome.tabs.remove).toHaveBeenCalledWith([13]),
  },
  {
    action: 'removeDuplicatesGlobally', page: 'popup.html', senders: POPUP,
    setup: () => { windows[1].tabs.push(tab(22, 2, 1, 'https://b.test/1')); },
    message: { action: 'removeDuplicatesGlobally', respectGroups: false },
    reply: { success: true, removed: 2 },
    effect: () => expect(chrome.tabs.remove).toHaveBeenCalledWith(expect.arrayContaining([13, 22])),
  },
  {
    action: 'extractDomain', page: 'popup.html', senders: POPUP,
    message: { action: 'extractDomain', tabId: 11, url: 'https://a.test/1', respectGroups: false },
    reply: { success: true, domain: 'a.test', moved: 2 },
    effect: () => {
      expect(chrome.windows.create).toHaveBeenCalledWith({ tabId: 11, focused: true });
      expect(chrome.tabs.move).toHaveBeenCalledWith([13], { windowId: 9, index: -1 });
    },
  },
  {
    action: 'extractAllDomains', page: 'popup.html', senders: POPUP,
    message: { action: 'extractAllDomains', respectGroups: false },
    reply: { success: true, windows: expect.any(Number) },
    effect: () => expect(chrome.windows.create).toHaveBeenCalled(),
  },
  {
    action: 'extractAllDomainsConfirmation', page: 'confirmation-dialog.html', senders: [dialogSender],
    message: { action: 'extractAllDomainsConfirmation', confirmed: false },
    reply: { success: true, cancelled: true },
    effect: () => {
      expect(chrome.storage.session.get).toHaveBeenCalledWith('splitConfirm:504');
      expect(chrome.tabs.remove).toHaveBeenCalledWith(504);
    },
  },
  {
    action: 'moveAllToSingleWindow', page: 'popup.html', senders: POPUP,
    message: { action: 'moveAllToSingleWindow', activeTabId: 11, respectGroups: false },
    reply: { success: true, moved: 1 },
    effect: () => expect(chrome.tabs.move).toHaveBeenCalledWith([21], { windowId: 1, index: -1 }),
  },
  {
    action: 'copyTabs', page: 'popup.html', senders: POPUP,
    message: { action: 'copyTabs', respectGroups: false, scope: 'window' },
    reply: { success: true, tabCount: 5, text: expect.stringContaining('https://b.test/1') },
    effect: () => expect(chrome.windows.getLastFocused).toHaveBeenCalledWith({ windowTypes: ['normal'] }),
  },
  {
    // No scope copies this window only, never every window's tabs.
    action: 'copyTabs', page: 'popup.html', senders: [popupSender],
    message: { action: 'copyTabs', respectGroups: false },
    reply: { success: true, tabCount: 5 },
    effect: () => expect(chrome.windows.getAll).not.toHaveBeenCalled(),
  },
  {
    action: 'flattenWindow', page: 'popup.html', senders: POPUP,
    message: { action: 'flattenWindow' },
    reply: { success: true, ungrouped: 1 },
    effect: () => expect(chrome.tabs.ungroup).toHaveBeenCalledWith([12]),
  },
  {
    action: 'compactWindow', page: 'popup.html', senders: POPUP,
    split: true,
    // Neighbours pair only within one group; take b.test out of group 7.
    setup: () => { windows[0].tabs[1].groupId = -1; },
    message: { action: 'compactWindow' },
    reply: { success: true, paired: 1, failed: 0 },
    effect: () => expect(chrome.tabs.createSplit).toHaveBeenCalledWith([11, 12]),
  },
  {
    action: 'expandWindow', page: 'popup.html', senders: POPUP,
    split: true,
    message: { action: 'expandWindow' },
    reply: { success: true, unsplit: 1, failed: 0 },
    effect: () => expect(chrome.tabs.unsplit).toHaveBeenCalledWith(8),
  },
  {
    action: 'aiGroupTabs', page: 'popup.html', senders: POPUP,
    message: { action: 'aiGroupTabs', respectGroups: true },
    reply: { success: true, action: 'opened' },
    effect: () => expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/ai-proposal.html?respectGroups=true', active: true, windowId: 1,
    }),
  },
  {
    action: 'applyAiProposal', page: 'ai-proposal.html', senders: [organizeSender],
    setup: () => { windows[0].tabs.push(tab(505, 1, 5, 'chrome-extension://test-id/ai-proposal.html?respectGroups=true')); },
    message: {
      action: 'applyAiProposal', groups: [{ name: 'Sites', color: 'green', tabIds: [11, 13] }],
      ungroupedTabIds: [], respectGroups: true, windowId: 1, leftOut: 0,
    },
    reply: { success: true, grouped: 2, groups: 1, skipped: 0, closing: true },
    effect: () => {
      expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [11, 13], createProperties: { windowId: 1 } });
      expect(chrome.tabs.remove).toHaveBeenCalledWith(505);
    },
  },
  {
    action: 'cancelAiProposal', page: 'ai-proposal.html', senders: [organizeSender],
    message: { action: 'cancelAiProposal' },
    reply: { success: true },
    effect: () => expect(chrome.tabs.remove).toHaveBeenCalledWith(505),
  },
  ...[optionsSender, organizeSender].map((sender) => ({
    action: 'saveAiConfig', page: sender === optionsSender ? 'options.html' : 'ai-proposal.html', senders: [sender],
    message: { action: 'saveAiConfig', config: { key: 'sk-or-test', expiryDuration: 86400000, renew: true, model: HAIKU } },
    reply: { success: true, config: { key: btoa('sk-or-test'), model: HAIKU, expiryDuration: 86400000 } },
    effect: () => expect(chrome.storage.local.set).toHaveBeenCalledWith({ aiConfig: expect.objectContaining({ key: btoa('sk-or-test') }) }),
  })),
  ...[optionsSender, organizeSender].map((sender) => ({
    action: 'loadAiConfig', page: sender === optionsSender ? 'options.html' : 'ai-proposal.html', senders: [sender],
    setup: () => { store.aiConfig = { key: btoa('sk-or-test'), model: HAIKU, expiresAt: null, expiryDuration: null }; },
    message: { action: 'loadAiConfig' },
    reply: { protocol: AI_PROTOCOL, config: { model: HAIKU }, expiryPresets: expect.any(Array), defaultModel: DEFAULT_MODEL },
    effect: () => expect(chrome.storage.local.get).toHaveBeenCalledWith(['aiConfig']),
  })),
  ...['loadOpenRouterModels', 'refreshOpenRouterModels'].flatMap((action) => [optionsSender, organizeSender].map((sender) => ({
    action, page: sender === optionsSender ? 'options.html' : 'ai-proposal.html', senders: [sender],
    message: { action },
    reply: { success: true, models: expect.arrayContaining([expect.objectContaining({ id: HAIKU })]), modelsMeta: { fallback: false } },
    effect: () => expect(global.fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.objectContaining({ method: 'GET' })),
  }))),
  ...[optionsSender, organizeSender].map((sender) => ({
    action: 'saveAiDefaultModel', page: sender === optionsSender ? 'options.html' : 'ai-proposal.html', senders: [sender],
    message: { action: 'saveAiDefaultModel', model: HAIKU },
    reply: { success: true, config: { model: HAIKU, key: null } },
    effect: () => expect(chrome.storage.local.set).toHaveBeenCalledWith({ aiConfig: expect.objectContaining({ model: HAIKU }) }),
  })),
  {
    action: 'deleteAiKey', page: 'options.html', senders: [optionsSender],
    setup: () => { store.aiConfig = { key: btoa('sk-or-test'), model: HAIKU, expiresAt: null, expiryDuration: null }; },
    message: { action: 'deleteAiKey' },
    reply: { success: true, config: { key: null, model: HAIKU } },
    effect: () => expect(chrome.storage.local.set).toHaveBeenCalledWith({ aiConfig: expect.objectContaining({ key: null, model: HAIKU }) }),
  },
  {
    action: 'getSnoozePresets', page: 'popup.html', senders: POPUP,
    message: { action: 'getSnoozePresets' },
    reply: { success: true, presets: expect.arrayContaining([expect.objectContaining({ key: 'tomorrow', wakeAt: expect.any(Number) })]) },
    // Pure: the presets are computed, no chrome call. The reply is the effect.
    effect: () => expect(chrome.tabs.query).not.toHaveBeenCalled(),
  },
  {
    action: 'snoozeTab', page: 'popup.html', senders: POPUP,
    message: { action: 'snoozeTab', wakeAt: later, preset: 'tomorrow' },
    reply: { success: true, record: { type: 'tab', wakeAt: later } },
    effect: () => {
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(chrome.tabs.remove).toHaveBeenCalledWith([11]);
    },
  },
  {
    action: 'snoozeSelected', page: 'popup.html', senders: POPUP,
    setup: () => { windows[0].tabs[2].highlighted = true; },
    message: { action: 'snoozeSelected', wakeAt: later, preset: 'tomorrow' },
    reply: { success: true, record: { type: 'tabs' } },
    effect: () => {
      expect(chrome.tabs.query).toHaveBeenCalledWith({ highlighted: true, currentWindow: true });
      expect(chrome.tabs.remove).toHaveBeenCalledWith([11, 13]);
    },
  },
  {
    action: 'snoozeWindow', page: 'popup.html', senders: POPUP,
    message: { action: 'snoozeWindow', wakeAt: later, preset: 'tomorrow' },
    reply: { success: true, record: { type: 'window', windowId: 1 } },
    effect: () => expect(chrome.tabs.remove).toHaveBeenCalledWith([11, 12, 13, 14, 15]),
  },
  {
    action: 'snoozeGroup', page: 'popup.html', senders: POPUP,
    setup: () => {
      windows[0].tabs[0].active = false;
      windows[0].tabs[1].active = true;
    },
    message: { action: 'snoozeGroup', wakeAt: later, preset: 'tomorrow' },
    reply: { success: true, record: { type: 'group', group: { title: 'Seven', color: 'blue' } } },
    effect: () => expect(chrome.tabs.query).toHaveBeenCalledWith({ groupId: 7, currentWindow: true }),
  },
  ...[popupSender, popupTabSender, napSender].flatMap((sender) => [
    {
      action: 'listSnoozed', page: sender === napSender ? 'nap-room.html' : 'popup.html', senders: [sender],
      message: { action: 'listSnoozed' },
      reply: { success: true, items: [] },
      effect: () => expect(chrome.storage.local.get).toHaveBeenCalledWith(['snoozedItems']),
    },
    {
      action: 'wakeSnoozed', page: sender === napSender ? 'nap-room.html' : 'popup.html', senders: [sender],
      setup: () => { store.snoozedItems = [sleeping('s1')]; },
      message: { action: 'wakeSnoozed', id: 's1' },
      reply: { success: true, createdCount: 1, failedCount: 0 },
      effect: () => expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://sleep.test/1', windowId: 1 })),
    },
    {
      action: 'cancelSnoozed', page: sender === napSender ? 'nap-room.html' : 'popup.html', senders: [sender],
      setup: () => { store.snoozedItems = [sleeping('s1')]; },
      message: { action: 'cancelSnoozed', id: 's1' },
      reply: { success: true, record: { id: 's1' } },
      effect: () => expect(chrome.alarms.clear).toHaveBeenCalledWith('snooze:s1'),
    },
    {
      action: 'restoreSnoozed', page: sender === napSender ? 'nap-room.html' : 'popup.html', senders: [sender],
      message: { action: 'restoreSnoozed', record: sleeping('s2') },
      reply: { success: true },
      effect: () => expect(chrome.alarms.create).toHaveBeenCalledWith('snooze:s2', { when: expect.any(Number) }),
    },
  ]),
];

const senderName = (s) => ({
  [popupSender.url + '|']: 'popup', [popupTabSender.url + '|tab']: 'popup in a tab',
}[`${s.url}|${s.tab ? 'tab' : ''}`] || s.url.replace(/^chrome-extension:\/\/test-id\//, ''));

// What a row routes: its action, or `type:log` for the logging message.
const keyOf = (r) => (r.action ? r.action : `type:${r.type}`);

const rows = ROUTES.flatMap((r) => r.senders.map((sender) => ({ ...r, sender, name: `${keyOf(r)} from ${senderName(sender)}` })));

// ---- the dispatcher's actions and the pages' callers, from the source ------

// The dispatcher is one if/else chain (`if (…) {`, then `} else if (…) {`,
// at the listener's own indentation, maybe with a trailing // comment);
// nested ifs inside a branch are deeper.
// Each branch's condition is read from the source and sorted into: the
// sender check, the logging message (message.type), actions (one or more
// message.action comparisons joined by ||), the final catch-all, or not
// understood.
function dispatcherBranches() {
  const bg = read('background.js');
  const start = bg.indexOf('chrome.runtime.onMessage.addListener(');
  if (start === -1) throw new Error('background.js registers no chrome.runtime.onMessage listener');
  const end = bg.indexOf('\n});', start);
  const block = bg.slice(start, end);
  return [...block.matchAll(/^ {2}(?:\} else )?if \((.*?)\) \{\s*(?:\/\/.*)?$/gm)].map(([, cond]) => {
    if (cond === "!fromExtensionPage(sender) && message.action !== 'clumpOpenUrls'") return { kind: 'sender check', names: [], cond };
    const type = cond.match(/^message\.type === '(\w+)'$/);
    if (type) return { kind: 'type', names: [type[1]], cond };
    const parts = cond.split(' || ').map((c) => c.match(/^message\.action === '(\w+)'$/));
    if (parts.every(Boolean)) return { kind: 'action', names: parts.map((m) => m[1]), cond };
    if (cond === "message && typeof message.action === 'string'") return { kind: 'unknown-action', names: [], cond };
    return { kind: 'not understood', names: [], cond };
  });
}

// The actions the dispatcher compares message.action with.
const dispatcherActions = () => dispatcherBranches().filter((b) => b.kind === 'action').flatMap((b) => b.names);
// The messages it tells apart by message.type (the logging message).
const dispatcherTypes = () => dispatcherBranches().filter((b) => b.kind === 'type').flatMap((b) => b.names);

// Each page's scripts, from its <script src> tags; the content script from
// the manifest.
function pageScripts() {
  const pages = {};
  for (const page of ['popup.html', 'nap-room.html', 'options.html', 'ai-proposal.html', 'confirmation-dialog.html']) {
    pages[page] = [...read(page).matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  }
  for (const cs of JSON.parse(read('manifest.json')).content_scripts) {
    for (const js of cs.js) pages[js] = [js];
  }
  return pages;
}

// page -> the dispatcher actions its scripts name as a string literal, and
// `type:<name>` for each message.type it sends (`type: '<name>'`).
function actionsSentByPage() {
  const actions = dispatcherActions();
  const types = dispatcherTypes();
  const out = {};
  for (const [page, scripts] of Object.entries(pageScripts())) {
    const source = scripts.map(read).join('\n');
    out[page] = [
      ...actions.filter((a) => source.includes(`'${a}'`)),
      ...types.filter((t) => new RegExp(`\\btype: '${t}'`).test(source)).map((t) => `type:${t}`),
    ].sort();
  }
  return out;
}

// ---- the tests ----------------------------------------------------------------

describe('every worker action, routed from its real caller', () => {
  beforeEach(() => {
    installFakeBrowser();
  });

  afterEach(() => {
    delete chrome.tabs.createSplit;
    delete chrome.tabs.unsplit;
  });

  test.each(rows)('$name', async (row) => {
    if (row.split) {
      chrome.tabs.createSplit = vi.fn().mockResolvedValue(undefined);
      chrome.tabs.unsplit = vi.fn().mockResolvedValue(undefined);
    }
    if (row.setup) row.setup();
    const reply = await dispatch(structuredClone(row.message), structuredClone(row.sender));

    expect(reply).toBeTruthy();
    expect(reply.error).not.toBe('unknown-action');
    expect(reply.error).not.toBe('forbidden');
    expect(reply).toMatchObject(row.reply);
    row.effect();
  });

  test('an action the worker does not know gets unknown-action from a page, and forbidden from a content script', async () => {
    for (const sender of [popupSender, organizeSender]) {
      expect(await dispatch({ action: 'noSuchAction' }, sender)).toEqual({ success: false, error: 'unknown-action', protocol: AI_PROTOCOL });
    }
    expect(await dispatch({ action: 'noSuchAction' }, contentSender)).toEqual({ success: false, error: 'forbidden' });
  });
});

describe('the trust boundary', () => {
  beforeEach(() => {
    installFakeBrowser();
  });

  // Each row's message, sent from the link clumper's content script.
  const fromContentScript = ROUTES.filter((r) => r.action !== 'clumpOpenUrls')
    .map((r) => ({ ...r, name: `${keyOf(r)} from a content script` }));

  test.each(fromContentScript)('$name is forbidden, and nothing runs', async (row) => {
    if (row.setup) row.setup();
    const reply = await dispatch(structuredClone(row.message), structuredClone(contentSender));
    expect(reply).toEqual({ success: false, error: 'forbidden' });
    for (const call of [chrome.storage.local.get, chrome.storage.local.set, chrome.storage.session.get, chrome.tabs.query,
      chrome.tabs.create, chrome.tabs.remove, chrome.windows.getAll, chrome.windows.create, chrome.alarms.create, global.fetch]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  test('a sender from another extension is refused, even with a url like Huddle\'s', async () => {
    const other = { ...popupSender, id: 'other-extension' };
    expect(await dispatch({ action: 'loadAiConfig' }, other)).toEqual({ success: false, error: 'forbidden' });
  });

  test('no web page can load Huddle\'s pages, and Chrome is new enough to keep the key from content scripts', () => {
    const manifest = JSON.parse(read('manifest.json'));
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    // chrome.storage.local.setAccessLevel is proven on 147 (CI) and up.
    expect(manifest.minimum_chrome_version).toBe('147');
  });
});

// Which tabs each Deduplicate closes, in the fake browser plus: window 1 gains
// an ungrouped b.test (16), window 2 gains a.test (22) and b.test (23). In
// Groups mode a URL repeats only within one group (ungrouped counts as one);
// "this window" and "each window" never compare across windows (L82).
describe('which tabs Deduplicate closes', () => {
  beforeEach(() => {
    installFakeBrowser();
    windows[0].tabs.push(tab(16, 1, 5, 'https://b.test/1'));
    windows[1].tabs.push(tab(22, 2, 1, 'https://a.test/1'), tab(23, 2, 2, 'https://b.test/1'));
  });

  test.each([
    ['removeDuplicatesWindow', true, [13]],
    ['removeDuplicatesWindow', false, [13, 16]],
    ['removeDuplicatesAllWindows', true, [13]],
    ['removeDuplicatesAllWindows', false, [13, 16]],
    ['removeDuplicatesGlobally', true, [13, 22, 23]],
    ['removeDuplicatesGlobally', false, [13, 16, 22, 23]],
  ])('%s, respectGroups=%s, closes %j', async (action, respectGroups, closed) => {
    const reply = await dispatch({ action, respectGroups }, popupSender);
    expect(reply).toMatchObject({ success: true, removed: closed.length });
    expect(chrome.tabs.remove.mock.calls).toEqual([[closed]]);
  });

  // With "Allow in Incognito" on: a page open in a regular and an incognito
  // window is not a duplicate; repeats within incognito windows still are (L14).
  test.each([
    [true, [13, 22, 23, 32]],
    [false, [13, 16, 22, 23, 32]],
  ])('removeDuplicatesGlobally, respectGroups=%s, keeps regular and incognito tabs apart', async (respectGroups, closed) => {
    windows.push({
      id: 3, focused: false, type: 'normal', incognito: true,
      tabs: [31, 32].map((id, i) => tab(id, 3, i, 'https://a.test/1', { incognito: true })),
    });
    await dispatch({ action: 'removeDuplicatesGlobally', respectGroups }, popupSender);
    expect(chrome.tabs.remove.mock.calls).toEqual([[closed]]);
  });
});

describe('the routing table is complete', () => {
  test('the dispatcher is an if/else chain whose every branch is understood, starting with the sender check and ending in unknown-action', () => {
    const branches = dispatcherBranches();
    expect(branches.filter((b) => b.kind === 'not understood').map((b) => b.cond)).toEqual([]);
    expect(branches.length).toBeGreaterThan(30);
    expect(branches[0].kind).toBe('sender check');
    expect(branches.filter((b) => b.kind === 'sender check')).toHaveLength(1);
    expect(branches[1]).toMatchObject({ kind: 'type', names: ['log'] });
    expect(branches.at(-1).kind).toBe('unknown-action');
    expect(branches.filter((b) => b.kind === 'unknown-action')).toHaveLength(1);
  });

  test('it has a row for every action the dispatcher handles, and none it does not', () => {
    const table = [...new Set(ROUTES.filter((r) => r.action).map((r) => r.action))].sort();
    const dispatcher = dispatcherActions().sort();
    expect(new Set(dispatcher).size).toBe(dispatcher.length);
    expect(dispatcher.length).toBeGreaterThan(30);
    expect(table).toEqual(dispatcher);
  });

  test('the logging message, keyed on message.type, has its row too', () => {
    const table = [...new Set(ROUTES.filter((r) => !r.action).map((r) => r.type))].sort();
    expect(dispatcherTypes()).toEqual(['log']);
    expect(table).toEqual(dispatcherTypes());
    for (const r of ROUTES) expect(Boolean(r.action) !== Boolean(r.type)).toBe(true);
  });

  test('its callers are exactly the pages whose scripts send each action', () => {
    const fromSource = actionsSentByPage();
    const fromTable = {};
    for (const page of Object.keys(fromSource)) fromTable[page] = [];
    for (const r of ROUTES) {
      if (!(r.page in fromTable)) throw new Error(`row ${keyOf(r)}: unknown page ${r.page}`);
      if (!fromTable[r.page].includes(keyOf(r))) fromTable[r.page].push(keyOf(r));
    }
    for (const page of Object.keys(fromTable)) fromTable[page].sort();
    expect(fromTable).toEqual(fromSource);
  });

  test('each row is sent by senders of its page', () => {
    for (const r of ROUTES) {
      for (const sender of r.senders) {
        const where = sender === contentSender ? 'content-clumper.js' : new URL(sender.url).pathname.slice(1);
        expect(`${keyOf(r)}: ${where}`).toBe(`${keyOf(r)}: ${r.page}`);
      }
    }
  });
});
