/**
 * Shared agent loop — the LLM tool-use iteration that both Chrome offscreen
 * and Electron main process invoke with platform-specific dependencies injected.
 */

import { AGENT_TOOLS, toAnthropicTools } from '../shared/agent-tools';
import type { AgentProgressEvent, ExtractionResult, ToolCall } from '../shared/types';
import type {
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicToolsResult,
} from '../offscreen/llm-executor';
import { getAgentSystemPrompt } from './system-prompts';

const MAX_ITERATIONS = 15;

export interface ToolExecutor {
  execute(tool: ToolCall): Promise<{ result: string; error?: string }>;
}

export type StreamFn = (
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AnthropicMessage[],
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  onChunk: (text: string) => void,
) => Promise<AnthropicToolsResult>;

export interface AgentLoopConfig {
  runId: string;
  userPrompt: string;
  apiKey: string;
  model: string;
  maxIterations?: number;
  notesEnabled?: boolean;
}

export async function runAgentLoop(
  config: AgentLoopConfig,
  streamFn: StreamFn,
  toolExecutor: ToolExecutor,
  onProgress: (event: AgentProgressEvent) => void,
): Promise<void> {
  const maxIter = config.maxIterations ?? MAX_ITERATIONS;
  const systemPrompt = getAgentSystemPrompt(config.notesEnabled ?? false);
  const anthropicTools = toAnthropicTools(AGENT_TOOLS);
  const messages: AnthropicMessage[] = [{ role: 'user', content: config.userPrompt }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < maxIter; i++) {
    onProgress({ type: 'llm_start' });

    let result: AnthropicToolsResult;
    try {
      result = await streamFn(
        config.apiKey, config.model, systemPrompt,
        messages, anthropicTools,
        (chunk) => onProgress({ type: 'llm_chunk', text: chunk }),
      );
    } catch (e: any) {
      onProgress({ type: 'error', error: e.message });
      return;
    }

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    onProgress({ type: 'llm_end', text: result.textContent });

    // No tool calls — LLM finished without calling save_entities
    if (result.toolCalls.length === 0) {
      onProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: config.model });
      return;
    }

    // Build the assistant message with all content blocks
    const assistantContent: AnthropicContentBlock[] = [];
    if (result.textContent) {
      assistantContent.push({ type: 'text', text: result.textContent });
    }
    for (const tc of result.toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool call and collect results
    const toolResultBlocks: AnthropicContentBlock[] = [];

    for (const tc of result.toolCalls) {
      onProgress({ type: 'tool_call', toolCall: tc });

      // Check for terminal tool
      if (tc.name === 'save_entities') {
        const extractionResult = tc.input as unknown as ExtractionResult;
        onProgress({ type: 'extraction_complete', extractionResult, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: config.model });
        onProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: config.model });
        return;
      }

      const { result: toolResult, error: toolError } = await toolExecutor.execute(tc);

      onProgress({
        type: 'tool_result',
        toolCall: tc,
        toolResult: toolError ? undefined : toolResult,
        toolError,
      });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: toolError ? `Error: ${toolError}` : toolResult,
        is_error: !!toolError,
      });
    }

    // Add all tool results as a single user message
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  onProgress({ type: 'error', error: 'Max iterations reached without completing extraction' });
}
