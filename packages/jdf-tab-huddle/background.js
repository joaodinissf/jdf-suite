// Background script for persistent logging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'log') {
    console.log('[Tab Organizer]', message.data);
  }
});