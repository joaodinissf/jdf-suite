document.addEventListener('DOMContentLoaded', function () {
  // Initialize tab switching
  initTabSwitching();
  
  // Load saved preferences
  loadUserPreferences();
  
  // Setup event listeners for both modes
  setupEventListeners();

  // Update UI based on number of windows
  updateUIForWindowCount();

  // Update AI button visibility (show cog if key is set)
  updateAiButtonState();

  // Update status bar
  updateStatusBar();

  // Wire up the Settings link to open the options page
  const settingsLink = document.getElementById('openOptions');
  if (settingsLink) {
    settingsLink.addEventListener('click', (event) => {
      event.preventDefault();
      if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
  }
});

// Tab switching functionality
function initTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;
      
      // Update button states
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update content visibility
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === targetTab + '-content') {
          content.classList.add('active');
        }
      });
      
      // Save preference
      saveUserPreference('selectedMode', targetTab);
    });
  });
}

// Load user preferences
function loadUserPreferences() {
  chrome.storage.local.get(['selectedMode'], (result) => {
    const savedMode = result.selectedMode || 'groups'; // Default to groups mode
    
    // Update UI to show saved mode
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === savedMode) {
        btn.classList.add('active');
      }
    });
    
    tabContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === savedMode + '-content') {
        content.classList.add('active');
      }
    });
  });
}

// Save user preference
function saveUserPreference(key, value) {
  chrome.storage.local.set({ [key]: value });
}

// Get current mode
function getCurrentMode() {
  const activeTab = document.querySelector('.tab-button.active');
  return activeTab ? activeTab.dataset.tab : 'groups';
}

// Setup event listeners for both modes
function setupEventListeners() {
  // Groups mode listeners
  document.getElementById('sortAllWindows-groups').addEventListener('click', () => sortAllWindows(true));
  document.getElementById('sortCurrentWindow-groups').addEventListener('click', () => sortCurrentWindow(true));
  document.getElementById('removeDuplicatesWindow-groups').addEventListener('click', () => removeDuplicatesWindow(true));
  document.getElementById('removeDuplicatesAllWindows-groups').addEventListener('click', () => removeDuplicatesAllWindows(true));
  document.getElementById('removeDuplicatesGlobally-groups').addEventListener('click', () => removeDuplicatesGlobally(true));
  document.getElementById('extractDomain-groups').addEventListener('click', () => extractDomain(true));
  document.getElementById('extractAllDomains-groups').addEventListener('click', () => extractAllDomains(true));
  document.getElementById('moveAllToSingleWindow-groups').addEventListener('click', () => moveAllToSingleWindow(true));
  document.getElementById('copyAllTabs-groups').addEventListener('click', () => copyAllTabs(true));
  document.getElementById('flattenWindow-groups').addEventListener('click', () => flattenWindow());

  // Individual mode listeners
  document.getElementById('sortAllWindows-individual').addEventListener('click', () => sortAllWindows(false));
  document.getElementById('sortCurrentWindow-individual').addEventListener('click', () => sortCurrentWindow(false));
  document.getElementById('removeDuplicatesWindow-individual').addEventListener('click', () => removeDuplicatesWindow(false));
  document.getElementById('removeDuplicatesAllWindows-individual').addEventListener('click', () => removeDuplicatesAllWindows(false));
  document.getElementById('removeDuplicatesGlobally-individual').addEventListener('click', () => removeDuplicatesGlobally(false));
  document.getElementById('extractDomain-individual').addEventListener('click', () => extractDomain(false));
  document.getElementById('extractAllDomains-individual').addEventListener('click', () => extractAllDomains(false));
  document.getElementById('moveAllToSingleWindow-individual').addEventListener('click', () => moveAllToSingleWindow(false));
  document.getElementById('copyAllTabs-individual').addEventListener('click', () => copyAllTabs(false));

  // AI listeners (both modes)
  document.getElementById('aiOrganize-groups').addEventListener('click', () => aiOrganize(true));
  document.getElementById('aiOrganize-individual').addEventListener('click', () => aiOrganize(false));
  document.getElementById('aiSettings-groups').addEventListener('click', () => openAiSettings());
  document.getElementById('aiSettings-individual').addEventListener('click', () => openAiSettings());
}

// Simple logging helper
function log(message, ...args) {
  console.log('[Tab Organizer]', message, ...args);
  chrome.runtime.sendMessage({ type: 'log', data: { message, args } }).catch(() => { });
}

// Generic function to send actions to the background script
function sendAction(action, data = {}) {
  const message = { action, ...data };
  chrome.runtime.sendMessage(message, function (response) {
    if (chrome.runtime.lastError) {
      log(`Error from background for action "${action}":`, chrome.runtime.lastError.message);
    } else if (response && !response.success) {
      log(`Background failed for action "${action}":`, response.error);
    } else if (response && response.cancelled) {
      log(`Action "${action}" was cancelled by the user.`);
    }
  });
}

// Sort tabs by URL across all windows
function sortAllWindows(respectGroups = true) {
  sendAction('sortAllWindows', { respectGroups });
}

// Sort tabs by URL in current window
function sortCurrentWindow(respectGroups = true) {
  sendAction('sortCurrentWindow', { respectGroups });
}

// Extract tabs from current domain into a new window
function extractDomain(respectGroups = true) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found for extractDomain');
      return;
    }
    const activeTab = activeTabs[0];
    sendAction('extractDomain', {
      tabId: activeTab.id,
      url: activeTab.url,
      respectGroups
    });
  });
}

// Remove duplicates within current window only
function removeDuplicatesWindow(respectGroups = true) {
  sendAction('removeDuplicatesWindow', { respectGroups });
}

// Remove duplicates within each window separately
function removeDuplicatesAllWindows(respectGroups = true) {
  sendAction('removeDuplicatesAllWindows', { respectGroups });
}

// Remove duplicates across all windows globally
function removeDuplicatesGlobally(respectGroups = true) {
  sendAction('removeDuplicatesGlobally', { respectGroups });
}

// Extract all domains into separate windows
function extractAllDomains(respectGroups = true) {
  sendAction('extractAllDomains', { respectGroups });
}

// Ungroup all tabs in the current window
function flattenWindow() {
  sendAction('flattenWindow');
}

// Move all tabs to a single window
function moveAllToSingleWindow(respectGroups = true) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found for moveAllToSingleWindow');
      return;
    }
    const activeTab = activeTabs[0];
    sendAction('moveAllToSingleWindow', {
      activeTabId: activeTab.id,
      respectGroups
    });
  });
}

// Copy all tab URLs to clipboard
function copyAllTabs(respectGroups = true) {
  const mode = respectGroups ? 'groups' : 'individual';
  chrome.runtime.sendMessage({ action: 'copyAllTabs', respectGroups }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error copying tabs:', chrome.runtime.lastError.message);
      return;
    }
    if (response && response.success && response.text) {
      navigator.clipboard.writeText(response.text).then(() => {
        const feedback = document.getElementById('copyFeedback-' + mode);
        if (feedback) {
          feedback.classList.add('visible');
          setTimeout(() => feedback.classList.remove('visible'), 1500);
        }
      }).catch(err => {
        log('Clipboard write failed:', err);
      });
    }
  });
}

// Update UI based on number of windows
function updateUIForWindowCount() {
  chrome.windows.getAll({ populate: false }, function (windows) {
    if (windows.length === 1) {
      document.querySelectorAll('.multi-window-section').forEach(section => {
        section.style.display = 'none';
      });
    }
  });
}

// AI Organize
function aiOrganize(respectGroups = true) {
  sendAction('aiGroupTabs', { respectGroups });
}

function openAiSettings() {
  sendAction('openAiSettings');
}

// Show/hide the AI settings cog based on whether a key is configured
function updateAiButtonState() {
  chrome.runtime.sendMessage({ action: 'loadAiConfig' }, function (response) {
    if (chrome.runtime.lastError || !response) return;

    const hasKey = response.config && response.config.key;
    const cogs = document.querySelectorAll('.ai-cog-btn');
    cogs.forEach(cog => {
      cog.style.display = hasKey ? 'block' : 'none';
    });
  });
}

// Update status bar with tab/window/group counts
function updateStatusBar() {
  chrome.tabs.query({ currentWindow: true }, function (currentTabs) {
    chrome.windows.getAll({ populate: true }, function (windows) {
      chrome.tabGroups.query({}, function (allGroups) {
        // This window
        const currentWindowId = currentTabs[0]?.windowId;
        const thisWindowTabs = currentTabs.length;
        const thisWindowGroups = allGroups.filter(g => g.windowId === currentWindowId).length;
        const thisParts = [thisWindowTabs + (thisWindowTabs === 1 ? ' tab' : ' tabs')];
        if (thisWindowGroups > 0) {
          thisParts.push(thisWindowGroups + (thisWindowGroups === 1 ? ' group' : ' groups'));
        }
        const thisEl = document.getElementById('statusThisWindow');
        if (thisEl) thisEl.textContent = thisParts.join(' \u00b7 ');

        // All windows
        const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);
        const totalWindows = windows.length;
        const totalGroups = allGroups.length;
        const allParts = [
          totalTabs + (totalTabs === 1 ? ' tab' : ' tabs'),
          totalWindows + (totalWindows === 1 ? ' window' : ' windows')
        ];
        if (totalGroups > 0) {
          allParts.push(totalGroups + (totalGroups === 1 ? ' group' : ' groups'));
        }
        const allEl = document.getElementById('statusAllWindows');
        if (allEl) allEl.textContent = allParts.join(' \u00b7 ');
      });
    });
  });
}
