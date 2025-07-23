// Get data from URL parameters immediately
const urlParams = new URLSearchParams(window.location.search);
const extractableCount = parseInt(urlParams.get('extractable') || '0');
const singleTabCount = parseInt(urlParams.get('single') || '0');
const totalWindows = extractableCount + (singleTabCount > 0 ? 1 : 0);

console.log('URL Params:', window.location.search);
console.log('Parsed values:', { extractableCount, singleTabCount, totalWindows });

// Function to update content
function updateContent() {
  // Update window count
  const windowCountElement = document.getElementById('windowCount');
  if (windowCountElement) {
    windowCountElement.textContent = `This will create ${totalWindows} new browser windows.`;
    console.log('Updated window count element');
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
    console.log('Updated operation list');
  }

  // Update confirm button text
  const confirmButton = document.getElementById('confirmButton');
  if (confirmButton) {
    confirmButton.textContent = `🚀 Create ${totalWindows} Window${totalWindows === 1 ? '' : 's'}`;
    console.log('Updated confirm button text');
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

function respond(confirmed) {
  console.log('User response:', confirmed);
  try {
    chrome.runtime.sendMessage({
      action: 'extractAllDomainsConfirmation',
      confirmed: confirmed
    });
  } catch (error) {
    console.error('Error sending confirmation response:', error);
    window.close();
  }
}

// Try to update immediately (works if DOM is already loaded)
if (document.readyState === 'loading') {
  // DOM not ready yet
  document.addEventListener('DOMContentLoaded', function () {
    updateContent();
    setupEventListeners();
    console.log('Content updated via DOMContentLoaded');
  });
} else {
  // DOM already ready
  updateContent();
  setupEventListeners();
  console.log('Content updated immediately');
}