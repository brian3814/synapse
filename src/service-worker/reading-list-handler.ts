import { ensureOffscreenDocument } from './offscreen-manager';
import type { ReadingListItem } from '../shared/types';

// Read API key from storage (same pattern as message-router.ts)
async function getApiKeyFromStorage(): Promise<string> {
  const result = await chrome.storage.local.get('llmConfig') as Record<string, any>;
  const key = result.llmConfig?.apiKey;
  if (!key) throw new Error('No API key configured');
  return key;
}

// Read model from storage
async function getModelFromStorage(): Promise<string> {
  const result = await chrome.storage.local.get('llmConfig') as Record<string, any>;
  return result.llmConfig?.model ?? 'claude-sonnet-4-5-20241022';
}

// Get current reading list items from chrome.storage.local
async function getReadingListItems(): Promise<Record<string, ReadingListItem>> {
  const result = await chrome.storage.local.get('readingListItems');
  return (result.readingListItems as Record<string, ReadingListItem>) ?? {};
}

// Save reading list items to chrome.storage.local
async function saveReadingListItems(items: Record<string, ReadingListItem>): Promise<void> {
  await chrome.storage.local.set({ readingListItems: items });
}

// Update badge with count of extracted items ready for review
async function updateBadge(): Promise<void> {
  const items = await getReadingListItems();
  const readyCount = Object.values(items).filter(i => i.status === 'extracted').length;
  if (readyCount > 0) {
    chrome.action.setBadgeText({ text: String(readyCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

export async function triggerExtraction(url: string, title: string): Promise<void> {
  try {
    // Update status to 'extracting'
    const items = await getReadingListItems();
    if (items[url]) {
      items[url].status = 'extracting';
      await saveReadingListItems(items);
    }

    await ensureOffscreenDocument();
    const apiKey = await getApiKeyFromStorage();
    const model = await getModelFromStorage();

    await chrome.runtime.sendMessage({
      type: 'READING_LIST_EXTRACT',
      payload: { url, title, apiKey, model },
    });
  } catch (e: any) {
    console.error('[SW] Failed to trigger extraction:', e);
    const items = await getReadingListItems();
    if (items[url]) {
      items[url].status = 'failed';
      items[url].error = e.message;
      await saveReadingListItems(items);
    }
  }
}

export async function handleExtractionResult(payload: any): Promise<void> {
  const items = await getReadingListItems();
  const item = items[payload.url];
  if (!item) return;

  if (payload.success) {
    item.status = 'extracted';
    item.summary = payload.summary;
    item.keyTopics = payload.keyTopics;
    item.extractedNodes = payload.nodes;
    item.extractedEdges = payload.edges;
    item.pageContent = payload.pageContent;
    item.pageTitle = payload.pageTitle;
    item.extractedAt = Date.now();
    item.error = undefined;
  } else {
    item.status = 'failed';
    item.error = payload.error ?? 'Extraction failed';
  }

  await saveReadingListItems(items);
  await updateBadge();
}

export async function removeFromReadingList(url: string): Promise<void> {
  try {
    await chrome.readingList.removeEntry({ url });
  } catch (e) {
    console.warn('[SW] Failed to remove from Chrome reading list:', e);
  }
  const items = await getReadingListItems();
  delete items[url];
  await saveReadingListItems(items);
  await updateBadge();
}

export function initReadingListSync(): void {
  // Listen for new reading list items
  chrome.readingList.onEntryAdded.addListener(async (entry) => {
    console.log('[SW] Reading list item added:', entry.url);
    const items = await getReadingListItems();

    // Don't re-extract if already tracked
    if (items[entry.url]) return;

    items[entry.url] = {
      url: entry.url,
      title: entry.title,
      addedAt: Date.now(),
      status: 'pending',
    };
    await saveReadingListItems(items);
    await updateBadge();

    // Trigger background extraction
    await triggerExtraction(entry.url, entry.title);
  });

  // Listen for removed items (external removal, e.g. user removed from Chrome UI)
  chrome.readingList.onEntryRemoved.addListener(async (entry) => {
    console.log('[SW] Reading list item removed:', entry.url);
    const items = await getReadingListItems();
    delete items[entry.url];
    await saveReadingListItems(items);
    await updateBadge();
  });

  // Listen for updated items
  chrome.readingList.onEntryUpdated.addListener(async (entry) => {
    console.log('[SW] Reading list item updated:', entry.url);
    const items = await getReadingListItems();
    if (items[entry.url]) {
      items[entry.url].title = entry.title;
    }
    await saveReadingListItems(items);
  });

  // Initial sync on startup
  chrome.readingList.query({}).then(async (entries) => {
    const items = await getReadingListItems();
    let changed = false;

    for (const entry of entries) {
      if (!items[entry.url]) {
        items[entry.url] = {
          url: entry.url,
          title: entry.title,
          addedAt: entry.creationTime ?? Date.now(),
          status: 'pending',
        };
        changed = true;
      }
    }

    if (changed) {
      await saveReadingListItems(items);
      await updateBadge();
      // Trigger extraction for any pending items
      for (const item of Object.values(items)) {
        if (item.status === 'pending') {
          triggerExtraction(item.url, item.title);
        }
      }
    } else {
      await updateBadge();
    }
  }).catch(e => console.error('[SW] Initial reading list sync failed:', e));

  console.log('[SW] Reading list sync initialized');
}
