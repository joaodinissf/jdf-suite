document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('sortAllWindows').addEventListener('click', sortAllWindows);
  document.getElementById('sortCurrentWindow').addEventListener('click', sortCurrentWindow);
  document.getElementById('removeDuplicatesWindow').addEventListener('click', removeDuplicatesWindow);
  document.getElementById('removeDuplicatesAllWindows').addEventListener('click', removeDuplicatesAllWindows);
  document.getElementById('removeDuplicatesGlobally').addEventListener('click', removeDuplicatesGlobally);
  document.getElementById('extractDomain').addEventListener('click', extractDomain);
  document.getElementById('moveAllToSingleWindow').addEventListener('click', moveAllToSingleWindow);
});

// Simple logging helper
function log(message, ...args) {
  console.log('[Tab Organizer]', message, ...args);
  chrome.runtime.sendMessage({ type: 'log', data: { message, args } }).catch(() => { });
}


// Sort tabs by URL across all windows
function sortAllWindows() {
  chrome.runtime.sendMessage({
    action: 'sortAllWindows'
  }, function(response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Sort tabs by URL in current window
function sortCurrentWindow() {
  chrome.runtime.sendMessage({
    action: 'sortCurrentWindow'
  }, function(response) {
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
  } catch (e) {
    return url || '';
  }
}

// Extract tabs from current domain into a new window
function extractDomain() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found');
      return;
    }
    
    var activeTab = activeTabs[0];
    
    chrome.runtime.sendMessage({
      action: 'extractDomain',
      tabId: activeTab.id,
      url: activeTab.url
    }, function(response) {
      if (chrome.runtime.lastError) {
        log('Error from background:', chrome.runtime.lastError.message);
      } else if (!response.success) {
        log('Background failed:', response.error);
      }
    });
  });
}

// Remove duplicates within current window only
function removeDuplicatesWindow() {
  chrome.runtime.sendMessage({
    action: 'removeDuplicatesWindow'
  }, function(response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Remove duplicates within each window separately
function removeDuplicatesAllWindows() {
  chrome.runtime.sendMessage({
    action: 'removeDuplicatesAllWindows'
  }, function(response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Remove duplicates across all windows globally
function removeDuplicatesGlobally() {
  chrome.runtime.sendMessage({
    action: 'removeDuplicatesGlobally'
  }, function(response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}

// Move all tabs to a single window
function moveAllToSingleWindow() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (activeTabs) {
    if (activeTabs.length === 0) {
      log('No active tab found');
      return;
    }
    
    var activeTab = activeTabs[0];
    
    chrome.runtime.sendMessage({
      action: 'moveAllToSingleWindow',
      activeTabId: activeTab.id
    }, function(response) {
      if (chrome.runtime.lastError) {
        log('Error from background:', chrome.runtime.lastError.message);
      } else if (!response.success) {
        log('Background failed:', response.error);
      }
    });
  });
}