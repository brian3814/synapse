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
  autoEmbed: boolean;
  embeddingStrategy: 'basic' | 'graph-aware';
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  providerId: 'onnx-minilm',
  onnxModelQuality: 'quantized',
  autoEmbed: true,
  embeddingStrategy: 'basic',
};

export interface EmbeddingStatus {
  enabled: boolean;
  providerId: string | null;
  totalNodes: number;
  embeddedNodes: number;
  processing: boolean;
  progress?: { done: number; total: number };
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
  onProgress(cb: (progress: { done: number; total: number }) => void): () => void;
}
