import type { ToolCall } from '../shared/types';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LLMStreamResult {
  textContent: string;
  toolCalls: ToolCall[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export type ToolSchema = { name: string; description: string; input_schema: Record<string, unknown> };

export type StreamFn = (
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: LLMMessage[],
  tools: ToolSchema[],
  onChunk: (text: string) => void,
) => Promise<LLMStreamResult>;
