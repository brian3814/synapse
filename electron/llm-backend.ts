import { executeLLMRequestStreaming, streamAnthropicWithTools } from '../src/offscreen/llm-executor';
import { AGENT_TOOLS, toAnthropicTools } from '../src/shared/agent-tools';
import { fetchAndCleanContent, isBlockedUrl } from './fetch-utils';
import type { AgentProgressEvent, ExtractionResult } from '../src/shared/types';
import type { AnthropicMessage, AnthropicContentBlock } from '../src/offscreen/llm-executor';
import { StorageBackend } from './storage-backend';

const MAX_ITERATIONS = 15;
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

type BroadcastFn = (message: any) => void;

export async function handleRuntimeMessage(
  message: any,
  broadcast: BroadcastFn,
): Promise<any> {
  const type = message?.type;

  switch (type) {
    case 'LLM_REQUEST':
      handleLLMRequest(message.payload, broadcast);
      return null;

    case 'AGENT_RUN_START':
      handleAgentRun(message.payload, broadcast);
      return null;

    case 'CHAT_LLM_REQUEST':
      handleChatRequest(message.payload, broadcast);
      return null;

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

    const result = await executeLLMRequestStreaming(fullPayload, (text, done) => {
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
    });

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

    recordUsage('simple', payload.model, result.inputTokens, result.outputTokens);
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

    const result = await streamAnthropicWithTools(
      apiKey,
      payload.model,
      payload.systemPrompt,
      payload.messages,
      payload.tools,
      (chunk) => {
        broadcast({ type: 'CHAT_LLM_STREAM', payload: { requestId, textChunk: chunk, done: false } });
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

    recordUsage('chat', payload.model, result.inputTokens, result.outputTokens);
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

    const systemPrompt = getAgentSystemPrompt(notesEnabled ?? false);
    const anthropicTools = toAnthropicTools(AGENT_TOOLS);
    const messages: AnthropicMessage[] = [{ role: 'user', content: userPrompt }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const emitProgress = (event: AgentProgressEvent) => {
      broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event } });
    };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      emitProgress({ type: 'llm_start' });

      let result;
      try {
        result = await streamAnthropicWithTools(
          apiKey, model, systemPrompt, messages, anthropicTools,
          (chunk) => emitProgress({ type: 'llm_chunk', text: chunk }),
        );
      } catch (e: any) {
        emitProgress({ type: 'error', error: e.message });
        return;
      }

      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      emitProgress({ type: 'llm_end', text: result.textContent });

      if (result.toolCalls.length === 0) {
        emitProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
        recordUsage('agent', model, totalInputTokens, totalOutputTokens);
        return;
      }

      const assistantContent: AnthropicContentBlock[] = [];
      if (result.textContent) {
        assistantContent.push({ type: 'text', text: result.textContent });
      }
      for (const tc of result.toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResultBlocks: AnthropicContentBlock[] = [];

      for (const tc of result.toolCalls) {
        emitProgress({ type: 'tool_call', toolCall: tc });

        if (tc.name === 'save_entities') {
          const extractionResult = tc.input as unknown as ExtractionResult;
          emitProgress({ type: 'extraction_complete', extractionResult, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
          emitProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
          recordUsage('agent', model, totalInputTokens, totalOutputTokens);
          return;
        }

        let toolResult: string;
        let toolError: string | undefined;

        const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
        if (!toolDef) {
          toolResult = '';
          toolError = `Unknown tool: ${tc.name}`;
        } else if (toolDef.executionContext === 'content-script') {
          toolResult = '';
          toolError = 'Content script tools are not available in desktop mode. Use fetch_url to read web pages instead.';
        } else if (tc.name === 'fetch_url') {
          const url = tc.input.url as string;
          if (isBlockedUrl(url)) {
            toolResult = '';
            toolError = 'URL is blocked or invalid';
          } else {
            const res = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
            toolResult = res.content;
            toolError = res.error;
          }
        } else {
          toolResult = '';
          toolError = `Tool ${tc.name} cannot be executed in this context`;
        }

        emitProgress({ type: 'tool_result', toolCall: tc, toolResult: toolError ? undefined : toolResult, toolError });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: toolError ? `Error: ${toolError}` : toolResult,
          is_error: !!toolError,
        });
      }

      messages.push({ role: 'user', content: toolResultBlocks });
    }

    emitProgress({ type: 'error', error: 'Max iterations reached without completing extraction' });
  } catch (e: any) {
    broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event: { type: 'error', error: e.message } } });
  }
}

function recordUsage(path: string, model: string, inputTokens: number, outputTokens: number): void {
  if (!storage) return;
  const data = storage.get('usageRecords');
  const records = (data.usageRecords as any[]) ?? [];
  records.push({
    timestamp: Date.now(),
    path,
    model,
    inputTokens,
    outputTokens,
    costCents: computeCostCents(model, inputTokens, outputTokens),
  });
  storage.set({ usageRecords: records });
}

function computeCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
    'claude-3-5-sonnet-20241022': { input: 0.3, output: 1.5 },
    'claude-3-5-haiku-20241022': { input: 0.08, output: 0.4 },
  };
  const rate = rates[model] ?? { input: 0.3, output: 1.5 };
  return (inputTokens / 100_000) * rate.input + (outputTokens / 100_000) * rate.output;
}

function getAgentSystemPrompt(notesEnabled: boolean): string {
  const notesRules = notesEnabled
    ? `\n\nRules for NOTES (enabled):\n- When calling save_entities, include exactly ONE note in the "notes" array — a structured summary of the resource.\n- Title: "Summary: <page title>"\n- The note content MUST be markdown with this structure:\n  1. **TL;DR** section first — 2-3 sentences capturing the core message.\n  2. Then 3-5 **sections** that break down the content by topic/theme.\n  3. Include **markdown tables** where the page contains structured/comparative data.\n  4. Include **images** from the page where relevant using ![description](image_url).\n- Use [[Entity Name]] wikilinks to reference entities from the nodes array.\n- "about" lists 1-3 key entities. "mentions" lists other referenced entities.`
    : '';

  return `You are a knowledge graph extraction agent. Your job is to inspect a web page using the provided tools, then extract entities (nodes) and typed relationships (edges) into a structured knowledge graph.

Workflow:
1. Start by using get_page_metadata to understand the page structure
2. Use get_page_content to read the main content
3. Use more targeted tools if needed
4. If the user asks about linked content, use fetch_url to read linked pages
5. When you have gathered enough information, call save_entities with the extracted nodes and edges

Rules for NODES:
- Do NOT output resource nodes. The system creates them automatically.
- Use the "label" field to categorize semantically. Allowed labels: concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Include relevant properties as key-value pairs.
- Include a "tags" array for domain annotations.

Rules for EDGES:
- Prefer these labels when applicable: subfield_of, part_of, instance_of, created_by, affiliated_with, used_in, builds_on, enables, contradicts, alternative_to, preceded_by.
- Use consistent, lowercase snake_case labels.
- Ensure all edges reference entities in your nodes array by exact name.
- Call save_entities exactly once when done — it is the terminal tool.${notesRules}

Be efficient: don't call tools unnecessarily.`;
}
