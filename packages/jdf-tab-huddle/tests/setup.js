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
  },
  windows: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getCurrent: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
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
  if (typeof handleSortAllWindows !== 'undefined') global.handleSortAllWindows = handleSortAllWindows;
  if (typeof handleSortCurrentWindow !== 'undefined') global.handleSortCurrentWindow = handleSortCurrentWindow;
  if (typeof handleRemoveDuplicatesWindow !== 'undefined') global.handleRemoveDuplicatesWindow = handleRemoveDuplicatesWindow;
  if (typeof handleRemoveDuplicatesAllWindows !== 'undefined') global.handleRemoveDuplicatesAllWindows = handleRemoveDuplicatesAllWindows;
  if (typeof handleRemoveDuplicatesGlobally !== 'undefined') global.handleRemoveDuplicatesGlobally = handleRemoveDuplicatesGlobally;
  if (typeof handleExtractDomain !== 'undefined') global.handleExtractDomain = handleExtractDomain;
  if (typeof handleExtractAllDomains !== 'undefined') global.handleExtractAllDomains = handleExtractAllDomains;
  if (typeof handleMoveAllToSingleWindow !== 'undefined') global.handleMoveAllToSingleWindow = handleMoveAllToSingleWindow;
  if (typeof formatTabsAsText !== 'undefined') global.formatTabsAsText = formatTabsAsText;
  if (typeof handleCopyAllTabs !== 'undefined') global.handleCopyAllTabs = handleCopyAllTabs;
  if (typeof encodeKey !== 'undefined') global.encodeKey = encodeKey;
  if (typeof decodeKey !== 'undefined') global.decodeKey = decodeKey;
  if (typeof isKeyExpired !== 'undefined') global.isKeyExpired = isKeyExpired;
  if (typeof buildAiPrompt !== 'undefined') global.buildAiPrompt = buildAiPrompt;
  if (typeof parseAiResponse !== 'undefined') global.parseAiResponse = parseAiResponse;
  if (typeof stripQueryParams !== 'undefined') global.stripQueryParams = stripQueryParams;
  if (typeof AI_MODELS !== 'undefined') global.AI_MODELS = AI_MODELS;
  if (typeof VALID_TAB_GROUP_COLORS !== 'undefined') global.VALID_TAB_GROUP_COLORS = VALID_TAB_GROUP_COLORS;
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
  if (typeof getCurrentMode !== 'undefined') global.getCurrentMode = getCurrentMode;
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
  if (typeof copyAllTabs !== 'undefined') global.copyAllTabs = copyAllTabs;
  if (typeof flattenWindow !== 'undefined') global.flattenWindow = flattenWindow;
  if (typeof updateStatusBar !== 'undefined') global.updateStatusBar = updateStatusBar;
  if (typeof aiOrganize !== 'undefined') global.aiOrganize = aiOrganize;
  if (typeof openAiSettings !== 'undefined') global.openAiSettings = openAiSettings;
  if (typeof updateAiButtonState !== 'undefined') global.updateAiButtonState = updateAiButtonState;
})();
`;
eval(popupWrapper);

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

// Snapshot base listeners registered during eval, reset to this state before each test
const baseListeners = [...messageListeners];

beforeEach(() => {
  vi.clearAllMocks();
  messageListeners.length = 0;
  messageListeners.push(...baseListeners);
});
