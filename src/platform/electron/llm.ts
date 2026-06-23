import type { PlatformLLM, ExtractionRequest, LLMResult, AgentRequest, ChatRequest, ChatResult, RateLimitInfo } from '../types';
import type { AgentProgressEvent } from '../../shared/types';
import type { ModelInfo } from '../../core/model-provider';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ElectronLLM implements PlatformLLM {
  async streamExtraction(
    request: ExtractionRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<LLMResult> {
    const requestId = generateId();
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:extraction-chunk', (data: unknown) => {
        const d = data as any;
        if (d.requestId !== requestId) return;
        if (d.rateLimitWait) { onRateLimitWait?.(d.rateLimitWait); return; }
        if (d.chunk) onChunk(d.chunk);
        if (d.done) {
          cleanup();
          if (d.error) { reject(new Error(d.error)); return; }
          resolve({ content: d.content ?? '', inputTokens: d.inputTokens ?? 0, outputTokens: d.outputTokens ?? 0 });
        }
      });
      window.electronIPC.invoke('llm:stream-extraction', { requestId, ...request }).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async runAgent(
    request: AgentRequest,
    onProgress: (event: AgentProgressEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:agent-progress', (data: unknown) => {
        const d = data as any;
        if (d.runId !== request.runId) return;
        onProgress(d.event);
        if (d.event.type === 'done' || d.event.type === 'error') {
          cleanup();
          if (d.event.type === 'error') reject(new Error(d.event.error));
          else resolve();
        }
      });
      window.electronIPC.invoke('llm:run-agent', request).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<ChatResult> {
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:chat-chunk', (data: unknown) => {
        const d = data as any;
        if (d.requestId !== request.requestId) return;
        if (d.rateLimitWait) { onRateLimitWait?.(d.rateLimitWait); return; }
        if (d.textChunk) onChunk(d.textChunk);
        if (d.done) {
          cleanup();
          if (d.error) { reject(new Error(d.error)); return; }
          resolve({
            textContent: d.textContent ?? '',
            toolCalls: d.toolCalls ?? [],
            stopReason: d.stopReason ?? 'end_turn',
            inputTokens: d.inputTokens ?? 0,
            outputTokens: d.outputTokens ?? 0,
          });
        }
      });
      window.electronIPC.invoke('llm:stream-chat', request).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async listProviders(): Promise<Array<{ id: string; label: string }>> {
    return window.electronIPC.invoke('llm:list-providers') as Promise<Array<{ id: string; label: string }>>;
  }

  async listModels(providerId: string, apiKey: string): Promise<ModelInfo[]> {
    return window.electronIPC.invoke('llm:list-models', providerId, apiKey) as Promise<ModelInfo[]>;
  }
}
