import { vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const messageListeners = [];

global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn) => messageListeners.push(fn)),
      removeListener: vi.fn((fn) => {
        const i = messageListeners.indexOf(fn);
        if (i >= 0) messageListeners.splice(i, 1);
      }),
      hasListener: (fn) => messageListeners.includes(fn),
      hasListeners: () => messageListeners.length > 0,
      callListeners: (...args) => messageListeners.forEach(fn => fn(...args)),
    },
    getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
    lastError: null,
    onStartup: {
      addListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    move: vi.fn(),
    group: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    sendMessage: vi.fn(),
  },
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    query: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
  },
  windows: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getCurrent: vi.fn(),
    getLastFocused: vi.fn(),
  },
  alarms: {
    create: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(true),
    clearAll: vi.fn().mockResolvedValue(true),
    getAll: vi.fn().mockResolvedValue([]),
    onAlarm: {
      addListener: vi.fn(),
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
  if (typeof handleSortAllWindows !== 'undefined') global.handleSortAllWindows = handleSortAllWindows;
  if (typeof handleSortCurrentWindow !== 'undefined') global.handleSortCurrentWindow = handleSortCurrentWindow;
  if (typeof handleRemoveDuplicatesWindow !== 'undefined') global.handleRemoveDuplicatesWindow = handleRemoveDuplicatesWindow;
  if (typeof handleRemoveDuplicatesAllWindows !== 'undefined') global.handleRemoveDuplicatesAllWindows = handleRemoveDuplicatesAllWindows;
  if (typeof handleRemoveDuplicatesGlobally !== 'undefined') global.handleRemoveDuplicatesGlobally = handleRemoveDuplicatesGlobally;
  if (typeof handleExtractDomain !== 'undefined') global.handleExtractDomain = handleExtractDomain;
  if (typeof handleExtractAllDomains !== 'undefined') global.handleExtractAllDomains = handleExtractAllDomains;
  if (typeof handleMoveAllToSingleWindow !== 'undefined') global.handleMoveAllToSingleWindow = handleMoveAllToSingleWindow;
  if (typeof formatTabsAsText !== 'undefined') global.formatTabsAsText = formatTabsAsText;
  if (typeof handleCopyTabs !== 'undefined') global.handleCopyTabs = handleCopyTabs;
  if (typeof encodeKey !== 'undefined') global.encodeKey = encodeKey;
  if (typeof decodeKey !== 'undefined') global.decodeKey = decodeKey;
  if (typeof saveAiConfig !== 'undefined') global.saveAiConfig = saveAiConfig;
  if (typeof loadAiConfig !== 'undefined') global.loadAiConfig = loadAiConfig;
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
  if (typeof modelSupportsStructuredOutputs !== 'undefined') global.modelSupportsStructuredOutputs = modelSupportsStructuredOutputs;
  if (typeof buildTabGroupsJsonSchema !== 'undefined') global.buildTabGroupsJsonSchema = buildTabGroupsJsonSchema;
  if (typeof buildOpenRouterRequestBody !== 'undefined') global.buildOpenRouterRequestBody = buildOpenRouterRequestBody;
  if (typeof resolveModelDisplayName !== 'undefined') global.resolveModelDisplayName = resolveModelDisplayName;
  if (typeof MODELS_CACHE_KEY !== 'undefined') global.MODELS_CACHE_KEY = MODELS_CACHE_KEY;
  if (typeof MODELS_CACHE_TTL_MS !== 'undefined') global.MODELS_CACHE_TTL_MS = MODELS_CACHE_TTL_MS;

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
  if (typeof handleSnoozeAlarm !== 'undefined') global.handleSnoozeAlarm = handleSnoozeAlarm;
  if (typeof wakeSnoozedRecord !== 'undefined') global.wakeSnoozedRecord = wakeSnoozedRecord;
  if (typeof restoreSnoozedRecord !== 'undefined') global.restoreSnoozedRecord = restoreSnoozedRecord;
  if (typeof reconcileSnoozeAlarms !== 'undefined') global.reconcileSnoozeAlarms = reconcileSnoozeAlarms;
  if (typeof SNOOZE_PRESETS !== 'undefined') global.SNOOZE_PRESETS = SNOOZE_PRESETS;

  // AI proposal / grouping exposures
  if (typeof callOpenRouter !== 'undefined') global.callOpenRouter = callOpenRouter;
  if (typeof handleAiGroupTabs !== 'undefined') global.handleAiGroupTabs = handleAiGroupTabs;
  if (typeof handleApplyAiProposal !== 'undefined') global.handleApplyAiProposal = handleApplyAiProposal;
})();
`;
eval(backgroundWrapper);

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
  if (typeof updateStatusBar !== 'undefined') global.updateStatusBar = updateStatusBar;
  if (typeof aiOrganize !== 'undefined') global.aiOrganize = aiOrganize;
  if (typeof openAiSettings !== 'undefined') global.openAiSettings = openAiSettings;
  if (typeof updateAiButtonState !== 'undefined') global.updateAiButtonState = updateAiButtonState;
  // Namespaced to avoid colliding with confirmation-dialog.js's own
  // (differently-scoped) global.setupEventListeners export above.
  if (typeof setupEventListeners !== 'undefined') global.popupSetupEventListeners = setupEventListeners;

  // Tab Snoozing popup exposures
  if (typeof formatWakeTime !== 'undefined') global.formatWakeTime = formatWakeTime;
  if (typeof renderSnoozedList !== 'undefined') global.renderSnoozedList = renderSnoozedList;
  if (typeof updateSnoozeButtonState !== 'undefined') global.updateSnoozeButtonState = updateSnoozeButtonState;

  // Keyboard shortcut exposures
  if (typeof buildHotkeyMap !== 'undefined') global.buildHotkeyMap = buildHotkeyMap;
  if (typeof refreshHotkeys !== 'undefined') global.refreshHotkeys = refreshHotkeys;
  if (typeof handleHotkeyKeydown !== 'undefined') global.handleHotkeyKeydown = handleHotkeyKeydown;
  if (typeof isTextInputTarget !== 'undefined') global.isTextInputTarget = isTextInputTarget;
  if (typeof isHotkeyVisible !== 'undefined') global.isHotkeyVisible = isHotkeyVisible;
})();
`;
eval(popupWrapper);

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
  <button class="debug-toggle" id="debugToggle">Show raw model I/O</button>
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
  if (typeof handleMessage !== 'undefined') global.handleMessage = handleMessage;
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

// Load and execute the AI setup/settings page script, exposing its pure
// helper + test hooks. The module reads window.location.search once at
// eval time (pageMode) and its bottom auto-run is guarded (see
// hasRequiredPageElements() in the source) so evaluating it here — against
// jsdom's default, mostly-empty document — is a safe no-op; individual
// tests that need pageMode='edit' or a populated currentConfig re-eval the
// source on demand (see tests/ai-setup.test.js), mirroring the pattern
// tests/confirmation-dialog.test.js already uses for the same reason.
const aiSetupJs = readFileSync(resolve(__dirname, '../src/ai-setup.js'), 'utf8');
const aiSetupWrapper = `
(function() {
  ${aiSetupJs}

  // Expose functions to global scope (namespaced to avoid colliding with
  // same-named helpers already exposed from other pages above).
  if (typeof formatTimeRemaining !== 'undefined') global.formatTimeRemaining = formatTimeRemaining;
  if (typeof showError !== 'undefined') global.aiSetupShowError = showError;
  if (typeof hideError !== 'undefined') global.aiSetupHideError = hideError;
  if (typeof populateModels !== 'undefined') global.aiSetupPopulateModels = populateModels;
  if (typeof populateExpiry !== 'undefined') global.aiSetupPopulateExpiry = populateExpiry;
  if (typeof updateModelCost !== 'undefined') global.aiSetupUpdateModelCost = updateModelCost;
  if (typeof init !== 'undefined') global.aiSetupInit = init;
  if (typeof setupEventListeners !== 'undefined') global.aiSetupSetupEventListeners = setupEventListeners;
})();
`;
eval(aiSetupWrapper);

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
})();
`;
eval(napRoomWrapper);

// Snapshot base listeners registered during eval, reset to this state before each test
const baseListeners = [...messageListeners];

beforeEach(() => {
  vi.clearAllMocks();
  messageListeners.length = 0;
  messageListeners.push(...baseListeners);
});
