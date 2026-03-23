import type { LLMRequestWithKeyMessage } from '../shared/messages';
import type { ToolCall } from '../shared/types';

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge graph extraction assistant. Given text, extract entities (nodes) and relationships (edges) and return them as structured JSON.

Output format:
{
  "nodes": [
    { "name": "Entity Name", "type": "descriptive_type", "properties": { "key": "value" }, "tags": ["domain_tag"] }
  ],
  "edges": [
    { "sourceName": "Source Entity", "targetName": "Target Entity", "label": "relationship_type", "type": "relationship_category" }
  ]
}

Rules:
- Extract the most important entities and relationships
- Use consistent, lowercase relationship labels (e.g., "works_at", "located_in", "created_by")
- Node type must be one of: resource, concept, note
- For resource nodes, include properties.kind (url, image, video, pdf)
- Include a tags array for domain annotations (e.g. ["technology", "ai"])
- Include relevant properties as key-value pairs
- Ensure all edges reference entities that exist in the nodes array by their exact name
- Return ONLY valid JSON, no other text`;

export async function executeLLMRequestStreaming(
  payload: LLMRequestWithKeyMessage['payload'],
  onChunk: (text: string, done: boolean) => void
): Promise<{ content: string }> {
  return await streamAnthropic(payload.apiKey, payload.model, payload.prompt, onChunk, payload.systemPrompt);
}

async function streamAnthropic(
  apiKey: string,
  model: string,
  userPrompt: string,
  onChunk: (text: string, done: boolean) => void,
  customSystemPrompt?: string
): Promise<{ content: string }> {
  const systemPrompt = customSystemPrompt ?? EXTRACTION_SYSTEM_PROMPT;
  const userContent = customSystemPrompt
    ? userPrompt
    : `Extract entities and relationships from the following text:\n\n${userPrompt}`;
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
      messages: [
        { role: 'user', content: userContent },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

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
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          accumulated += parsed.delta.text;
          onChunk(parsed.delta.text, false);
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  onChunk('', true);
  return { content: accumulated };
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
    const error = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${error}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let textContent = '';
  const toolCalls: ToolCall[] = [];
  let stopReason = 'end_turn';

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
            break;
          }
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  return { textContent, toolCalls, stopReason };
}
