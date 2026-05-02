import { executeLLMRequestStreaming, streamAnthropicWithTools } from '../src/offscreen/llm-executor';
import { AGENT_TOOLS } from '../src/shared/agent-tools';
import { fetchAndCleanContent, isBlockedUrl } from './fetch-utils';
import type { AgentProgressEvent } from '../src/shared/types';
import { StorageBackend } from './storage-backend';
import { runAgentLoop as coreRunAgentLoop, type ToolExecutor } from '../src/core/agent-loop';
import { recordUsage as coreRecordUsage, type UsageStore } from '../src/core/usage';
import { withRetry } from '../src/core/retry';

const FETCH_MAX_BYTES = 20_000;

let storage: StorageBackend | null = null;

export function setStorage(s: StorageBackend): void {
  storage = s;
}

async function getApiKey(): Promise<string> {
  if (!storage) throw new Error('Storage not initialized');
  const data = storage.get('llmConfig');
  const key = data.llmConfig?.apiKey;
  if (!key) throw new Error('No API key configured. Go to Settings to add one.');
  return key;
}

function getUsageStore(): UsageStore {
  if (!storage) throw new Error('Storage not initialized');
  const s = storage;
  return {
    get: (key: string) => s.get(key),
    set: (items: Record<string, unknown>) => { s.set(items); },
  };
}

type BroadcastFn = (message: any) => void;

export async function handleRuntimeMessage(
  message: any,
  broadcast: BroadcastFn,
): Promise<any> {
  const type = message?.type;

  switch (type) {
    case 'LLM_REQUEST':
      handleLLMRequest({ ...message.payload, requestId: message.requestId }, broadcast);
      return null;

    case 'AGENT_RUN_START':
      handleAgentRun({ ...message.payload, runId: message.payload?.runId }, broadcast);
      return null;

    case 'CHAT_LLM_REQUEST':
      handleChatRequest({ ...message.payload, requestId: message.payload?.requestId }, broadcast);
      return null;

    case 'FETCH_URL': {
      const { url, maxBytes } = message.payload ?? {};
      const result = await fetchAndCleanContent(url, maxBytes ?? 50_000);
      return result;
    }

    default:
      return null;
  }
}

async function handleLLMRequest(payload: any, broadcast: BroadcastFn): Promise<void> {
  const requestId = payload.requestId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const apiKey = await getApiKey();
    const fullPayload = { ...payload, apiKey };

    let buffer = '';
    const BUFFER_MAX_BYTES = 100;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer) {
        broadcast({ type: 'LLM_STREAM_CHUNK', payload: { requestId, chunk: buffer, done: false } });
        buffer = '';
      }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    };

    const result = await withRetry(
      () => executeLLMRequestStreaming(fullPayload, (text, done) => {
        if (done) {
          flush();
          return;
        }
        buffer += text;
        if (Buffer.byteLength(buffer) >= BUFFER_MAX_BYTES) {
          flush();
        } else if (!flushTimer) {
          flushTimer = setTimeout(flush, 50);
        }
      }),
      {
        onRetryWait: (info) => {
          broadcast({
            type: 'RATE_LIMIT_WAIT',
            payload: { requestId, ...info },
          });
        },
      },
    );

    broadcast({
      type: 'LLM_STREAM_CHUNK',
      payload: {
        requestId,
        chunk: '',
        done: true,
        content: result.content,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: payload.model,
      },
    });

    coreRecordUsage(getUsageStore(), 'simple', payload.model, result.inputTokens, result.outputTokens);
  } catch (e: any) {
    broadcast({
      type: 'LLM_STREAM_CHUNK',
      payload: { requestId, chunk: '', done: true, content: '', error: e.message },
    });
  }
}

async function handleChatRequest(payload: any, broadcast: BroadcastFn): Promise<void> {
  const requestId = payload.requestId;
  try {
    const apiKey = await getApiKey();

    const result = await withRetry(
      () => streamAnthropicWithTools(
        apiKey,
        payload.model,
        payload.systemPrompt,
        payload.messages,
        payload.tools,
        (chunk) => {
          broadcast({ type: 'CHAT_LLM_STREAM', payload: { requestId, textChunk: chunk, done: false } });
        },
      ),
      {
        onRetryWait: (info) => {
          broadcast({
            type: 'RATE_LIMIT_WAIT',
            payload: { requestId, ...info },
          });
        },
      },
    );

    broadcast({
      type: 'CHAT_LLM_STREAM',
      payload: {
        requestId,
        done: true,
        textContent: result.textContent,
        toolCalls: result.toolCalls,
        stopReason: result.stopReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: payload.model,
      },
    });

    coreRecordUsage(getUsageStore(), 'chat', payload.model, result.inputTokens, result.outputTokens);
  } catch (e: any) {
    broadcast({
      type: 'CHAT_LLM_STREAM',
      payload: { requestId, done: true, textContent: '', toolCalls: [], error: e.message },
    });
  }
}

async function handleAgentRun(payload: any, broadcast: BroadcastFn): Promise<void> {
  const { runId, userPrompt, model, notesEnabled } = payload;
  try {
    const apiKey = await getApiKey();

    const toolExecutor: ToolExecutor = {
      async execute(tc) {
        const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
        if (!toolDef) return { result: '', error: `Unknown tool: ${tc.name}` };
        if (toolDef.executionContext === 'content-script') {
          return { result: '', error: 'Content script tools are not available in desktop mode. Use fetch_url to read web pages instead.' };
        }
        if (tc.name === 'fetch_url') {
          const url = tc.input.url as string;
          if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
          const res = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
          return { result: res.content, error: res.error };
        }
        return { result: '', error: `Tool ${tc.name} cannot be executed in this context` };
      },
    };

    const usageStore = getUsageStore();
    await coreRunAgentLoop(
      { runId, userPrompt, apiKey, model, notesEnabled: notesEnabled ?? false },
      streamAnthropicWithTools,
      toolExecutor,
      (event: AgentProgressEvent) => {
        broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event } });
        if (event.type === 'done' && event.inputTokens != null) {
          coreRecordUsage(usageStore, 'agent', model, event.inputTokens, event.outputTokens ?? 0);
        }
      },
    );
  } catch (e: any) {
    broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event: { type: 'error', error: e.message } } });
  }
}

// ─── Dedicated IPC handlers (send directly to requesting renderer) ────────────

type SendFn = (channel: string, ...args: any[]) => void;

export async function handleStreamExtraction(payload: any, send: SendFn): Promise<void> {
  const { requestId, prompt, model, systemPrompt, messages } = payload;
  try {
    const apiKey = await getApiKey();
    const fullPayload = { apiKey, provider: 'anthropic', prompt, model, systemPrompt, messages };

    let buffer = '';
    const BUFFER_MAX_BYTES = 100;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer) {
        send('llm:extraction-chunk', { requestId, chunk: buffer, done: false });
        buffer = '';
      }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    };

    const result = await withRetry(
      () => executeLLMRequestStreaming(fullPayload, (text: string, done: boolean) => {
        if (done) { flush(); return; }
        buffer += text;
        if (Buffer.byteLength(buffer) >= BUFFER_MAX_BYTES) flush();
        else if (!flushTimer) flushTimer = setTimeout(flush, 50);
      }),
      { onRetryWait: (info) => send('llm:extraction-chunk', { requestId, rateLimitWait: info }) },
    );

    send('llm:extraction-chunk', {
      requestId, chunk: '', done: true,
      content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });
    coreRecordUsage(getUsageStore(), 'simple', model, result.inputTokens, result.outputTokens);
  } catch (e: any) {
    send('llm:extraction-chunk', { requestId, chunk: '', done: true, error: e.message });
  }
}

export async function handleRunAgent(payload: any, send: SendFn): Promise<void> {
  const { runId, userPrompt, model, notesEnabled } = payload;
  try {
    const apiKey = await getApiKey();

    const toolExecutor: ToolExecutor = {
      async execute(tc) {
        const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
        if (!toolDef) return { result: '', error: `Unknown tool: ${tc.name}` };
        if (toolDef.executionContext === 'content-script') {
          return { result: '', error: 'Content script tools are not available in desktop mode. Use fetch_url instead.' };
        }
        if (tc.name === 'fetch_url') {
          const url = tc.input.url as string;
          if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
          const res = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
          return { result: res.content, error: res.error };
        }
        return { result: '', error: `Tool ${tc.name} cannot be executed in this context` };
      },
    };

    await coreRunAgentLoop(
      { runId, userPrompt, apiKey, model, notesEnabled: notesEnabled ?? false },
      streamAnthropicWithTools,
      toolExecutor,
      (event: AgentProgressEvent) => {
        send('llm:agent-progress', { runId, event });
        if (event.type === 'done' && event.inputTokens != null) {
          coreRecordUsage(getUsageStore(), 'agent', model, event.inputTokens, event.outputTokens ?? 0);
        }
      },
    );
  } catch (e: any) {
    send('llm:agent-progress', { runId, event: { type: 'error', error: e.message } });
  }
}

export async function handleStreamChat(payload: any, send: SendFn): Promise<void> {
  const { requestId, model, systemPrompt, messages, tools } = payload;
  try {
    const apiKey = await getApiKey();

    const result = await withRetry(
      () => streamAnthropicWithTools(
        apiKey, model, systemPrompt, messages, tools ?? [],
        (chunk: string) => send('llm:chat-chunk', { requestId, textChunk: chunk, done: false }),
      ),
      { onRetryWait: (info) => send('llm:chat-chunk', { requestId, rateLimitWait: info }) },
    );

    send('llm:chat-chunk', {
      requestId, done: true,
      textContent: result.textContent, toolCalls: result.toolCalls,
      stopReason: result.stopReason, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });
    coreRecordUsage(getUsageStore(), 'chat', model, result.inputTokens, result.outputTokens);
  } catch (e: any) {
    send('llm:chat-chunk', { requestId, done: true, textContent: '', toolCalls: [], error: e.message });
  }
}
