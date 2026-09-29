// The `sender` Chrome passes to the worker's chrome.runtime.onMessage
// listener, for each of Huddle's callers. The shapes follow what Chrome for
// Testing 149 and 151 report (audit probe P2):
// - the toolbar popup has id, url and origin, but no tab and no frameId;
// - an extension page open in a tab has its tab and frameId 0;
// - a content script has the site's url and origin, its tab and frameId 0.

const EXT_ID = 'test-id';
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;

// An extension page (by file name) open in a tab of window 1.
function extensionTabSender(page, tabId) {
  const url = `${EXT_ORIGIN}/${page}`;
  return {
    id: EXT_ID,
    url,
    origin: EXT_ORIGIN,
    frameId: 0,
    tab: { id: tabId, windowId: 1, index: 5, url, active: true, pinned: false, groupId: -1 },
  };
}

// The toolbar popup.
export const popupSender = { id: EXT_ID, url: `${EXT_ORIGIN}/popup.html`, origin: EXT_ORIGIN };

// popup.html opened as a page in a tab, as the e2e suite does.
export const popupTabSender = extensionTabSender('popup.html', 501);

export const napSender = extensionTabSender('nap-room.html', 502);

export const optionsSender = extensionTabSender('options.html', 503);

export const dialogSender = extensionTabSender('confirmation-dialog.html?windows=6', 504);

export const organizeSender = extensionTabSender('ai-proposal.html?respectGroups=true', 505);

// The link clumper's content script on a web page.
export const contentSender = {
  id: EXT_ID,
  url: 'https://site.example/articles',
  origin: 'https://site.example',
  frameId: 0,
  tab: { id: 506, windowId: 1, index: 2, url: 'https://site.example/articles', active: true, pinned: false, groupId: -1 },
};
