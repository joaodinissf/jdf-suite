document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('sortAllWindows').addEventListener('click', sortAllWindows);
  document.getElementById('sortCurrentWindow').addEventListener('click', sortCurrentWindow);
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
  chrome.tabs.query({ currentWindow: true }, function (tabs) {
    // Sort tabs by URL
    tabs.sort((a, b) => {
      const urlA = a.pendingUrl || a.url;
      const urlB = b.pendingUrl || b.url;
      return urlA.localeCompare(urlB);
    });

    // Move tabs to their new positions
    for (let i = 0; i < tabs.length; i++) {
      chrome.tabs.move(tabs[i].id, { index: i });
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

// Move all tabs to a single window
function moveAllToSingleWindow() {
  chrome.runtime.sendMessage({
    action: 'moveAllToSingleWindow'
  }, function(response) {
    if (chrome.runtime.lastError) {
      log('Error from background:', chrome.runtime.lastError.message);
    } else if (!response.success) {
      log('Background failed:', response.error);
    }
  });
}