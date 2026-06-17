import { create } from 'zustand';
import type { ReadingListResource, ResourceSource, ResourceError } from '../../shared/reading-list-types';
import { migrateReadingListItem } from '../../shared/reading-list-types';
import { extractionProgress } from '../../core/extraction-progress-service';
import { findSimilarityMatches, type ExistingNodeInfo } from '../../core/similarity-service';
import type { ReadingListItem } from '../../shared/types';
import { storage, browser, platformId, llm, vaultWorkspace } from '@platform';
import { readingListExtractionSchema, type ReadingListExtractionResult } from '../../shared/schema';

interface ReadingListStore {
  items: Record<string, ReadingListResource>;
  loading: boolean;
  selectedId: string | null;
  selectedIds: string[];

  loadFromStorage: () => Promise<void>;
  startSyncListener: () => () => void;

  selectItem: (id: string | null) => void;
  toggleSelectId: (id: string) => void;
  selectAllPending: () => void;
  clearSelection: () => void;
  addResource: (source: ResourceSource, title: string) => Promise<void>;
  fetchTitles: (ids: string[]) => Promise<void>;
  startBatchExtraction: () => void;
  retryResource: (id: string) => Promise<void>;
  markComplete: (id: string) => void;
  removeItem: (id: string) => void;
}

function generateFileId(): string {
  return `file-${crypto.randomUUID()}`;
}

function migrateItems(raw: Record<string, any>): Record<string, ReadingListResource> {
  const result: Record<string, ReadingListResource> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && 'source' in value && 'id' in value) {
      result[key] = value as ReadingListResource;
    } else {
      const migrated = migrateReadingListItem(key, value as ReadingListItem);
      result[migrated.id] = migrated;
    }
  }
  return result;
}

export const useReadingListStore = create<ReadingListStore>((set, get) => ({
  items: {},
  loading: true,
  selectedId: null,
  selectedIds: [],

  loadFromStorage: async () => {
    set({ loading: true });
    try {
      const result = await storage.get('readingListItems') as Record<string, any>;
      const raw = (result.readingListItems as Record<string, any>) ?? {};
      const items = migrateItems(raw);
      set({ items, loading: false });
    } catch (e) {
      console.error('[ReadingListStore] Failed to load from storage:', e);
      set({ loading: false });
    }
  },

  startSyncListener: () => {
    const storageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && changes.readingListItems) {
        const raw = (changes.readingListItems.newValue as Record<string, any>) ?? {};
        const items = migrateItems(raw);
        set({ items });
      }
    };
    const cleanupStorage = storage.onChange(storageListener);

    const messageListener = (message: any) => {
      if (message.type === 'READING_LIST_EXTRACTION_RESULT') {
        const payload = message.payload;
        set((state) => {
          const items = { ...state.items };
          // Find item by URL in source (not by key)
          const item = Object.values(items).find(
            (i) => i.source.kind === 'url' && i.source.url === payload.url,
          );
          if (!item) return state;

          if (payload.success) {
            items[item.id] = {
              ...item,
              status: 'ready',
              extraction: {
                summary: payload.summary,
                keyTopics: payload.keyTopics,
                nodes: payload.nodes,
                edges: payload.edges,
                pageContent: payload.pageContent,
                extractedAt: Date.now(),
              },
              error: undefined,
            };
          } else {
            const prevError = item.error;
            const newError: ResourceError = {
              message: payload.error ?? 'Extraction failed',
              stage: 'extract',
              failedAt: Date.now(),
              attempts: (prevError?.attempts ?? 0) + 1,
            };
            items[item.id] = {
              ...item,
              status: 'pending',
              error: newError,
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

  selectItem: (id) => set({ selectedId: id }),

  toggleSelectId: (id) => set((state) => {
    const idx = state.selectedIds.indexOf(id);
    if (idx >= 0) {
      return { selectedIds: state.selectedIds.filter((i) => i !== id) };
    }
    return { selectedIds: [...state.selectedIds, id] };
  }),

  selectAllPending: () => set((state) => {
    // Only select error-free pending items
    const pendingIds = Object.values(state.items)
      .filter((i) => i.status === 'pending' && !i.error)
      .map((i) => i.id);
    return { selectedIds: pendingIds };
  }),

  clearSelection: () => set({ selectedIds: [] }),

  addResource: async (source, title) => {
    const id = source.kind === 'url' ? source.url.trim() : generateFileId();
    if (!id) return;
    if (get().items[id]) return;

    let targetVaultPath: string | undefined;
    let targetVaultName: string | undefined;
    if (platformId === 'electron') {
      try {
        const status = await vaultWorkspace.getStatus();
        if (status.open) {
          targetVaultPath = status.path;
          targetVaultName = status.name;
        }
      } catch {}
    }

    const resource: ReadingListResource = {
      id,
      source,
      title: title.trim() || id,
      addedAt: Date.now(),
      status: 'pending',
      targetVaultPath,
      targetVaultName,
    };
    set((state) => ({ items: { ...state.items, [id]: resource } }));
    await storage.set({ readingListItems: get().items });
  },

  fetchTitles: async (ids) => {
    if (platformId !== 'electron') return;

    const ipc = (window as any).electronIPC;
    const BAD_TITLES = ['404', 'page not found', 'access denied', 'forbidden', 'not found', 'error', 'untitled'];

    for (const id of ids) {
      const item = get().items[id];
      if (!item || item.source.kind !== 'url') continue;
      if (item.extraction?.pageContent) continue;

      const url = item.source.url;

      try {
        const { html } = await ipc.invoke('fetch-url-content', url);
        if (!html) continue;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rawTitle = doc.querySelector('title')?.textContent?.trim() ?? '';

        const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; } })();
        const isUsable = rawTitle
          && rawTitle.toLowerCase() !== domain.toLowerCase()
          && !BAD_TITLES.some(bad => rawTitle.toLowerCase().includes(bad));

        let resolvedTitle = '';

        if (isUsable) {
          resolvedTitle = rawTitle;
        } else {
          try {
            const configResult = await storage.get('llmConfig') as Record<string, any>;
            const config = configResult.llmConfig;
            if (config?.apiKey) {
              const textContent = doc.body?.textContent?.slice(0, 2000) ?? '';
              if (textContent.trim()) {
                const result = await llm.streamChat({
                  requestId: crypto.randomUUID(),
                  model: config.model,
                  systemPrompt: 'Generate a concise title (about 5-8 words) for this web page content. Return only the title text, nothing else.',
                  messages: [{ role: 'user', content: textContent }],
                }, () => {});
                resolvedTitle = result.textContent.trim();
              }
            }
          } catch {}
        }

        if (resolvedTitle) {
          set((state) => ({
            items: {
              ...state.items,
              [id]: { ...state.items[id], title: resolvedTitle },
            },
          }));
          await storage.set({ readingListItems: get().items });
        }
      } catch {}

      if (ids.indexOf(id) < ids.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  },

  startBatchExtraction: async () => {
    const { items, selectedIds } = get();
    const ids = selectedIds.filter((id) => {
      const item = items[id];
      return item?.status === 'pending' && !item.error;
    });
    set({ selectedIds: [] });

    const configResult = await storage.get('maxParallelExtractions') as Record<string, any>;
    const cap = configResult.maxParallelExtractions ?? 4;

    let active = 0;
    let idx = 0;
    await new Promise<void>((resolve) => {
      const next = () => {
        while (active < cap && idx < ids.length) {
          const id = ids[idx++];
          active++;
          get().retryResource(id).finally(() => {
            active--;
            if (idx >= ids.length && active === 0) resolve();
            else next();
          });
        }
        if (ids.length === 0) resolve();
      };
      next();
    });
  },

  retryResource: async (id) => {
    if (platformId === 'electron') {
      const item = get().items[id];
      if (!item) return;

      set((state) => ({
        items: { ...state.items, [id]: { ...state.items[id], status: 'processing', error: undefined } },
      }));

      try {
        if (item.source.kind !== 'url') {
          throw new Error('File-based extraction not yet supported in retryResource');
        }
        const url = item.source.url;
        const ipc = (window as any).electronIPC;

        const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();

        // Stage: fetch
        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'fetch', statusText: `Fetching ${domain}...` });
        const fetchStart = Date.now();
        const { html, error: fetchError } = await ipc.invoke('fetch-url-content', url);
        if (fetchError || !html) throw new Error(fetchError ?? 'Empty response');
        const fetchKB = (html.length / 1024).toFixed(1);
        extractionProgress.emit({
          type: 'stage-complete', resourceId: id, stage: 'fetch',
          meta: { bytes: html.length, ms: Date.now() - fetchStart },
          statusText: `Retrieved ${fetchKB}KB from ${domain}`,
        });

        // Stage: parse
        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'parse', statusText: 'Parsing HTML content...' });
        const parseStart = Date.now();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const textContent = doc.body?.textContent?.slice(0, 100_000) ?? '';
        if (!textContent.trim()) throw new Error('Page content is empty');
        extractionProgress.emit({
          type: 'stage-complete', resourceId: id, stage: 'parse',
          meta: { chars: textContent.length, ms: Date.now() - parseStart },
          statusText: `Extracted ${textContent.length.toLocaleString()} characters`,
        });

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

        // Stage: extract
        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'extract', statusText: 'Streaming LLM response...' });
        const extractStart = Date.now();
        const result = await llm.streamChat({
          requestId: crypto.randomUUID(),
          model: config.model,
          systemPrompt,
          messages: [{ role: 'user', content: `Page title: ${item.title}\nURL: ${url}\n\nPage content:\n${textContent}` }],
        }, (chunk) => {
          extractionProgress.emit({ type: 'llm-chunk', resourceId: id, text: chunk });
        });
        extractionProgress.emit({
          type: 'stage-complete', resourceId: id, stage: 'extract',
          meta: { ms: Date.now() - extractStart },
        });

        const jsonMatch = result.textContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in LLM response');

        // Stage: validate (with retry loop)
        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'validate', statusText: 'Validating JSON schema...' });
        const validateStart = Date.now();

        let parsed: ReadingListExtractionResult | undefined;
        const MAX_RETRIES = 2;
        let lastError: Error | null = null;
        let rawJson = jsonMatch[0];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            parsed = readingListExtractionSchema.parse(JSON.parse(rawJson));
            break;
          } catch (validationError: any) {
            lastError = validationError;
            if (attempt < MAX_RETRIES) {
              const retryResult = await llm.streamChat({
                requestId: crypto.randomUUID(),
                model: config.model,
                systemPrompt: 'Fix the JSON below so it matches the required schema. Return ONLY the corrected JSON.',
                messages: [{ role: 'user', content: `JSON:\n${rawJson}\n\nValidation error:\n${validationError.message}\n\nFix the JSON and return only valid JSON.` }],
              }, (chunk) => {
                extractionProgress.emit({ type: 'llm-chunk', resourceId: id, text: chunk });
              });
              const retryMatch = retryResult.textContent.match(/\{[\s\S]*\}/);
              if (retryMatch) rawJson = retryMatch[0];
            }
          }
        }
        if (!parsed) throw lastError ?? new Error('Validation failed after retries');

        const nodeCount = parsed.nodes.length;
        const edgeCount = parsed.edges.length;
        extractionProgress.emit({
          type: 'stage-complete', resourceId: id, stage: 'validate',
          meta: { ms: Date.now() - validateStart },
          statusText: `Valid — ${nodeCount} entities, ${edgeCount} relationships`,
        });

        const extractedNodes = parsed.nodes.map((n) => ({ name: n.name, type: n.type ?? 'entity', label: n.label, properties: n.properties, tags: n.tags }));
        const extractedEdges = parsed.edges.map((e) => ({ sourceName: e.sourceName, targetName: e.targetName, label: e.label, type: e.type }));

        // Stage: similarity
        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'similarity', statusText: `Checking ${nodeCount} entities against graph...` });
        const simStart = Date.now();
        let similarityMatches: import('../../shared/reading-list-types').SimilarityMatch[] = [];
        try {
          const { useGraphStore } = await import('./graph-store');
          const graphNodes = useGraphStore.getState().nodes;
          const existingNodes: ExistingNodeInfo[] = graphNodes
            .filter((n) => n.type === 'entity')
            .map((n) => ({ id: n.id, name: n.name, label: n.label, summary: n.summary }));

          let embeddingSearch;
          try {
            const available = await ipc.invoke('embedding:is-available');
            if (available) {
              embeddingSearch = async (text: string, topK: number) => ipc.invoke('embedding:search-similar', text, topK);
            }
          } catch {}

          similarityMatches = await findSimilarityMatches(extractedNodes, existingNodes, embeddingSearch);
        } catch {
          similarityMatches = [];
        }
        const matchCount = similarityMatches.length;
        extractionProgress.emit({
          type: 'stage-complete', resourceId: id, stage: 'similarity',
          meta: { ms: Date.now() - simStart },
          statusText: matchCount > 0 ? `${matchCount} potential match${matchCount > 1 ? 'es' : ''} found` : 'No matches found',
        });

        set((state) => ({
          items: {
            ...state.items,
            [id]: {
              ...state.items[id],
              status: 'ready',
              extraction: {
                summary: parsed.summary,
                keyTopics: parsed.keyTopics,
                nodes: extractedNodes,
                edges: extractedEdges,
                pageContent: textContent,
                extractedAt: Date.now(),
              },
              similarityMatches: similarityMatches.length > 0 ? similarityMatches : undefined,
              error: undefined,
            },
          },
        }));
        await storage.set({ readingListItems: get().items });
      } catch (e: any) {
        console.error('[ReadingListStore] Electron extraction failed:', e);
        const prevItem = get().items[id];
        const prevError = prevItem?.error;
        const newError: ResourceError = {
          message: e.message,
          failedAt: Date.now(),
          attempts: (prevError?.attempts ?? 0) + 1,
        };
        set((state) => ({
          items: { ...state.items, [id]: { ...state.items[id], status: 'pending', error: newError } },
        }));
      }
    } else {
      const item = get().items[id];
      if (item?.source.kind === 'url') {
        (browser as any).sendReadingListRetry(item.source.url).catch(console.error);
      }
    }
  },

  markComplete: async (id) => {
    set((state) => {
      const item = state.items[id];
      if (!item) return state;
      return {
        items: { ...state.items, [id]: { ...item, status: 'complete' as const } },
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    });
    await storage.set({ readingListItems: get().items });
  },

  removeItem: (id) => {
    set((state) => {
      const items = { ...state.items };
      delete items[id];
      return {
        items,
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    });
  },
}));
