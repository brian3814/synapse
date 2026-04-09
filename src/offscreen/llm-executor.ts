import type { LLMRequestWithKeyMessage } from '../shared/messages';
import type { ToolCall } from '../shared/types';
import { LLMApiError } from '../shared/llm-errors';

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge graph extraction assistant. Given text, extract entities (nodes) and relationships (edges) and return them as structured JSON.

Output format:
{
  "nodes": [
    { "name": "Entity Name", "label": "semantic_label", "properties": { "key": "value" }, "tags": ["domain_tag"] }
  ],
  "edges": [
    { "sourceName": "Source Entity", "targetName": "Target Entity", "label": "relationship_label" }
  ]
}

Rules for NODES:
- Do NOT output resource nodes — the system creates them automatically. Every node is an entity.
- Use the "label" field to categorize each node semantically. Allowed labels:
  concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Include relevant properties as key-value pairs.
- Include a "tags" array for domain annotations (e.g. ["technology", "ai"]).

Rules for EDGES:
- Use consistent, lowercase relationship labels (e.g., "works_at", "located_in", "created_by").
- Prefer these seed labels when applicable: subfield_of, part_of, instance_of, created_by,
  affiliated_with, used_in, builds_on, enables, contradicts, alternative_to, preceded_by.
- Ensure all edges reference entities that exist in the nodes array by their exact name.

Return ONLY valid JSON, no other text.`;

export async function executeLLMRequestStreaming(
  payload: LLMRequestWithKeyMessage['payload'],
  onChunk: (text: string, done: boolean) => void
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  return await streamAnthropic(payload.apiKey, payload.model, payload.prompt, onChunk, payload.systemPrompt, payload.messages);
}

async function streamAnthropic(
  apiKey: string,
  model: string,
  userPrompt: string,
  onChunk: (text: string, done: boolean) => void,
  customSystemPrompt?: string,
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const systemPrompt = customSystemPrompt ?? EXTRACTION_SYSTEM_PROMPT;
  const userContent = customSystemPrompt
    ? userPrompt
    : `Extract entities and relationships from the following text:\n\n${userPrompt}`;

  // Build messages array: prior conversation history + current prompt
  const messages: Array<{ role: string; content: string }> = [];
  if (priorMessages && priorMessages.length > 0) {
    messages.push(...priorMessages);
  }
  messages.push({ role: 'user', content: userContent });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey.startsWith('sk-ant-')
        ? { 'x-api-key': apiKey, 'anthropic-dangerous-direct-browser-access': 'true' }
        : { 'Authorization': `Bearer ${apiKey}` }),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'message_start' && parsed.message?.usage) {
          inputTokens = parsed.message.usage.input_tokens ?? 0;
        } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          accumulated += parsed.delta.text;
          onChunk(parsed.delta.text, false);
        } else if (parsed.type === 'message_delta' && parsed.usage) {
          outputTokens = parsed.usage.output_tokens ?? 0;
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  onChunk('', true);
  return { content: accumulated, inputTokens, outputTokens };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicToolsResult {
  textContent: string;
  toolCalls: ToolCall[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export async function streamAnthropicWithTools(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AnthropicMessage[],
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  onTextChunk: (text: string) => void
): Promise<AnthropicToolsResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey.startsWith('sk-ant-')
        ? { 'x-api-key': apiKey, 'anthropic-dangerous-direct-browser-access': 'true' }
        : { 'Authorization': `Bearer ${apiKey}` }),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let textContent = '';
  const toolCalls: ToolCall[] = [];
  let stopReason = 'end_turn';
  let inputTokens = 0;
  let outputTokens = 0;

  // Track tool_use blocks being built
  let currentToolId = '';
  let currentToolName = '';
  let currentToolInputJson = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      try {
        const parsed = JSON.parse(data);

        switch (parsed.type) {
          case 'message_start': {
            if (parsed.message?.usage) {
              inputTokens = parsed.message.usage.input_tokens ?? 0;
            }
            break;
          }
          case 'content_block_start': {
            if (parsed.content_block?.type === 'tool_use') {
              currentToolId = parsed.content_block.id;
              currentToolName = parsed.content_block.name;
              currentToolInputJson = '';
            }
            break;
          }
          case 'content_block_delta': {
            if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
              textContent += parsed.delta.text;
              onTextChunk(parsed.delta.text);
            } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json) {
              currentToolInputJson += parsed.delta.partial_json;
            }
            break;
          }
          case 'content_block_stop': {
            if (currentToolId) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(currentToolInputJson || '{}');
              } catch { /* default to empty */ }
              toolCalls.push({ id: currentToolId, name: currentToolName, input });
              currentToolId = '';
              currentToolName = '';
              currentToolInputJson = '';
            }
            break;
          }
          case 'message_delta': {
            if (parsed.delta?.stop_reason) {
              stopReason = parsed.delta.stop_reason;
            }
            if (parsed.usage?.output_tokens) {
              outputTokens = parsed.usage.output_tokens;
            }
            break;
          }
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  return { textContent, toolCalls, stopReason, inputTokens, outputTokens };
}

async function buildApiError(response: Response): Promise<LLMApiError> {
  const errorText = await response.text();
  let errorType: LLMApiError['errorType'] = 'api_error';
  let retryAfterMs: number | undefined;

  if (response.status === 429) {
    errorType = 'rate_limit';
    const retryHeader = response.headers.get('retry-after');
    retryAfterMs = retryHeader ? parseInt(retryHeader, 10) * 1000 : 30_000;
  } else if (response.status === 529) {
    errorType = 'overloaded';
    retryAfterMs = 30_000;
  }

  return new LLMApiError(errorType, response.status, errorText, retryAfterMs);
}
