import type { CommandContext } from '../../src/commands/types';
import type { DataStore } from '../../src/db/data-store';
import type { SemanticSearchResult } from '../../src/embeddings/types';
import type { PlatformStorage, PlatformNotes, PlatformFiles, PlatformLLM, PlatformBrowser, PlatformArtifacts } from '../../src/platform/types';

interface MainProcessDeps {
  dataStore: DataStore;
  storage: PlatformStorage;
  readNote: (nodeId: string) => Promise<string | null>;
  writeNote: (nodeId: string, content: string) => Promise<void>;
  artifacts?: PlatformArtifacts;
  embedding?: {
    searchSimilar(query: string, topK?: number): Promise<SemanticSearchResult[]>;
  };
}

export function createMainProcessContext(deps: MainProcessDeps): CommandContext {
  const notesAdapter: PlatformNotes = {
    init: async () => {},
    read: deps.readNote,
    write: deps.writeNote,
    remove: async () => {},
    list: async () => [],
    exists: async () => false,
  };

  const noopFiles: PlatformFiles = {
    read: async () => null,
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };

  const noopLLM: PlatformLLM = {
    streamExtraction: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
    runAgent: async () => {},
    streamChat: async () => ({ textContent: '', toolCalls: [], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0 }),
  } as any;

  const noopBrowser: PlatformBrowser = {
    getActiveTab: async () => null,
    getPageContent: async () => '',
    executeTool: async () => '',
    onPageCapture: () => () => {},
    onReadingQueue: () => () => {},
  } as any;

  return {
    db: deps.dataStore,
    storage: deps.storage,
    notes: notesAdapter,
    files: noopFiles,
    llm: noopLLM,
    browser: noopBrowser,
    artifacts: deps.artifacts,
    embedding: deps.embedding,
    getGraphSnapshot: async () => {
      const nodes = await deps.dataStore.nodes.getAll();
      const edges = await deps.dataStore.edges.getAll();
      return { nodes: nodes as any, edges: edges as any };
    },
  };
}
