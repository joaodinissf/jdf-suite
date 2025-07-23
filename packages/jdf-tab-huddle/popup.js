document.addEventListener('DOMContentLoaded', function () {
  // Initialize tab switching
  initTabSwitching();
  
  // Load saved preferences
  loadUserPreferences();
  
  // Setup event listeners for both modes
  setupEventListeners();
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
  
  // Individual mode listeners
  document.getElementById('sortAllWindows-individual').addEventListener('click', () => sortAllWindows(false));
  document.getElementById('sortCurrentWindow-individual').addEventListener('click', () => sortCurrentWindow(false));
  document.getElementById('removeDuplicatesWindow-individual').addEventListener('click', () => removeDuplicatesWindow(false));
  document.getElementById('removeDuplicatesAllWindows-individual').addEventListener('click', () => removeDuplicatesAllWindows(false));
  document.getElementById('removeDuplicatesGlobally-individual').addEventListener('click', () => removeDuplicatesGlobally(false));
  document.getElementById('extractDomain-individual').addEventListener('click', () => extractDomain(false));
  document.getElementById('extractAllDomains-individual').addEventListener('click', () => extractAllDomains(false));
  document.getElementById('moveAllToSingleWindow-individual').addEventListener('click', () => moveAllToSingleWindow(false));
}

// Simple logging helper
function log(message, ...args) {
  console.log('[Tab Organizer]', message, ...args);
  chrome.runtime.sendMessage({ type: 'log', data: { message, args } }).catch(() => { });
}


// Sort tabs by URL across all windows
function sortAllWindows(respectGroups = true) {
  chrome.runtime.sendMessage({
    action: 'sortAllWindows',
    respectGroups: respectGroups
  }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Sort tabs by URL in current window
function sortCurrentWindow(respectGroups = true) {
  chrome.runtime.sendMessage({
    action: 'sortCurrentWindow',
    respectGroups: respectGroups
  }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Extract domain from URL with better handling for sleeping tabs
function lexHost(url) {
  try {
    var u = new URL(url);

    if (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') {
      return u.host;
    }

    if (u.protocol === 'file:') {
      return 'file';
    }

    if (u.protocol === 'data:') {
      return 'data';
    }

    if (u.protocol === 'about:' || u.protocol === 'chrome:') {
      return u.host || u.pathname.split('/')[0];
    }

    return u.hostname;
  } catch (_e) {
    return url || '';
  }
}

// Extract tabs from current domain into a new window
function extractDomain(respectGroups = true) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found');
      return;
    }

    var activeTab = activeTabs[0];

    chrome.runtime.sendMessage({
      action: 'extractDomain',
      tabId: activeTab.id,
      url: activeTab.url,
      respectGroups: respectGroups
    }, function (response) {
      if (chrome.runtime.lastError) {
        log('Error from background:', chrome.runtime.lastError.message);
      } else if (!response.success) {
        log('Background failed:', response.error);
      }
    });
  });
}

// Remove duplicates within current window only
function removeDuplicatesWindow(respectGroups = true) {
  chrome.runtime.sendMessage({
    action: 'removeDuplicatesWindow',
    respectGroups: respectGroups
  }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Remove duplicates within each window separately
function removeDuplicatesAllWindows(respectGroups = true) {
  chrome.runtime.sendMessage({
    action: 'removeDuplicatesAllWindows',
    respectGroups: respectGroups
  }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Remove duplicates across all windows globally
function removeDuplicatesGlobally(respectGroups = true) {
  chrome.runtime.sendMessage({
    action: 'removeDuplicatesGlobally',
    respectGroups: respectGroups
  }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Extract all domains into separate windows
function extractAllDomains(respectGroups = true) {
  chrome.runtime.sendMessage({
    action: 'extractAllDomains',
    respectGroups: respectGroups
  }, function (response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    } else if (response.cancelled) {
      log('Extract all domains cancelled by user');
    }
  });
}

// Move all tabs to a single window
function moveAllToSingleWindow(respectGroups = true) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found');
      return;
    }

    var activeTab = activeTabs[0];

    chrome.runtime.sendMessage({
      action: 'moveAllToSingleWindow',
      activeTabId: activeTab.id,
      respectGroups: respectGroups
    }, function (response) {
      if (chrome.runtime.lastError) {
        log('Error from background:', chrome.runtime.lastError.message);
      } else if (!response.success) {
        log('Background failed:', response.error);
      }
    });
  });
}