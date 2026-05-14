import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
import { llm, platformId } from '@platform';
import { createUICommandContext } from '../../commands/create-context';
import { executeTool as executeToolCmd } from '../../commands/chat-tool-executor';
import type { ChatAgentTurn } from '../../shared/types';
import type { AnthropicMessage, AnthropicContentBlock } from '../../offscreen/llm-executor';

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

const MAX_ITERATIONS = 10;

const SEMANTIC_SEARCH_TOOL = {
  name: 'semantic_search',
  description: 'Find nodes semantically similar to a query, even without keyword overlap. Use when keyword search returns few results or you need conceptually related nodes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      limit: { type: 'number', description: 'Max results to return (default 5)' },
    },
    required: ['query'],
  },
};

function getToolDefs(disabledTools?: string[]) {
  let defs = [...CHAT_AGENT_TOOLS];

  if (disabledTools?.length) {
    defs = defs.filter((t) => !disabledTools.includes(t.name));
  }

  const tools = toAnthropicChatTools(defs);

  if (platformId === 'electron' && !disabledTools?.includes('semantic_search')) {
    tools.push(SEMANTIC_SEARCH_TOOL);
  }

  return tools;
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
  onProgress,
}: RunChatAgentParams): Promise<string> {
  // Build initial messages: prior turns + current user message
  const userMessage = attachedContext
    ? `${attachedContext}\n\n${currentPrompt}`
    : currentPrompt;

  const messages: AnthropicMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: userMessage },
  ];

  let finalText = '';
  const collectedNodeIds = new Set<string>();
  const collectedEdgeIds = new Set<string>();
  const ctx = createUICommandContext();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Send one LLM call with tools
    const requestId = crypto.randomUUID();
    const result = await sendChatLLMRequest(
      requestId,
      {
        provider,
        model,
        systemPrompt,
        messages,
        tools: getToolDefs(disabledTools),
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
    const assistantContent: AnthropicContentBlock[] = [];
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
    const toolResultBlocks: AnthropicContentBlock[] = [];
    for (const tc of toolCalls) {
      // Emit tool_call turn
      onProgress({
        type: 'turn',
        turn: { type: 'tool_call', content: '', toolName: tc.name, toolInput: tc.input },
      });

      let resultStr: string;
      let isError = false;
      try {
        const toolResult = await executeToolCmd(ctx, tc.name, tc.input);
        resultStr = toolResult.result;
        if (toolResult.collectedNodeIds) for (const id of toolResult.collectedNodeIds) collectedNodeIds.add(id);
        if (toolResult.collectedEdgeIds) for (const id of toolResult.collectedEdgeIds) collectedEdgeIds.add(id);
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
    messages: AnthropicMessage[];
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

