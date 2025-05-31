document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('sortAllWindows').addEventListener('click', sortAllWindows);
  document.getElementById('sortCurrentWindow').addEventListener('click', sortCurrentWindow);
  document.getElementById('extractDomain').addEventListener('click', extractDomain);
});

// Helper function to extract domain from URL with better handling
function getDomain(tab) {
  try {
    // Handle suspended tabs and fallback to pendingUrl
    const url = tab.pendingUrl || tab.url;
    const hostname = new URL(url).hostname;
    return hostname;
  } catch (e) {
    return tab.url || '';
  }
}

// Sort tabs by URL across all windows
function sortAllWindows() {
  chrome.windows.getAll({ populate: true }, function (windows) {
    let allTabs = [];

    // Collect all tabs from all windows
    windows.forEach(function (window) {
      allTabs = allTabs.concat(window.tabs);
    });

    // Sort tabs by URL
    allTabs.sort((a, b) => (a.pendingUrl || a.url).localeCompare(b.pendingUrl || b.url));

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
    // Sort tabs by URL
    tabs.sort((a, b) => (a.pendingUrl || a.url).localeCompare(b.pendingUrl || b.url));

    // Move tabs to their new positions
    for (let i = 0; i < tabs.length; i++) {
      chrome.tabs.move(tabs[i].id, { index: i });
    }
  });
}

// Copy lexHost function from original extension
function lexHost(url) {
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
}

// Extract tabs from current domain into a new window (original approach)
function extractDomain() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs.length === 0) return;
    const tab = tabs[0];
    var target = lexHost(tab.url);

    chrome.tabs.query({}, function(allTabs) {
      const matchingTabs = [];
      for (const t of allTabs) {
        const host = lexHost(t.url);
        if (host === target) {
          matchingTabs.push(t);
        }
      }
      
      if (matchingTabs.length === 0) {
        return; // No matching tabs found
      }

      // Create window with first matching tab and move others
      chrome.windows.create({
        tabId: matchingTabs[0].id,
        focused: true
      }, function(newWindow) {
        // Move remaining matching tabs to the new window
        for (let i = 1; i < matchingTabs.length; i++) {
          chrome.tabs.move(matchingTabs[i].id, {
            windowId: newWindow.id,
            index: -1
          });
        }
      });
    });
  });
}