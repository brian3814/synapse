export function registerContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'extract-page',
      title: 'Extract page to Knowledge Graph',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'extract-selection',
      title: 'Extract selection to Knowledge Graph',
      contexts: ['selection'],
    });
  });
}

export function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): void {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'extract-page':
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PAGE' });
      break;
    case 'extract-selection':
      chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_SELECTION',
        payload: { text: info.selectionText ?? '' },
      });
      break;
  }
}
