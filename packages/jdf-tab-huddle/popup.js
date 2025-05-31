document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('sortAllWindows').addEventListener('click', sortAllWindows);
  document.getElementById('sortCurrentWindow').addEventListener('click', sortCurrentWindow);
  document.getElementById('extractDomain').addEventListener('click', extractDomain);
});


// Sort tabs by URL across all windows
function sortAllWindows() {
  chrome.windows.getAll({ populate: true }, function (windows) {
    let allTabs = [];

    // Collect all tabs from all windows
    windows.forEach(function (window) {
      allTabs = allTabs.concat(window.tabs);
    });

    // Sort tabs by URL using lexHost for consistency
    allTabs.sort((a, b) => {
      const urlA = a.pendingUrl || a.url;
      const urlB = b.pendingUrl || b.url;
      return lexHost(urlA).localeCompare(lexHost(urlB));
    });

    // Move tabs to their new positions
    for (let i = 0; i < allTabs.length; i++) {
      chrome.tabs.move(allTabs[i].id, {
        windowId: allTabs[i].windowId,
        index: -1 // Append to the end of the window
      });
    }
  });
}

// Sort tabs by URL in current window
function sortCurrentWindow() {
  chrome.tabs.query({ currentWindow: true }, function (tabs) {
    // Sort tabs by URL using lexHost for consistency
    tabs.sort((a, b) => {
      const urlA = a.pendingUrl || a.url;
      const urlB = b.pendingUrl || b.url;
      return lexHost(urlA).localeCompare(lexHost(urlB));
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

    if (!u.host || u.host === 'localhost') {
      return u.host || 'localhost';
    }

    var parts = u.host.split('.');
    parts.reverse();
    if (parts.length > 1) {
      parts = parts.slice(1);
    }
    return parts.join('.');
  } catch (e) {
    return url || '';
  }
}

// Extract tabs from current domain into a new window (improved approach)
function extractDomain() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs.length === 0) return;
    const activeTab = tabs[0];
    const activeUrl = activeTab.pendingUrl || activeTab.url;
    const target = lexHost(activeUrl);

    // Get all tabs from all windows
    chrome.windows.getAll({ populate: true }, function (windows) {
      const matchingTabs = [];
      windows.forEach(window => {
        window.tabs.forEach(tab => {
          const tabUrl = tab.pendingUrl || tab.url;
          if (lexHost(tabUrl) === target) {
            matchingTabs.push(tab);
          }
        });
      });
      if (matchingTabs.length === 0) {
        alert('No matching tabs found for this domain.');
        return;
      }

      // Only extract tabs from other windows, not the current window
      const tabsToExtract = matchingTabs.filter(tab => tab.windowId !== activeTab.windowId);

      if (tabsToExtract.length === 0) {
        alert('All matching tabs are already in the current window.');
        return;
      }

      // Create window with first tab from other windows and move others
      chrome.windows.create({
        tabId: tabsToExtract[0].id,
        focused: true
      }, function (newWindow) {
        if (chrome.runtime.lastError || !newWindow) {
          alert('Failed to create new window: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message));
          return;
        }
        // Move remaining tabs from other windows to the new window
        for (let i = 1; i < tabsToExtract.length; i++) {
          chrome.tabs.move(tabsToExtract[i].id, {
            windowId: newWindow.id,
            index: -1
          }, function () {
            if (chrome.runtime.lastError) {
              // Ignore errors for tabs that can't be moved
              console.warn('Tab move error:', chrome.runtime.lastError.message);
            }
          });
        }
      });
    });
  });
}