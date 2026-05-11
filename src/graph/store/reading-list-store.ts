import { create } from 'zustand';
import type { ReadingListItem } from '../../shared/types';
import { storage, browser, platformId, llm } from '@platform';
import { readingListExtractionSchema } from '../../shared/schema';

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
      const result = await storage.get('readingListItems') as Record<string, any>;
      const items = (result.readingListItems as Record<string, ReadingListItem>) ?? {};
      set({ items, loading: false });
    } catch (e) {
      console.error('[ReadingListStore] Failed to load from storage:', e);
      set({ loading: false });
    }
  },

  startSyncListener: () => {
    // Listen for storage changes (SW writes to readingListItems)
    const storageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && changes.readingListItems) {
        const newItems = (changes.readingListItems.newValue as Record<string, ReadingListItem>) ?? {};
        set({ items: newItems });
      }
    };
    const cleanupStorage = storage.onChange(storageListener);

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
    const cleanupMessages = (browser as any).onRuntimeMessage(messageListener);

    // Return cleanup function
    return () => {
      cleanupStorage();
      cleanupMessages();
    };
  },

  selectItem: (url) => set({ selectedUrl: url }),

  retryExtraction: async (url) => {
    if (platformId === 'electron') {
      const item = get().items[url];
      if (!item) return;

      set((state) => ({
        items: { ...state.items, [url]: { ...state.items[url], status: 'extracting', error: undefined } },
      }));

      try {
        const ipc = (window as any).electronIPC;
        const { html, error: fetchError } = await ipc.invoke('fetch-url-content', url);
        if (fetchError || !html) throw new Error(fetchError ?? 'Empty response');

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const textContent = doc.body?.textContent?.slice(0, 100_000) ?? '';
        if (!textContent.trim()) throw new Error('Page content is empty');

        const configResult = await storage.get('llmConfig') as Record<string, any>;
        const config = configResult.llmConfig;
        if (!config?.apiKey) throw new Error('No API key configured');

        const systemPrompt = `You are a reading assistant. Given a web page's content, produce:
1. A concise 2-3 sentence summary
2. 3-7 key topics as short labels
3. Important entities (nodes) and relationships (edges) for a knowledge graph

Return ONLY valid JSON:
{
  "summary": "...",
  "keyTopics": ["topic1", "topic2"],
  "nodes": [{ "name": "...", "label": "concept", "properties": {}, "tags": [] }],
  "edges": [{ "sourceName": "...", "targetName": "...", "label": "..." }]
}

Rules:
- Every node is an entity with a semantic label: concept, person, organization, technology, event, place, methodology.
- Use consistent, lowercase relationship labels.
- Ensure all edges reference nodes by exact name.`;

        const result = await llm.streamChat({
          requestId: crypto.randomUUID(),
          model: config.model,
          systemPrompt,
          messages: [{ role: 'user', content: `Page title: ${item.title}\nURL: ${url}\n\nPage content:\n${textContent}` }],
        }, () => {});

        const jsonMatch = result.textContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in LLM response');
        const parsed = readingListExtractionSchema.parse(JSON.parse(jsonMatch[0]));

        set((state) => ({
          items: {
            ...state.items,
            [url]: {
              ...state.items[url],
              status: 'extracted',
              summary: parsed.summary,
              keyTopics: parsed.keyTopics,
              extractedNodes: parsed.nodes.map((n) => ({ name: n.name, type: n.type ?? 'entity', properties: n.properties })),
              extractedEdges: parsed.edges.map((e) => ({ sourceName: e.sourceName, targetName: e.targetName, label: e.label })),
              pageContent: textContent,
              pageTitle: item.title,
              extractedAt: Date.now(),
              error: undefined,
            },
          },
        }));
        await storage.set({ readingListItems: get().items });
      } catch (e: any) {
        console.error('[ReadingListStore] Electron extraction failed:', e);
        set((state) => ({
          items: { ...state.items, [url]: { ...state.items[url], status: 'failed', error: e.message } },
        }));
      }
    } else {
      (browser as any).sendReadingListRetry(url).catch(console.error);
    }
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
