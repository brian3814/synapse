import type { PlatformLLM, ExtractionRequest, LLMResult, AgentRequest, ChatRequest, ChatResult, RateLimitInfo } from '../types';
import type { AgentProgressEvent } from '../../shared/types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ChromeLLM implements PlatformLLM {
  async streamExtraction(
    request: ExtractionRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<LLMResult> {
    const requestId = generateId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('LLM stream timed out after 120s'));
      }, 120_000);

      const listener = (message: any) => {
        if (message.type === 'RATE_LIMIT_WAIT' && message.payload?.requestId === requestId) {
          onRateLimitWait?.(message.payload);
          return;
        }
        if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
        const { chunk, done, content, error, errorType, inputTokens, outputTokens } = message.payload;
        if (chunk) onChunk(chunk);
        if (done) {
          // Rate-limit errors are retried by the service worker — don't resolve yet
          if (error && (errorType === 'rate_limit' || errorType === 'overloaded')) return;
          cleanup();
          if (error) { reject(new Error(error)); return; }
          resolve({ content: content ?? '', inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 });
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          prompt: request.prompt,
          model: request.model,
          systemPrompt: request.systemPrompt,
          messages: request.messages,
        },
      });
    });
  }

  async runAgent(
    request: AgentRequest,
    onProgress: (event: AgentProgressEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const listener = (message: any) => {
        if (message.type !== 'AGENT_PROGRESS' || message.payload?.runId !== request.runId) return;
        const event: AgentProgressEvent = message.payload.event;
        onProgress(event);
        if (event.type === 'done' || event.type === 'error') {
          chrome.runtime.onMessage.removeListener(listener);
          if (event.type === 'error') reject(new Error(event.error));
          else resolve();
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'AGENT_RUN_START',
        payload: {
          runId: request.runId,
          userPrompt: request.userPrompt,
          model: request.model,
          tabId: request.tabId,
          notesEnabled: request.notesEnabled,
        },
      });
    });
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<ChatResult> {
    return new Promise((resolve, reject) => {
      const listener = (message: any) => {
        if (message.type === 'RATE_LIMIT_WAIT' && message.payload?.requestId === request.requestId) {
          onRateLimitWait?.(message.payload);
          return;
        }
        if (message.type !== 'CHAT_LLM_STREAM' || message.payload?.requestId !== request.requestId) return;
        const { textChunk, done, textContent, toolCalls, stopReason, error, errorType, inputTokens, outputTokens } = message.payload;
        if (textChunk) onChunk(textChunk);
        if (done) {
          if (error && (errorType === 'rate_limit' || errorType === 'overloaded')) return;
          chrome.runtime.onMessage.removeListener(listener);
          if (error) { reject(new Error(error)); return; }
          resolve({
            textContent: textContent ?? '',
            toolCalls: toolCalls ?? [],
            stopReason: stopReason ?? 'end_turn',
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
          });
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'CHAT_LLM_REQUEST',
        payload: {
          requestId: request.requestId,
          model: request.model,
          systemPrompt: request.systemPrompt,
          messages: request.messages,
          tools: request.tools,
        },
      });
    });
  }
}
