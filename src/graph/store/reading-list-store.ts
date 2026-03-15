import { create } from 'zustand';
import type { ReadingListItem } from '../../shared/types';

interface ReadingListStore {
  items: Record<string, ReadingListItem>; // keyed by URL
  loading: boolean;
  selectedUrl: string | null;

  // Lifecycle
  loadFromStorage: () => Promise<void>;
  startSyncListener: () => () => void; // returns cleanup function

  // Actions
  selectItem: (url: string | null) => void;
  retryExtraction: (url: string) => void;
  removeItem: (url: string) => void;
}

export const useReadingListStore = create<ReadingListStore>((set, get) => ({
  items: {},
  loading: true,
  selectedUrl: null,

  loadFromStorage: async () => {
    set({ loading: true });
    try {
      const result = await chrome.storage.local.get('readingListItems');
      const items = (result.readingListItems as Record<string, ReadingListItem>) ?? {};
      set({ items, loading: false });
    } catch (e) {
      console.error('[ReadingListStore] Failed to load from storage:', e);
      set({ loading: false });
    }
  },

  startSyncListener: () => {
    // Listen for chrome.storage changes (SW writes to readingListItems)
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && changes.readingListItems) {
        const newItems = (changes.readingListItems.newValue as Record<string, ReadingListItem>) ?? {};
        set({ items: newItems });
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    // Also listen for extraction result broadcasts directly (for faster UI update)
    const messageListener = (message: any) => {
      if (message.type === 'READING_LIST_EXTRACTION_RESULT') {
        // The SW will update storage, which triggers storageListener above.
        // But we can also update immediately for faster UI response.
        const payload = message.payload;
        set((state) => {
          const items = { ...state.items };
          const item = items[payload.url];
          if (!item) return state;

          if (payload.success) {
            items[payload.url] = {
              ...item,
              status: 'extracted',
              summary: payload.summary,
              keyTopics: payload.keyTopics,
              extractedNodes: payload.nodes,
              extractedEdges: payload.edges,
              pageContent: payload.pageContent,
              pageTitle: payload.pageTitle,
              extractedAt: Date.now(),
              error: undefined,
            };
          } else {
            items[payload.url] = {
              ...item,
              status: 'failed',
              error: payload.error ?? 'Extraction failed',
            };
          }
          return { items };
        });
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Return cleanup function
    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  },

  selectItem: (url) => set({ selectedUrl: url }),

  retryExtraction: (url) => {
    chrome.runtime.sendMessage({
      type: 'READING_LIST_RETRY',
      payload: { url },
    }).catch(console.error);
  },

  removeItem: (url) => {
    set((state) => {
      const items = { ...state.items };
      delete items[url];
      return {
        items,
        selectedUrl: state.selectedUrl === url ? null : state.selectedUrl,
      };
    });
  },
}));
