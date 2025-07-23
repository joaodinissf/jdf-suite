// Test setup file
// Assign jest-chrome to global scope
Object.assign(global, require('jest-chrome'));

// Mock console.log to avoid noise in tests
global.console.log = jest.fn();

// Mock chrome APIs that aren't covered by jest-chrome
Object.assign(chrome, {
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    query: jest.fn(),
    update: jest.fn()
  },
  tabs: {
    ...chrome.tabs,
    group: jest.fn()
  }
});

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

const fs = require('fs');
const path = require('path');

// Load and execute background script, exposing functions globally
const backgroundJs = fs.readFileSync(path.resolve(__dirname, '../src/background.js'), 'utf8');
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
})();
`;
eval(backgroundWrapper);

// Load and execute popup script, exposing functions globally  
const popupJs = fs.readFileSync(path.resolve(__dirname, '../src/popup.js'), 'utf8');
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
})();
`;
eval(popupWrapper);

// Load and execute confirmation dialog script, exposing functions globally
const confirmationJs = fs.readFileSync(path.resolve(__dirname, '../src/confirmation-dialog.js'), 'utf8');
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
