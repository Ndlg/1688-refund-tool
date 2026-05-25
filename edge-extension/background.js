function collectIdsFromTab(tabId, sendResponse) {
  chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
    if (chrome.runtime.lastError || !frames || !frames.length) {
      sendResponse({ ids: [] });
      return;
    }

    const ids = new Set();
    let pending = frames.length;

    const finish = () => {
      pending -= 1;
      if (pending === 0) sendResponse({ ids: [...ids] });
    };

    for (const frame of frames) {
      chrome.tabs.sendMessage(tabId, { type: 'codex1688:scan-ids' }, { frameId: frame.frameId }, (response) => {
        if (response && Array.isArray(response.ids)) {
          for (const id of response.ids) ids.add(id);
        }
        void chrome.runtime.lastError;
        finish();
      });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'codex1688:collect-ids') return false;

  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const tab = tabs.find((item) => item.active && item.url && item.url.includes('.1688.com/'))
      || tabs.find((item) => item.url && item.url.includes('.1688.com/'))
      || tabs.find((item) => item.url && item.url.includes('1688.com/'));
    if (tab && tab.id) collectIdsFromTab(tab.id, sendResponse);
    else sendResponse({ ids: [] });
  });

  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});
