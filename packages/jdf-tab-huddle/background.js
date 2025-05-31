// Background script - currently only used for debugging
// Remove this file and background entry from manifest when debugging is no longer needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Tab Organizer]', message.data);
  }
});