import type { StreamFn } from './llm-protocol';

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  pricing?: { inputPer1M: number; outputPer1M: number };
}

export type ExtractionStreamFn = (
  payload: { apiKey: string; provider: string; model: string; prompt: string; systemPrompt?: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }>; notesEnabled?: boolean },
  onChunk: (text: string, done: boolean) => void,
) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;

export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  listModels(apiKey: string): Promise<ModelInfo[]>;
  streamWithTools: StreamFn;
  streamExtraction: ExtractionStreamFn;
  validateKeyFormat(apiKey: string): string | null;
}
