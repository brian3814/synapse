import type { PlatformEmbedding, EmbeddingStatus, EmbeddingConfig, SemanticSearchResult, SimilarPair } from '../../embeddings/types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronEmbedding implements PlatformEmbedding {
  async isAvailable(): Promise<boolean> {
    return window.electronIPC.invoke('embedding:is-available') as Promise<boolean>;
  }

  async getStatus(): Promise<EmbeddingStatus> {
    return window.electronIPC.invoke('embedding:get-status') as Promise<EmbeddingStatus>;
  }

  async configure(config: Partial<EmbeddingConfig>): Promise<void> {
    await window.electronIPC.invoke('embedding:configure', config);
  }

  async searchSimilar(query: string, topK = 5): Promise<SemanticSearchResult[]> {
    return window.electronIPC.invoke('embedding:search-similar', query, topK) as Promise<SemanticSearchResult[]>;
  }

  async searchSimilarByNodeId(nodeId: string, topK = 5): Promise<SemanticSearchResult[]> {
    return window.electronIPC.invoke('embedding:search-similar-by-node', nodeId, topK) as Promise<SemanticSearchResult[]>;
  }

  async findDuplicatePairs(threshold?: number, limit?: number): Promise<SimilarPair[]> {
    return window.electronIPC.invoke('embedding:find-duplicate-pairs', threshold, limit) as Promise<SimilarPair[]>;
  }

  async dismissPair(nodeIdA: string, nodeIdB: string): Promise<void> {
    await window.electronIPC.invoke('embedding:dismiss-pair', nodeIdA, nodeIdB);
  }

  onProgress(cb: (progress: { done: number; total: number }) => void): () => void {
    return window.electronIPC.on('embedding:progress', cb as (...args: unknown[]) => void);
  }
}
