import { registerContextMenus, handleContextMenuClick } from './context-menu';
import { handleMessage } from './message-router';
import { initReadingListSync } from './reading-list-handler';
import { pruneOldRecords } from './usage-tracker';
import { getDisplayMode } from './sidepanel-manager';
import { openExtensionTab } from './tab-manager';

// Register context menus on install
chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  console.log('[SW] Extension installed');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// Handle messages from other contexts
chrome.runtime.onMessage.addListener(handleMessage);

// Sync side panel behavior with stored display mode preference.
// When mode is 'sidePanel', openPanelOnActionClick = true so Chrome
// automatically opens the side panel on icon click (no user gesture issue).
// When mode is 'tab', openPanelOnActionClick = false so onClicked fires
// and we open a tab instead.
async function syncPanelBehavior(): Promise<void> {
  const mode = await getDisplayMode();
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: mode === 'sidePanel' })
    .catch((e: Error) => console.error('[SW] Side panel behavior error:', e));
}

// Set initial behavior on startup
syncPanelBehavior();

// Sync Chrome reading list → background extraction
initReadingListSync();

// Prune old usage records on startup
pruneOldRecords().catch(console.warn);

// Update behavior when display mode preference changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.displayMode) {
    syncPanelBehavior();
  }
});

// onClicked only fires when openPanelOnActionClick is false (tab mode)
chrome.action.onClicked.addListener(async () => {
  await openExtensionTab();
});

console.log('[SW] Service worker loaded');
