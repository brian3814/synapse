import { llm, platformId } from '@platform';
import { createUICommandContext } from '../../commands/create-context';
import { executeTool as executeToolCmd } from '../../commands/chat-tool-executor';
import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
import type { ChatAgentTurn } from '../../shared/types';
import type { LLMMessage, ContentBlock } from '../../core/llm-protocol';

export type { ChatAgentTurn };

export interface ChatSubgraphData {
  nodeIds: string[];
  edgeIds: string[];
}

export interface ChatAgentProgress {
  type: 'text_chunk' | 'turn' | 'done' | 'error';
  textChunk?: string;
  turn?: ChatAgentTurn;
  finalText?: string;
  subgraph?: ChatSubgraphData;
  error?: string;
}

import { DEFAULT_CHAT_MAX_ITERATIONS } from '../../shared/agent-settings-types';

async function getToolDefs(disabledTools?: string[]): Promise<Array<{ name: string; description: string; input_schema: Record<string, unknown> }>> {
  if (platformId === 'electron') {
    const toolDefs = await (window as any).electronIPC.invoke('tools:list', { disabledTools: disabledTools ?? [] });
    return toolDefs.map((t: any) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  // Chrome fallback
  let defs = [...CHAT_AGENT_TOOLS];
  if (disabledTools?.length) {
    defs = defs.filter((t) => !disabledTools.includes(t.name));
  }
  return toAnthropicChatTools(defs);
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

interface RunChatAgentParams {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPrompt: string;
  attachedContext?: string;
  provider: string;
  model: string;
  systemPrompt: string;
  disabledTools?: string[];
  maxIterations?: number;
  onProgress: (event: ChatAgentProgress) => void;
}

export async function runChatAgent({
  conversationHistory,
  currentPrompt,
  attachedContext,
  provider,
  model,
  systemPrompt,
  disabledTools,
  maxIterations,
  onProgress,
}: RunChatAgentParams): Promise<string> {
  const iterLimit = maxIterations ?? DEFAULT_CHAT_MAX_ITERATIONS;

  const userMessage = attachedContext
    ? `${attachedContext}\n\n${currentPrompt}`
    : currentPrompt;

  const messages: LLMMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: userMessage },
  ];

  let finalText = '';
  const collectedNodeIds = new Set<string>();
  const collectedEdgeIds = new Set<string>();
  const ctx = platformId !== 'electron' ? createUICommandContext() : null;
  const tools = await getToolDefs(disabledTools);

  for (let i = 0; i < iterLimit; i++) {
    // Send one LLM call with tools
    const requestId = crypto.randomUUID();
    const result = await sendChatLLMRequest(
      requestId,
      {
        provider,
        model,
        systemPrompt,
        messages,
        tools,
      },
      onProgress,
    );

    if (result.error) {
      onProgress({ type: 'error', error: result.error });
      throw new Error(result.error);
    }

    const { textContent, toolCalls, stopReason: _stopReason } = result;

    // If no tool calls, we're done
    if (!toolCalls || toolCalls.length === 0) {
      finalText = textContent || '';
      onProgress({
        type: 'done',
        finalText,
        subgraph: { nodeIds: [...collectedNodeIds], edgeIds: [...collectedEdgeIds] },
      });
      return finalText;
    }

    // Build assistant message with text + tool_use blocks
    const assistantContent: ContentBlock[] = [];
    if (textContent) {
      assistantContent.push({ type: 'text', text: textContent });
      // Emit thinking turn
      onProgress({ type: 'turn', turn: { type: 'thinking', content: textContent } });
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute tools and build tool_result blocks
    const toolResultBlocks: ContentBlock[] = [];
    for (const tc of toolCalls) {
      // Emit tool_call turn
      onProgress({
        type: 'turn',
        turn: { type: 'tool_call', content: '', toolName: tc.name, toolInput: tc.input },
      });

      let resultStr: string;
      let isError = false;
      try {
        if (platformId === 'electron') {
          const toolResult = await (window as any).electronIPC.invoke('tools:execute', {
            name: tc.name,
            input: tc.input,
          });
          resultStr = toolResult.result;
          isError = toolResult.isError ?? false;
          if (toolResult.collectedNodeIds) for (const id of toolResult.collectedNodeIds) collectedNodeIds.add(id);
          if (toolResult.collectedEdgeIds) for (const id of toolResult.collectedEdgeIds) collectedEdgeIds.add(id);
        } else {
          const toolResult = await executeToolCmd(ctx!, tc.name, tc.input);
          resultStr = toolResult.result;
          if (toolResult.collectedNodeIds) for (const id of toolResult.collectedNodeIds) collectedNodeIds.add(id);
          if (toolResult.collectedEdgeIds) for (const id of toolResult.collectedEdgeIds) collectedEdgeIds.add(id);
        }
      } catch (e: any) {
        resultStr = JSON.stringify({ error: e.message });
        isError = true;
      }

      // Emit tool_result turn
      onProgress({
        type: 'turn',
        turn: { type: 'tool_result', content: resultStr, toolName: tc.name, isError },
      });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: resultStr,
        ...(isError ? { is_error: true } : {}),
      });
    }

    // Add user message with all tool results
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Max iterations reached
  finalText = 'I reached the maximum number of tool calls. Here is what I found so far.';
  onProgress({
    type: 'done',
    finalText,
    subgraph: { nodeIds: [...collectedNodeIds], edgeIds: [...collectedEdgeIds] },
  });
  return finalText;
}

// ---------------------------------------------------------------------------
// LLM request via platform abstraction
// ---------------------------------------------------------------------------

async function sendChatLLMRequest(
  requestId: string,
  payload: {
    provider: string;
    model: string;
    systemPrompt: string;
    messages: LLMMessage[];
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  },
  onProgress: (event: ChatAgentProgress) => void,
): Promise<{
  textContent?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason?: string;
  error?: string;
}> {
  try {
    const result = await llm.streamChat(
      {
        requestId,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
        messages: payload.messages,
        tools: payload.tools,
      },
      (textChunk) => {
        onProgress({ type: 'text_chunk', textChunk });
      },
    );
    return {
      textContent: result.textContent,
      toolCalls: result.toolCalls,
      stopReason: result.stopReason,
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

