import type { AgentProgressEvent, ToolCall } from '../shared/types';

export type { PlatformEmbedding } from '../embeddings/types';

export type PlatformId = 'chrome' | 'electron';

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface PlatformStorage {
  get<T = Record<string, unknown>>(keys?: string | string[]): Promise<T>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  onChange(cb: (changes: Record<string, StorageChange>, area: string) => void): () => void;
}

export interface PlatformDB {
  init(): Promise<void>;
  request(action: string, params?: unknown): Promise<unknown>;
  onSync(cb: (event: unknown) => void): () => void;
}

export interface PlatformNotes {
  init(): Promise<void>;
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, markdown: string): Promise<void>;
  remove(nodeId: string): Promise<void>;
  list(): Promise<string[]>;
  exists(nodeId: string): Promise<boolean>;
}

export interface PlatformVault {
  init(): Promise<void>;
  store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }>;
  read(vaultPath: string): Promise<ArrayBuffer>;
  remove(vaultPath: string): Promise<void>;
  getStorageUsage(): Promise<{ bytes: number; fileCount: number }>;
}

export interface PlatformFiles {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface RateLimitInfo {
  retryAfterMs: number;
  retryCount: number;
  maxRetries: number;
}

export interface ExtractionRequest {
  prompt: string;
  model: string;
  systemPrompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface LLMResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRequest {
  runId: string;
  userPrompt: string;
  model: string;
  tabId?: number;
  notesEnabled: boolean;
}

export interface ChatRequest {
  requestId: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}

export interface ChatResult {
  textContent: string;
  toolCalls: ToolCall[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface PlatformLLM {
  streamExtraction(
    request: ExtractionRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<LLMResult>;

  runAgent(
    request: AgentRequest,
    onProgress: (event: AgentProgressEvent) => void,
  ): Promise<void>;

  streamChat(
    request: ChatRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<ChatResult>;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
}

export interface PlatformBrowser {
  getActiveTab(): Promise<TabInfo | null>;
  getPageContent(tabId: number): Promise<string>;
  executeTool(tabId: number, tool: string, params: Record<string, unknown>): Promise<string>;
  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void;
  onReadingQueue(cb: (data: { url: string; title: string }) => void): () => void;
}
