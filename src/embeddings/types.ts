export interface EmbeddingProvider {
  id: string;
  name: string;
  dimensions: number;
  maxTokens: number;

  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isAvailable(): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface EmbeddingConfig {
  enabled: boolean;
  providerId: string;
  onnxModelQuality: 'quantized' | 'full';
  openaiApiKey?: string;
  openaiModel?: string;
  similarityThreshold: number;
  autoEmbed: boolean;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  providerId: 'onnx-minilm',
  onnxModelQuality: 'quantized',
  similarityThreshold: 0.80,
  autoEmbed: true,
};

export interface EmbeddingStatus {
  enabled: boolean;
  providerId: string | null;
  totalNodes: number;
  embeddedNodes: number;
  processing: boolean;
  progress?: { done: number; total: number };
}

export interface SimilarPair {
  nodeA: {
    id: string;
    name: string;
    type: string;
    label: string | null;
    connectionCount: number;
    summary: string | null;
  };
  nodeB: {
    id: string;
    name: string;
    type: string;
    label: string | null;
    connectionCount: number;
    summary: string | null;
  };
  similarity: number;
}

export interface SemanticSearchResult {
  nodeId: string;
  score: number;
}

export interface PlatformEmbedding {
  isAvailable(): Promise<boolean>;
  getStatus(): Promise<EmbeddingStatus>;
  configure(config: Partial<EmbeddingConfig>): Promise<void>;
  searchSimilar(query: string, topK?: number): Promise<SemanticSearchResult[]>;
  searchSimilarByNodeId(nodeId: string, topK?: number): Promise<SemanticSearchResult[]>;
  findDuplicatePairs(threshold?: number, limit?: number): Promise<SimilarPair[]>;
  dismissPair(nodeIdA: string, nodeIdB: string): Promise<void>;
  onProgress(cb: (progress: { done: number; total: number }) => void): () => void;
}
