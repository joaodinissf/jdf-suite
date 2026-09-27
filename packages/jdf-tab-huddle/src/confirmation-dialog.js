// Get data from URL parameters immediately
const urlParams = new URLSearchParams(window.location.search);
const extractableCount = parseInt(urlParams.get('extractable') || '0');
const singleTabCount = parseInt(urlParams.get('single') || '0');
const totalWindows = extractableCount + (singleTabCount > 0 ? 1 : 0);

// Function to update content
function updateContent() {
  // Update window count
  const windowCountElement = document.getElementById('windowCount');
  if (windowCountElement) {
    windowCountElement.textContent = `This will create ${totalWindows} new browser window${totalWindows === 1 ? '' : 's'}.`;
  }

  // Update operation list
  const operationList = document.getElementById('operationList');
  if (operationList) {
    let listContent = '';

    if (extractableCount > 0) {
      listContent += `<li><strong>${extractableCount} windows</strong> will be created, one for each domain with 2+ tabs</li>`;
    }

    if (singleTabCount > 0) {
      listContent += `<li><strong>1 miscellaneous window</strong> will be created for ${singleTabCount} single-tab domains</li>`;
    }

    listContent += `<li>All windows will be sorted alphabetically by URL after extraction</li>`;
    listContent += `<li>Pinned tabs will remain in their current windows (not moved)</li>`;

    operationList.innerHTML = listContent;
  }

  // Update confirm button text
  const confirmButton = document.getElementById('confirmButton');
  if (confirmButton) {
    confirmButton.textContent = `Create ${totalWindows} window${totalWindows === 1 ? '' : 's'}`;
  }
}

// Function to setup event listeners
function setupEventListeners() {
  const confirmBtn = document.getElementById('confirmButton');
  const cancelBtn = document.getElementById('cancelButton');

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => respond(true));
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => respond(false));
  }
}

// The background closes this tab once it has the answer. If it could not act
// (the request ended, or the split failed), say so here instead of sitting
// silent; Cancel still closes the tab.
async function respond(confirmed) {
  const confirmBtn = document.getElementById('confirmButton');
  const cancelBtn = document.getElementById('cancelButton');
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      action: 'extractAllDomainsConfirmation',
      confirmed: confirmed
    });
  } catch (error) {
    console.error('[Tab Organizer] Error sending confirmation response:', error);
  }
  if (response && response.success) return;

  if (!confirmed) {
    window.close();
    return;
  }
  showDialogError((response && response.error) || 'Huddle did not answer. Close this tab and run Split domains again.');
  // The request is spent either way, so only Close is left.
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
  }
}

function showDialogError(text) {
  const errorEl = document.getElementById('dialogError');
  if (!errorEl) return;
  errorEl.textContent = text;
  errorEl.hidden = false;
}

// Try to update immediately (works if DOM is already loaded)
if (document.readyState === 'loading') {
  // DOM not ready yet
  document.addEventListener('DOMContentLoaded', function () {
    updateContent();
    setupEventListeners();
  });
} else {
  // DOM already ready
  updateContent();
  setupEventListeners();
}
