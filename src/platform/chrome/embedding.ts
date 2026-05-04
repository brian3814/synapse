import type { PlatformEmbedding, EmbeddingStatus, SemanticSearchResult, SimilarPair, EmbeddingConfig } from '../../embeddings/types';

const NOOP_STATUS: EmbeddingStatus = {
  enabled: false,
  providerId: null,
  totalNodes: 0,
  embeddedNodes: 0,
  processing: false,
};

export class ChromeEmbedding implements PlatformEmbedding {
  async isAvailable(): Promise<boolean> { return false; }
  async getStatus(): Promise<EmbeddingStatus> { return NOOP_STATUS; }
  async configure(_config: Partial<EmbeddingConfig>): Promise<void> {}
  async searchSimilar(_query: string, _topK?: number): Promise<SemanticSearchResult[]> { return []; }
  async searchSimilarByNodeId(_nodeId: string, _topK?: number): Promise<SemanticSearchResult[]> { return []; }
  async findDuplicatePairs(_threshold?: number, _limit?: number): Promise<SimilarPair[]> { return []; }
  async dismissPair(_nodeIdA: string, _nodeIdB: string): Promise<void> {}
  onProgress(_cb: (progress: { done: number; total: number }) => void): () => void { return () => {}; }
}
