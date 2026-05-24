export interface IngestionSource {
  type: 'file' | 'url' | 'clipboard';
  mimeType: string;
  name: string;
  data: ArrayBuffer | string;
  size: number;
}

export type SourceLocation =
  | { type: 'page'; page: number; section?: string }
  | { type: 'region'; description: string }
  | { type: 'time'; timestamp: string; speaker?: string }
  | { type: 'selector'; selector: string };

export type ProcessingMode = 'quick' | 'full' | 'section';

export interface ContentChunk {
  text: string;
  location: SourceLocation;
  index: number;
}

export interface ProcessedContent {
  text: string;
  chunks?: ContentChunk[];
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    dimensions?: { w: number; h: number };
  };
}

export interface ModePromptResult {
  prompt: boolean;
  reason?: string;
  estimatedCost?: string;
}

export interface ContentProcessor {
  id: string;
  supportedMimeTypes: string[];
  supportedExtensions: string[];

  canProcess(source: IngestionSource): boolean;
  shouldPromptMode(source: IngestionSource): ModePromptResult;
  preprocess(
    source: IngestionSource,
    mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<ProcessedContent>;
  getExtractionContext?(): string;
  storeSource?(
    source: IngestionSource,
    nodeId: string,
  ): Promise<{ vaultPath: string }>;
}
