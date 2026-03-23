import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
import { nodes, edges, sourceContent } from '../../db/client/db-client';
import { useGraphStore } from '../../graph/store/graph-store';
import type { ChatAgentTurn } from '../../shared/types';
import type { AnthropicMessage, AnthropicContentBlock } from '../../offscreen/llm-executor';

export type { ChatAgentTurn };

export interface ChatAgentProgress {
  type: 'text_chunk' | 'turn' | 'done' | 'error';
  textChunk?: string;
  turn?: ChatAgentTurn;
  finalText?: string;
  error?: string;
}

const MAX_ITERATIONS = 10;
const TOOL_DEFS = toAnthropicChatTools(CHAT_AGENT_TOOLS);

const CHAT_AGENT_SYSTEM_PROMPT = `You are a helpful assistant integrated into a personal knowledge graph browser extension. You have access to tools that let you search, read, and modify the user's knowledge graph.

## Tool Usage Strategy

**For questions about the graph:**
1. Start with search_nodes to find relevant entities
2. Use get_node_details, get_edges_for_node, or get_neighbors to explore connections
3. Use search_sources or get_source_content if the user asks about original source material

**For requests to modify the graph:**
1. First search to check if entities already exist (avoid duplicates)
2. Use create_node / create_edge to add new data
3. Use update_node to modify existing entities
4. Confirm what you created/updated

**When no tools are needed:**
- Answer general questions using your own knowledge
- If the question doesn't relate to the graph, just respond normally

## Response Format
- When mentioning entities from the graph, use [Entity Name](node:entity-id) for clickable links
- Use markdown formatting
- Be concise but thorough
- If search returns no results, say so`;

export { CHAT_AGENT_SYSTEM_PROMPT };

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

interface RunChatAgentParams {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPrompt: string;
  provider: string;
  model: string;
  onProgress: (event: ChatAgentProgress) => void;
}

export async function runChatAgent({
  conversationHistory,
  currentPrompt,
  provider,
  model,
  onProgress,
}: RunChatAgentParams): Promise<string> {
  // Build initial messages: prior turns + current user message
  const messages: AnthropicMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: currentPrompt },
  ];

  let finalText = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Send one LLM call with tools
    const requestId = crypto.randomUUID();
    const result = await sendChatLLMRequest(
      requestId,
      {
        provider,
        model,
        systemPrompt: CHAT_AGENT_SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFS,
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
      onProgress({ type: 'done', finalText });
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
        resultStr = await executeTool(tc.name, tc.input);
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
  onProgress({ type: 'done', finalText });
  return finalText;
}

// ---------------------------------------------------------------------------
// LLM request via chrome.runtime messaging (UI -> SW -> Offscreen -> stream back)
// ---------------------------------------------------------------------------

function sendChatLLMRequest(
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
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ error: 'Chat LLM request timed out after 120s' });
    }, 120_000);

    const listener = (message: any) => {
      if (message.type !== 'CHAT_LLM_STREAM' || message.payload?.requestId !== requestId) return;
      const p = message.payload;

      if (p.textChunk) {
        onProgress({ type: 'text_chunk', textChunk: p.textChunk });
      }

      if (p.done) {
        cleanup();
        if (p.error) {
          resolve({ error: p.error });
        } else {
          resolve({
            textContent: p.textContent,
            toolCalls: p.toolCalls,
            stopReason: p.stopReason,
          });
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
    };

    chrome.runtime.onMessage.addListener(listener);

    // Send request to service worker
    chrome.runtime.sendMessage({
      type: 'CHAT_LLM_REQUEST',
      payload: { requestId, ...payload },
    });
  });
}

// ---------------------------------------------------------------------------
// Tool executor — runs locally in the UI thread against the DB client / graph store
// ---------------------------------------------------------------------------

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_nodes': {
      const results = await nodes.search(input.query as string, (input.limit as number) ?? 10);
      return JSON.stringify(
        (results as any[]).map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          properties: typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties,
        })),
      );
    }

    case 'get_node_details': {
      const node = await nodes.getById(input.nodeId as string);
      if (!node) return JSON.stringify({ error: 'Node not found' });
      return JSON.stringify({
        id: (node as any).id,
        name: (node as any).name,
        type: (node as any).type,
        properties:
          typeof (node as any).properties === 'string'
            ? JSON.parse((node as any).properties)
            : (node as any).properties,
        sourceUrl: (node as any).source_url,
      });
    }

    case 'get_neighbors': {
      const result = await nodes.getNeighborhood(
        input.nodeId as string,
        Math.min((input.hops as number) ?? 1, 3),
      );
      const details = await Promise.all(
        (result as { nodeIds: string[] }).nodeIds.slice(0, 50).map((id: string) => nodes.getById(id)),
      );
      return JSON.stringify(
        details.filter(Boolean).map((n: any) => ({ id: n.id, name: n.name, type: n.type })),
      );
    }

    case 'get_edges_for_node': {
      const edgeList = await edges.getForNode(input.nodeId as string);
      return JSON.stringify(
        (edgeList as any[]).map((e) => ({
          id: e.id,
          sourceId: e.source_id,
          targetId: e.target_id,
          label: e.label,
          type: e.type,
        })),
      );
    }

    case 'search_sources': {
      const results = await sourceContent.search(input.query as string, (input.limit as number) ?? 5);
      return JSON.stringify(
        (results as any[]).map((s) => ({
          nodeId: s.node_id,
          url: s.url,
          title: s.title,
          excerpt: s.content?.substring(0, 500),
        })),
      );
    }

    case 'get_source_content': {
      const sc = await sourceContent.getByNodeId(input.nodeId as string);
      if (!sc) return JSON.stringify({ error: 'No source content found' });
      return JSON.stringify({
        url: (sc as any).url,
        title: (sc as any).title,
        content: (sc as any).content?.substring(0, 5000),
      });
    }

    case 'create_node': {
      const graph = useGraphStore.getState();
      const created = await graph.createNode({
        name: input.name as string,
        type: input.type as string,
        properties: (input.properties as Record<string, unknown>) ?? {},
      });
      if (!created) return JSON.stringify({ error: 'Failed to create node' });
      return JSON.stringify({ id: created.id, name: created.name, type: created.type });
    }

    case 'update_node': {
      const graph = useGraphStore.getState();
      const updated = await graph.updateNode({
        id: input.nodeId as string,
        name: input.name as string | undefined,
        type: input.type as string | undefined,
        properties: (input.properties as Record<string, unknown>) ?? undefined,
      });
      if (!updated) return JSON.stringify({ error: 'Failed to update node' });
      return JSON.stringify({ id: updated.id, name: updated.name });
    }

    case 'create_edge': {
      const graph = useGraphStore.getState();
      const created = await graph.createEdge({
        sourceId: input.sourceId as string,
        targetId: input.targetId as string,
        label: input.label as string,
        type: (input.type as string) ?? 'related',
      });
      if (!created) return JSON.stringify({ error: 'Failed to create edge' });
      return JSON.stringify({ id: created.id, label: created.label });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
