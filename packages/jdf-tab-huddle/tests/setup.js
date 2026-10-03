import { vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const messageListeners = [];
const tabRemovedListeners = [];
const tabDetachedListeners = [];
const connectListeners = [];
const alarmListeners = [];
const installedListeners = [];
// chrome.storage.session keeps real values, so a test can drop the worker's
// in-memory state and check what survives. Emptied before each test.
const sessionStore = {};
const pickKeys = (keys) => {
  if (keys == null) return { ...sessionStore };
  const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  return Object.fromEntries(list.filter((k) => k in sessionStore).map((k) => [k, sessionStore[k]]));
};

global.chrome = {
  runtime: {
    id: 'test-id',
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn) => messageListeners.push(fn)),
      removeListener: vi.fn((fn) => {
        const i = messageListeners.indexOf(fn);
        if (i >= 0) messageListeners.splice(i, 1);
      }),
      hasListener: (fn) => messageListeners.includes(fn),
      hasListeners: () => messageListeners.length > 0,
      // Returns each listener's result: `true` is how an async action keeps
      // the channel open for its reply.
      callListeners: (...args) => messageListeners.map(fn => fn(...args)),
    },
    getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
    onConnect: {
      addListener: vi.fn((fn) => connectListeners.push(fn)),
      callListeners: (...args) => connectListeners.forEach(fn => fn(...args)),
    },
    connect: vi.fn(),
    reload: vi.fn(),
    openOptionsPage: vi.fn(),
    lastError: null,
    onStartup: {
      addListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn((fn) => installedListeners.push(fn)),
      // Returns each listener's result, so a test can await async ones.
      callListeners: (...args) => installedListeners.map(fn => fn(...args)),
    },
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
  },
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    move: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    sendMessage: vi.fn(),
    onRemoved: {
      addListener: vi.fn((fn) => tabRemovedListeners.push(fn)),
      callListeners: (...args) => tabRemovedListeners.forEach(fn => fn(...args)),
    },
    onDetached: {
      addListener: vi.fn((fn) => tabDetachedListeners.push(fn)),
      callListeners: (...args) => tabDetachedListeners.forEach(fn => fn(...args)),
    },
  },
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    query: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
  },
  windows: {
    get: vi.fn(),
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getCurrent: vi.fn(),
    getLastFocused: vi.fn(),
    remove: vi.fn(),
  },
  alarms: {
    create: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(true),
    clearAll: vi.fn().mockResolvedValue(true),
    getAll: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    onAlarm: {
      addListener: vi.fn((fn) => alarmListeners.push(fn)),
      // Fires an alarm at every listener the worker registered, as Chrome does.
      callListeners: (...args) => alarmListeners.forEach(fn => fn(...args)),
    },
  },
  notifications: {
    create: vi.fn(),
    clear: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    },
    session: {
      get: vi.fn(async (keys) => pickKeys(keys)),
      set: vi.fn(async (items) => { Object.assign(sessionStore, items); }),
      remove: vi.fn(async (keys) => {
        for (const k of typeof keys === 'string' ? [keys] : keys) delete sessionStore[k];
      }),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

global.console.log = vi.fn();

// Load and execute background script, exposing functions globally
const backgroundJs = readFileSync(resolve(__dirname, '../src/background.js'), 'utf8');
const listenersBeforeWorker = messageListeners.length;
const backgroundWrapper = `
(function() {
  ${backgroundJs}

  // Expose functions to global scope
  if (typeof lexHost !== 'undefined') global.lexHost = lexHost;
  if (typeof getTabGroupsInfo !== 'undefined') global.getTabGroupsInfo = getTabGroupsInfo;
  if (typeof getTabsWithGroupInfo !== 'undefined') global.getTabsWithGroupInfo = getTabsWithGroupInfo;
  if (typeof recreateTabGroup !== 'undefined') global.recreateTabGroup = recreateTabGroup;
  if (typeof moveTabsWithGroups !== 'undefined') global.moveTabsWithGroups = moveTabsWithGroups;
  if (typeof findDuplicateTabs !== 'undefined') global.findDuplicateTabs = findDuplicateTabs;
  if (typeof analyzeDomainDistribution !== 'undefined') global.analyzeDomainDistribution = analyzeDomainDistribution;
  if (typeof sortWindowTabs !== 'undefined') global.sortWindowTabs = sortWindowTabs;
  if (typeof sortTabsAsUnits !== 'undefined') global.sortTabsAsUnits = sortTabsAsUnits;
  if (typeof tabSplitViewId !== 'undefined') global.tabSplitViewId = tabSplitViewId;
  if (typeof splitWriteSupported !== 'undefined') global.splitWriteSupported = splitWriteSupported;
  if (typeof planCompactPairs !== 'undefined') global.planCompactPairs = planCompactPairs;
  if (typeof captureSplitPairs !== 'undefined') global.captureSplitPairs = captureSplitPairs;
  if (typeof restoreSplitPairs !== 'undefined') global.restoreSplitPairs = restoreSplitPairs;
  if (typeof handleCompactWindow !== 'undefined') global.handleCompactWindow = handleCompactWindow;
  if (typeof handleExpandWindow !== 'undefined') global.handleExpandWindow = handleExpandWindow;
  if (typeof handleSortAllWindows !== 'undefined') global.handleSortAllWindows = handleSortAllWindows;
  if (typeof handleSortCurrentWindow !== 'undefined') global.handleSortCurrentWindow = handleSortCurrentWindow;
  if (typeof handleRemoveDuplicatesWindow !== 'undefined') global.handleRemoveDuplicatesWindow = handleRemoveDuplicatesWindow;
  if (typeof handleRemoveDuplicatesAllWindows !== 'undefined') global.handleRemoveDuplicatesAllWindows = handleRemoveDuplicatesAllWindows;
  if (typeof handleRemoveDuplicatesGlobally !== 'undefined') global.handleRemoveDuplicatesGlobally = handleRemoveDuplicatesGlobally;
  if (typeof handleExtractDomain !== 'undefined') global.handleExtractDomain = handleExtractDomain;
  if (typeof handleExtractAllDomains !== 'undefined') global.handleExtractAllDomains = handleExtractAllDomains;
  if (typeof handleExtractAllDomainsConfirmation !== 'undefined') global.handleExtractAllDomainsConfirmation = handleExtractAllDomainsConfirmation;
  if (typeof handleMoveAllToSingleWindow !== 'undefined') global.handleMoveAllToSingleWindow = handleMoveAllToSingleWindow;
  if (typeof formatTabsAsText !== 'undefined') global.formatTabsAsText = formatTabsAsText;
  if (typeof handleCopyTabs !== 'undefined') global.handleCopyTabs = handleCopyTabs;
  if (typeof encodeKey !== 'undefined') global.encodeKey = encodeKey;
  if (typeof decodeKey !== 'undefined') global.decodeKey = decodeKey;
  if (typeof saveAiConfig !== 'undefined') global.saveAiConfig = saveAiConfig;
  if (typeof loadAiConfig !== 'undefined') global.loadAiConfig = loadAiConfig;
  if (typeof saveAiDefaultModel !== 'undefined') global.saveAiDefaultModel = saveAiDefaultModel;
  if (typeof deleteAiKey !== 'undefined') global.deleteAiKey = deleteAiKey;
  if (typeof isKeyExpired !== 'undefined') global.isKeyExpired = isKeyExpired;
  if (typeof buildAiPrompt !== 'undefined') global.buildAiPrompt = buildAiPrompt;
  if (typeof parseAiResponse !== 'undefined') global.parseAiResponse = parseAiResponse;
  if (typeof stripQueryParams !== 'undefined') global.stripQueryParams = stripQueryParams;
  if (typeof AI_MODELS !== 'undefined') global.AI_MODELS = AI_MODELS;
  if (typeof VALID_TAB_GROUP_COLORS !== 'undefined') global.VALID_TAB_GROUP_COLORS = VALID_TAB_GROUP_COLORS;
  if (typeof formatModelCost !== 'undefined') global.formatModelCost = formatModelCost;
  if (typeof normalizeOpenRouterModel !== 'undefined') global.normalizeOpenRouterModel = normalizeOpenRouterModel;
  if (typeof mergeModelsForPicker !== 'undefined') global.mergeModelsForPicker = mergeModelsForPicker;
  if (typeof curatedModelsAsPickerEntries !== 'undefined') global.curatedModelsAsPickerEntries = curatedModelsAsPickerEntries;
  if (typeof getOpenRouterModels !== 'undefined') global.getOpenRouterModels = getOpenRouterModels;
  if (typeof fetchOpenRouterModels !== 'undefined') global.fetchOpenRouterModels = fetchOpenRouterModels;
  if (typeof buildTabGroupsJsonSchema !== 'undefined') global.buildTabGroupsJsonSchema = buildTabGroupsJsonSchema;
  if (typeof buildOpenRouterRequestBody !== 'undefined') global.buildOpenRouterRequestBody = buildOpenRouterRequestBody;
  if (typeof MODELS_CACHE_KEY !== 'undefined') global.MODELS_CACHE_KEY = MODELS_CACHE_KEY;
  if (typeof MODELS_CACHE_TTL_MS !== 'undefined') global.MODELS_CACHE_TTL_MS = MODELS_CACHE_TTL_MS;
  if (typeof MODELS_CACHE_VERSION !== 'undefined') global.MODELS_CACHE_VERSION = MODELS_CACHE_VERSION;
  if (typeof AI_PROTOCOL !== 'undefined') global.AI_PROTOCOL = AI_PROTOCOL;
  if (typeof isBatchModel !== 'undefined') global.isBatchModel = isBatchModel;
  if (typeof splitModelName !== 'undefined') global.splitModelName = splitModelName;
  if (typeof canHuddleUseModel !== 'undefined') global.canHuddleUseModel = canHuddleUseModel;
  if (typeof modelInfo !== 'undefined') global.modelInfo = modelInfo;
  if (typeof resolveDefaultModel !== 'undefined') global.resolveDefaultModel = resolveDefaultModel;
  if (typeof resolveDefaultModelFromCache !== 'undefined') global.resolveDefaultModelFromCache = resolveDefaultModelFromCache;
  if (typeof describeRequestTried !== 'undefined') global.describeRequestTried = describeRequestTried;
  if (typeof DEFAULT_MODEL !== 'undefined') global.DEFAULT_MODEL = DEFAULT_MODEL;
  if (typeof mapOpenRouterHttpError !== 'undefined') global.mapOpenRouterHttpError = mapOpenRouterHttpError;
  if (typeof readOpenRouterResponse !== 'undefined') global.readOpenRouterResponse = readOpenRouterResponse;
  if (typeof maxTokensForTabs !== 'undefined') global.maxTokensForTabs = maxTokensForTabs;
  if (typeof aiKeyState !== 'undefined') global.aiKeyState = aiKeyState;
  if (typeof runAiOrganize !== 'undefined') global.runAiOrganize = runAiOrganize;
  if (typeof aiRuns !== 'undefined') global.aiRuns = aiRuns;
  if (typeof AI_KEY_ALARM !== 'undefined') global.AI_KEY_ALARM = AI_KEY_ALARM;

  // Tab Snoozing exposures
  if (typeof computePresetWakeTime !== 'undefined') global.computePresetWakeTime = computePresetWakeTime;
  if (typeof nextWeekdayAt !== 'undefined') global.nextWeekdayAt = nextWeekdayAt;
  if (typeof clampWakeAt !== 'undefined') global.clampWakeAt = clampWakeAt;
  if (typeof isSnoozeableUrl !== 'undefined') global.isSnoozeableUrl = isSnoozeableUrl;
  if (typeof buildSnoozeSummary !== 'undefined') global.buildSnoozeSummary = buildSnoozeSummary;
  if (typeof createSnoozeRecord !== 'undefined') global.createSnoozeRecord = createSnoozeRecord;
  if (typeof snoozeTabs !== 'undefined') global.snoozeTabs = snoozeTabs;
  if (typeof handleSnoozeTab !== 'undefined') global.handleSnoozeTab = handleSnoozeTab;
  if (typeof handleSnoozeSelected !== 'undefined') global.handleSnoozeSelected = handleSnoozeSelected;
  if (typeof handleSnoozeWindow !== 'undefined') global.handleSnoozeWindow = handleSnoozeWindow;
  if (typeof handleSnoozeGroup !== 'undefined') global.handleSnoozeGroup = handleSnoozeGroup;
  if (typeof handleListSnoozed !== 'undefined') global.handleListSnoozed = handleListSnoozed;
  if (typeof handleWakeNow !== 'undefined') global.handleWakeNow = handleWakeNow;
  if (typeof handleCancelSnooze !== 'undefined') global.handleCancelSnooze = handleCancelSnooze;
  if (typeof handleRestoreSnoozed !== 'undefined') global.handleRestoreSnoozed = handleRestoreSnoozed;
  if (typeof handleSnoozeAlarm !== 'undefined') global.handleSnoozeAlarm = handleSnoozeAlarm;
  if (typeof wakeSnoozedRecord !== 'undefined') global.wakeSnoozedRecord = wakeSnoozedRecord;
  if (typeof reconcileSnoozeAlarms !== 'undefined') global.reconcileSnoozeAlarms = reconcileSnoozeAlarms;
  if (typeof SNOOZE_PRESETS !== 'undefined') global.SNOOZE_PRESETS = SNOOZE_PRESETS;

  // AI proposal / grouping exposures
  if (typeof callOpenRouter !== 'undefined') global.callOpenRouter = callOpenRouter;
  if (typeof handleAiGroupTabs !== 'undefined') global.handleAiGroupTabs = handleAiGroupTabs;
  if (typeof handleApplyAiProposal !== 'undefined') global.handleApplyAiProposal = handleApplyAiProposal;
})();
`;
eval(backgroundWrapper);

// The worker's own onMessage listeners (the pages loaded below register
// theirs on the same mock). dispatch() sends a message to these only, the way
// a page's chrome.runtime.sendMessage reaches the worker.
const workerMessageListeners = messageListeners.slice(listenersBeforeWorker);

// Sends `message` from `sender` to the worker and resolves with what the
// worker passes to sendResponse. It fails when the worker has no listener,
// when a listener replies twice, when an action that replies later did not
// return true (Chrome would close the channel and the page would get
// nothing), or when no reply comes within `timeoutMs`.
// A second reply can't reject a promise the first reply already resolved, so
// it is recorded here and fails the test that caused it (see afterEach below).
const doubleReplies = [];
afterEach(() => {
  if (doubleReplies.length) throw new Error(doubleReplies.splice(0).join('; '));
});

global.dispatch = (message, sender = {}, { timeoutMs = 3000 } = {}) => new Promise((resolve, reject) => {
  if (workerMessageListeners.length === 0) {
    reject(new Error('the worker registered no chrome.runtime.onMessage listener'));
    return;
  }
  let replied = false;
  let timer = null;
  const sendResponse = (value) => {
    if (replied) {
      doubleReplies.push(`the worker replied twice to ${JSON.stringify(message.action || message.type)}`);
      return;
    }
    replied = true;
    if (timer) clearTimeout(timer);
    resolve(value);
  };
  const results = workerMessageListeners.map((fn) => fn(message, sender, sendResponse));
  if (replied) return;
  if (!results.includes(true)) {
    reject(new Error(`${JSON.stringify(message.action || message.type)} replies later, but its listener did not return true`));
    return;
  }
  timer = setTimeout(() => reject(new Error(`no reply to ${JSON.stringify(message.action || message.type)} within ${timeoutMs} ms`)), timeoutMs);
});

// Load and execute popup script, exposing functions globally
const popupJs = readFileSync(resolve(__dirname, '../src/popup.js'), 'utf8');
const popupWrapper = `
(function() {
  ${popupJs}

  // Expose functions to global scope
  if (typeof lexHost !== 'undefined') global.lexHost = lexHost;
  if (typeof getRespectGroups !== 'undefined') global.getRespectGroups = getRespectGroups;
  if (typeof setRespectGroups !== 'undefined') global.setRespectGroups = setRespectGroups;
  if (typeof saveUserPreference !== 'undefined') global.saveUserPreference = saveUserPreference;
  if (typeof loadUserPreferences !== 'undefined') global.loadUserPreferences = loadUserPreferences;
  if (typeof initModeToggle !== 'undefined') global.initModeToggle = initModeToggle;
  if (typeof sortAllWindows !== 'undefined') global.sortAllWindows = sortAllWindows;
  if (typeof sortCurrentWindow !== 'undefined') global.sortCurrentWindow = sortCurrentWindow;
  if (typeof extractDomain !== 'undefined') global.extractDomain = extractDomain;
  if (typeof removeDuplicatesWindow !== 'undefined') global.removeDuplicatesWindow = removeDuplicatesWindow;
  if (typeof removeDuplicatesAllWindows !== 'undefined') global.removeDuplicatesAllWindows = removeDuplicatesAllWindows;
  if (typeof removeDuplicatesGlobally !== 'undefined') global.removeDuplicatesGlobally = removeDuplicatesGlobally;
  if (typeof extractAllDomains !== 'undefined') global.extractAllDomains = extractAllDomains;
  if (typeof moveAllToSingleWindow !== 'undefined') global.moveAllToSingleWindow = moveAllToSingleWindow;
  if (typeof copyTabsToClipboard !== 'undefined') global.copyTabsToClipboard = copyTabsToClipboard;
  if (typeof copyFeedbackMessage !== 'undefined') global.copyFeedbackMessage = copyFeedbackMessage;
  if (typeof copyThisWindow !== 'undefined') global.copyThisWindow = copyThisWindow;
  if (typeof copyAllWindows !== 'undefined') global.copyAllWindows = copyAllWindows;
  if (typeof flattenWindow !== 'undefined') global.flattenWindow = flattenWindow;
  if (typeof compactWindow !== 'undefined') global.compactWindow = compactWindow;
  if (typeof expandWindow !== 'undefined') global.expandWindow = expandWindow;
  if (typeof updateSplitViewButtons !== 'undefined') global.updateSplitViewButtons = updateSplitViewButtons;
  if (typeof updateStatusBar !== 'undefined') global.updateStatusBar = updateStatusBar;
  if (typeof loadBrowserSnapshot !== 'undefined') global.loadBrowserSnapshot = loadBrowserSnapshot;
  if (typeof describeActionResult !== 'undefined') global.describeActionResult = describeActionResult;
  if (typeof showActionResult !== 'undefined') global.showActionResult = showActionResult;
  if (typeof actionResultKind !== 'undefined') global.actionResultKind = actionResultKind;
  if (typeof updateToastSpace !== 'undefined') global.updateToastSpace = updateToastSpace;
  if (typeof sendAction !== 'undefined') global.sendAction = sendAction;
  if (typeof submitSnooze !== 'undefined') global.submitSnooze = submitSnooze;
  if (typeof openSnoozePicker !== 'undefined') global.openSnoozePicker = openSnoozePicker;
  if (typeof closeSnoozePicker !== 'undefined') global.closeSnoozePicker = closeSnoozePicker;
  if (typeof aiOrganize !== 'undefined') global.aiOrganize = aiOrganize;
  // Namespaced to avoid colliding with confirmation-dialog.js's own
  // (differently-scoped) global.setupEventListeners export above.
  if (typeof setupEventListeners !== 'undefined') global.popupSetupEventListeners = setupEventListeners;

  // Tab Snoozing popup exposures
  if (typeof formatWakeTime !== 'undefined') global.formatWakeTime = formatWakeTime;
  if (typeof renderSnoozedList !== 'undefined') global.renderSnoozedList = renderSnoozedList;
  if (typeof updateSnoozeButtonState !== 'undefined') global.updateSnoozeButtonState = updateSnoozeButtonState;
  if (typeof initSnoozeUi !== 'undefined') global.initSnoozeUi = initSnoozeUi;
  if (typeof snoozePresetLabel !== 'undefined') global.snoozePresetLabel = snoozePresetLabel;
  if (typeof wakeNow !== 'undefined') global.wakeNow = wakeNow;
  if (typeof discardSnooze !== 'undefined') global.discardSnooze = discardSnooze;
  if (typeof showDiscardNotice !== 'undefined') global.showDiscardNotice = showDiscardNotice;
  if (typeof undoDiscard !== 'undefined') global.undoDiscard = undoDiscard;

  // Keyboard shortcut exposures
  if (typeof buildHotkeyMap !== 'undefined') global.buildHotkeyMap = buildHotkeyMap;
  if (typeof refreshHotkeys !== 'undefined') global.refreshHotkeys = refreshHotkeys;
  if (typeof handleHotkeyKeydown !== 'undefined') global.handleHotkeyKeydown = handleHotkeyKeydown;
  if (typeof isTextInputTarget !== 'undefined') global.isTextInputTarget = isTextInputTarget;
  if (typeof isHotkeyVisible !== 'undefined') global.isHotkeyVisible = isHotkeyVisible;
})();
`;
eval(popupWrapper);

// The shared AI script (key checks, key form, model picker) that the
// organize page and the Settings page both load first. Pure definitions, no
// auto-run; its one global, HuddleAi, is what those pages call.
const aiConfigJs = readFileSync(resolve(__dirname, '../src/ai-config.js'), 'utf8');
eval(`(function() {\n${aiConfigJs}\nglobal.HuddleAi = HuddleAi;\n})();`);

// Load and execute ai-proposal script, exposing functions globally.
// ai-proposal.js's top-level init() runs synchronously on eval (jsdom's
// document.readyState is already 'complete'), and it dereferences several
// element ids without null-guards (e.g. setupDebugToggle()'s
// toggle.addEventListener). Stand up a throwaway DOM matching
// ai-proposal.html just for the duration of this eval so init() doesn't
// throw, then restore whatever body markup was there before — individual
// tests build their own fixture DOM before calling the exposed functions.
const aiProposalDomBackup = document.body.innerHTML;
document.body.innerHTML = `
  <div id="actionsContainer" class="actions" style="display: none;">
    <button class="confirm" id="applyButton">Apply</button>
    <button class="cancel" id="cancelButton">Cancel</button>
  </div>
  <div id="content"><div class="loading">Loading proposal...</div></div>
  <button class="debug-toggle" id="debugToggle" hidden>Show the model's raw output</button>
  <div class="debug-section" id="debugSection"></div>
`;
const aiProposalJs = readFileSync(resolve(__dirname, '../src/ai-proposal.js'), 'utf8');
const aiProposalWrapper = `
(function() {
  ${aiProposalJs}

  // Expose functions to global scope
  if (typeof escapeHtml !== 'undefined') global.escapeHtml = escapeHtml;
  if (typeof moveTab !== 'undefined') global.moveTab = moveTab;
  if (typeof renderGroup !== 'undefined') global.renderGroup = renderGroup;
  if (typeof handleRunMessage !== 'undefined') global.handleRunMessage = handleRunMessage;
  if (typeof showProposal !== 'undefined') global.showProposal = showProposal;
  if (typeof showError !== 'undefined') global.showError = showError;
  if (typeof render !== 'undefined') global.renderProposal = render;
  if (typeof setupActionButtons !== 'undefined') global.setupActionButtons = setupActionButtons;
})();
`;
eval(aiProposalWrapper);
document.body.innerHTML = aiProposalDomBackup;

// Load and execute confirmation dialog script, exposing functions globally
const confirmationJs = readFileSync(resolve(__dirname, '../src/confirmation-dialog.js'), 'utf8');
const confirmationWrapper = `
(function() {
  ${confirmationJs}

  // Expose functions to global scope
  if (typeof updateContent !== 'undefined') global.updateContent = updateContent;
  if (typeof setupEventListeners !== 'undefined') global.setupEventListeners = setupEventListeners;
  if (typeof respond !== 'undefined') global.respond = respond;
})();
`;
eval(confirmationWrapper);

// Load and execute content-clumper script, exposing its pure helpers + test hooks
const clumperJs = readFileSync(resolve(__dirname, '../src/content-clumper.js'), 'utf8');
const clumperWrapper = `
(function() {
  ${clumperJs}

  if (typeof clumperIsOpenableUrl !== 'undefined') global.clumperIsOpenableUrl = clumperIsOpenableUrl;
  if (typeof clumperRectsOverlap !== 'undefined') global.clumperRectsOverlap = clumperRectsOverlap;
  if (typeof clumperBoxFromPoints !== 'undefined') global.clumperBoxFromPoints = clumperBoxFromPoints;
  if (typeof clumperKeyMatches !== 'undefined') global.clumperKeyMatches = clumperKeyMatches;
  if (typeof clumperModifierMatches !== 'undefined') global.clumperModifierMatches = clumperModifierMatches;
  if (typeof clumperCollectUrlsInRect !== 'undefined') global.clumperCollectUrlsInRect = clumperCollectUrlsInRect;
  if (typeof clumperIsTextInputTarget !== 'undefined') global.clumperIsTextInputTarget = clumperIsTextInputTarget;
  if (typeof clumperResetStateForTest !== 'undefined') global.clumperResetStateForTest = clumperResetStateForTest;
  if (typeof clumperGetStateForTest !== 'undefined') global.clumperGetStateForTest = clumperGetStateForTest;
  if (typeof clumperApplySettings !== 'undefined') global.clumperApplySettings = clumperApplySettings;
  // jsdom's events are never trusted, so the tests trust every event unless a
  // test asks for the real check: clumperTrustAllEventsForTest(false).
  const clumperRealEventIsTrusted = clumperEventIsTrusted;
  global.clumperTrustAllEventsForTest = (all) => {
    clumperEventIsTrusted = all ? () => true : clumperRealEventIsTrusted;
  };
  global.clumperTrustAllEventsForTest(true);
})();
`;
eval(clumperWrapper);

// Load and execute options script, exposing its pure helpers + test hooks
const optionsJs = readFileSync(resolve(__dirname, '../src/options.js'), 'utf8');
const optionsWrapper = `
(function() {
  ${optionsJs}

  if (typeof CLUMPING_DEFAULTS !== 'undefined') global.CLUMPING_DEFAULTS = CLUMPING_DEFAULTS;
  if (typeof getAllowedKeys !== 'undefined') global.getAllowedKeys = getAllowedKeys;
  if (typeof applyDefaults !== 'undefined') global.optionsApplyDefaults = applyDefaults;
  if (typeof loadClumpingSettings !== 'undefined') global.loadClumpingSettings = loadClumpingSettings;
  if (typeof saveClumpingSettings !== 'undefined') global.saveClumpingSettings = saveClumpingSettings;
  if (typeof populateKeyDropdown !== 'undefined') global.populateKeyDropdown = populateKeyDropdown;
  if (typeof readFormState !== 'undefined') global.readFormState = readFormState;
  if (typeof writeFormState !== 'undefined') global.writeFormState = writeFormState;
  if (typeof showStatus !== 'undefined') global.showStatus = showStatus;
  if (typeof handleFormChange !== 'undefined') global.handleFormChange = handleFormChange;
})();
`;
eval(optionsWrapper);

// Load and execute the nap room script, exposing its pure helpers
const napRoomJs = readFileSync(resolve(__dirname, '../src/nap-room.js'), 'utf8');
const napRoomWrapper = `
(function() {
  ${napRoomJs}

  if (typeof napFormatClock !== 'undefined') global.napFormatClock = napFormatClock;
  if (typeof napDayInfo !== 'undefined') global.napDayInfo = napDayInfo;
  if (typeof napNextWakeSummary !== 'undefined') global.napNextWakeSummary = napNextWakeSummary;
  if (typeof napRowTitle !== 'undefined') global.napRowTitle = napRowTitle;
  if (typeof napRowUrl !== 'undefined') global.napRowUrl = napRowUrl;
  if (typeof napGroupBadge !== 'undefined') global.napGroupBadge = napGroupBadge;
  if (typeof napGroupByDay !== 'undefined') global.napGroupByDay = napGroupByDay;
  if (typeof napRenderAll !== 'undefined') global.napRenderAll = napRenderAll;
  if (typeof napScheduleMidnightRefresh !== 'undefined') global.napScheduleMidnightRefresh = napScheduleMidnightRefresh;
  if (typeof napWakeNow !== 'undefined') global.napWakeNow = napWakeNow;
  if (typeof napWakeAll !== 'undefined') global.napWakeAll = napWakeAll;
  if (typeof napDiscard !== 'undefined') global.napDiscard = napDiscard;
  if (typeof napShowDiscardNotice !== 'undefined') global.napShowDiscardNotice = napShowDiscardNotice;
  if (typeof napUndoDiscard !== 'undefined') global.napUndoDiscard = napUndoDiscard;
  if (typeof napLoadAndRender !== 'undefined') global.napLoadAndRender = napLoadAndRender;
})();
`;
eval(napRoomWrapper);

// Snapshot base listeners registered during eval, reset to this state before each test
const baseListeners = [...messageListeners];

beforeEach(() => {
  vi.clearAllMocks();
  messageListeners.length = 0;
  messageListeners.push(...baseListeners);
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
});
