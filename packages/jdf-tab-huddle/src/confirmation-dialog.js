// Get data from URL parameters immediately
const urlParams = new URLSearchParams(window.location.search);
const extractableCount = parseInt(urlParams.get('extractable') || '0');
const singleTabCount = parseInt(urlParams.get('single') || '0');
const keepsGroups = urlParams.get('groups') !== 'flat';
const totalWindows = extractableCount + (singleTabCount > 0 ? 1 : 0);

// Set once the background has answered a Confirm: only Close is left.
let spent = false;

// "1 tab" / "3 tabs".
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

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
      listContent += `<li><strong>1 miscellaneous window</strong> will be created for ${plural(singleTabCount, 'single-tab domain')}</li>`;
    }

    listContent += `<li>All windows will be sorted alphabetically by URL after splitting</li>`;
    listContent += keepsGroups
      ? `<li>Tab groups are kept</li>`
      : `<li>Tabs leave their groups (Flat mode)</li>`;
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
    cancelBtn.focus();
  }
  // Escape is Cancel (or Close), Cmd/Ctrl+Enter is Confirm. While a button is
  // disabled (the split is running, or the request is spent) its key does
  // nothing.
  document.onkeydown = (event) => {
    const confirm = document.getElementById('confirmButton');
    const cancel = document.getElementById('cancelButton');
    if (!confirm || !cancel) return;
    if (event.key === 'Escape' && !cancel.disabled) {
      event.preventDefault();
      respond(false);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !confirm.disabled) {
      event.preventDefault();
      respond(true);
    }
  };
}

// Confirm asks the background to split and shows what came of it here: the
// windows made and any tabs left behind, or the error. Cancel asks the
// background to close this tab. Once a Confirm is answered, Cancel is Close.
async function respond(confirmed) {
  if (spent) {
    window.close();
    return;
  }
  const confirmBtn = document.getElementById('confirmButton');
  const cancelBtn = document.getElementById('cancelButton');
  const main = document.querySelector('main');
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  if (confirmed) {
    if (confirmBtn) confirmBtn.textContent = `Creating ${plural(totalWindows, 'window')}…`;
    if (main) main.setAttribute('aria-busy', 'true');
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      action: 'extractAllDomainsConfirmation',
      confirmed: confirmed
    });
  } catch (error) {
    console.error('[Tab Organizer] Error sending confirmation response:', error);
  }
  if (main) main.removeAttribute('aria-busy');

  if (!confirmed) {
    // An answered Cancel is closed by the background.
    if (!(response && response.success)) window.close();
    return;
  }
  if (response && response.success) {
    showDialogMessage('dialogResult', `Split into ${plural(response.windows || 0, 'window')}`
      + (response.notMoved ? `; ${plural(response.notMoved, 'tab')} couldn't be moved` : '')
      + (response.sortFailed ? '; couldn\'t sort, try Sort' : ''));
  } else {
    showDialogMessage('dialogError', (response && response.error) || 'Huddle did not answer. Close this tab and run Split domains again.');
  }
  // The request is spent either way, so only Close is left.
  spent = true;
  if (confirmBtn) confirmBtn.hidden = true;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    cancelBtn.focus();
  }
}

function showDialogMessage(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
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
