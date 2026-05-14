import { create } from 'zustand';
import type { ReadingListItem } from '../../shared/types';
import { storage, browser, platformId, llm } from '@platform';
import { readingListExtractionSchema } from '../../shared/schema';

interface ReadingListStore {
  items: Record<string, ReadingListItem>;
  loading: boolean;
  selectedUrl: string | null;
  selectedUrls: string[];

  loadFromStorage: () => Promise<void>;
  startSyncListener: () => () => void;

  selectItem: (url: string | null) => void;
  toggleSelectUrl: (url: string) => void;
  selectAllPending: () => void;
  clearSelection: () => void;
  addItem: (url: string, title: string, vaultPath: string, vaultName: string) => Promise<void>;
  startBatchExtraction: () => void;
  retryExtraction: (url: string) => Promise<void>;
  markComplete: (url: string) => void;
  removeItem: (url: string) => void;
}

function isProcessing(status: string): boolean {
  return status === 'processing' || status === 'fetching' || status === 'extracting';
}

export const useReadingListStore = create<ReadingListStore>((set, get) => ({
  items: {},
  loading: true,
  selectedUrl: null,
  selectedUrls: [],

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
    const storageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && changes.readingListItems) {
        const newItems = (changes.readingListItems.newValue as Record<string, ReadingListItem>) ?? {};
        set({ items: newItems });
      }
    };
    const cleanupStorage = storage.onChange(storageListener);

    const messageListener = (message: any) => {
      if (message.type === 'READING_LIST_EXTRACTION_RESULT') {
        const payload = message.payload;
        set((state) => {
          const items = { ...state.items };
          const item = items[payload.url];
          if (!item) return state;

          if (payload.success) {
            items[payload.url] = {
              ...item,
              status: 'ready',
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

    return () => {
      cleanupStorage();
      cleanupMessages();
    };
  },

  selectItem: (url) => set({ selectedUrl: url }),

  toggleSelectUrl: (url) => set((state) => {
    const idx = state.selectedUrls.indexOf(url);
    if (idx >= 0) {
      return { selectedUrls: state.selectedUrls.filter((u) => u !== url) };
    }
    return { selectedUrls: [...state.selectedUrls, url] };
  }),

  selectAllPending: () => set((state) => {
    const pendingUrls = Object.values(state.items)
      .filter((i) => i.status === 'pending')
      .map((i) => i.url);
    return { selectedUrls: pendingUrls };
  }),

  clearSelection: () => set({ selectedUrls: [] }),

  addItem: async (url, title, vaultPath, vaultName) => {
    const normalized = url.trim();
    if (!normalized) return;
    if (get().items[normalized]) return;
    const item: ReadingListItem = {
      url: normalized,
      title: title.trim() || normalized,
      addedAt: Date.now(),
      status: 'pending',
      targetVaultPath: vaultPath,
      targetVaultName: vaultName,
    };
    set((state) => ({ items: { ...state.items, [normalized]: item } }));
    await storage.set({ readingListItems: get().items });
  },

  startBatchExtraction: async () => {
    const { items, selectedUrls } = get();
    const urls = selectedUrls.filter((url) => items[url]?.status === 'pending');
    set({ selectedUrls: [] });

    const configResult = await storage.get('maxParallelExtractions') as Record<string, any>;
    const cap = configResult.maxParallelExtractions ?? 4;

    let active = 0;
    let idx = 0;
    await new Promise<void>((resolve) => {
      const next = () => {
        while (active < cap && idx < urls.length) {
          const url = urls[idx++];
          active++;
          get().retryExtraction(url).finally(() => {
            active--;
            if (idx >= urls.length && active === 0) resolve();
            else next();
          });
        }
        if (urls.length === 0) resolve();
      };
      next();
    });
  },

  retryExtraction: async (url) => {
    if (platformId === 'electron') {
      const item = get().items[url];
      if (!item) return;

      set((state) => ({
        items: { ...state.items, [url]: { ...state.items[url], status: 'processing', error: undefined } },
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
              status: 'ready',
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

  markComplete: async (url) => {
    set((state) => {
      const item = state.items[url];
      if (!item) return state;
      return {
        items: { ...state.items, [url]: { ...item, status: 'complete' as const } },
        selectedUrl: state.selectedUrl === url ? null : state.selectedUrl,
      };
    });
    await storage.set({ readingListItems: get().items });
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

export { isProcessing };
