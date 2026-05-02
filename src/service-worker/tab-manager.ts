const EXTENSION_TAB_URL = chrome.runtime.getURL('index.html');

export async function openExtensionTab(extraParams?: string): Promise<chrome.tabs.Tab> {
  const suffix = extraParams ? '&' + extraParams : '';

  // Check if tab is already open
  const tabs = await chrome.tabs.query({ url: EXTENSION_TAB_URL + '*' });

  if (tabs.length > 0 && tabs[0].id) {
    if (extraParams) {
      await chrome.tabs.update(tabs[0].id, {
        active: true,
        url: EXTENSION_TAB_URL + '?mode=tab' + suffix,
      });
    } else {
      await chrome.tabs.update(tabs[0].id, { active: true });
    }
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
    return tabs[0];
  }

  return chrome.tabs.create({ url: EXTENSION_TAB_URL + '?mode=tab' + suffix });
}

export async function closeExtensionTab(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: EXTENSION_TAB_URL + '*' });
  for (const tab of tabs) {
    if (tab.id) {
      await chrome.tabs.remove(tab.id);
    }
  }
}
