import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
import { nodes, edges, sourceContent } from '../../db/client/db-client';
import { useGraphStore } from '../../graph/store/graph-store';
import { retrieveRAGContext, formatRAGPrompt } from './rag-pipeline';
import { read as readNote } from '../../notes/note-store';
import { parseMarkdown } from '../../notes/markdown-utils';
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
const TOOL_DEFS = toAnthropicChatTools(CHAT_AGENT_TOOLS);

const CHAT_AGENT_SYSTEM_PROMPT = `You are a helpful assistant integrated into a personal knowledge graph browser extension. You have access to tools that let you search, read, and modify the user's knowledge graph.

## Citation Rules (MANDATORY)
- When referencing information from the knowledge graph, you MUST cite the source URL using [Source: url] format.
- When mentioning ANY entity from the graph, ALWAYS use the clickable format: [Entity Name](node:entity-id). The entity-id comes from the id field in tool results.
- Every factual claim from the knowledge graph should be traceable to a source or entity.
- If a tool result includes source URLs, cite them in your answer.

## Tool Usage Strategy

**For knowledge questions ("What do I know about X?", "Tell me about X"):**
1. Start with search_knowledge — it finds entities, expands to connected neighbors, and retrieves source content in one call
2. If you need more detail on a specific entity, follow up with get_node_details or get_neighbors
3. If you need the full source text, use get_source_content

**For graph exploration ("How does X connect to Y?", "What's related to X?"):**
1. Use search_nodes to find starting entities
2. Use get_neighbors or get_edges_for_node to trace connections
3. Explain the paths you find

**For requests to modify the graph:**
1. First search to check if entities already exist (avoid duplicates)
2. Use create_node / create_edge to add new data
3. Use update_node to modify existing entities
4. Confirm what you created/updated

**When no tools are needed:**
- Answer general questions using your own knowledge
- If the question doesn't relate to the graph, just respond normally

## Response Format
- Use [Entity Name](node:entity-id) for EVERY entity you mention from the graph
- Use [Source: url] for EVERY source you reference
- Use markdown formatting (bold, lists, headers)
- Be concise but thorough
- If search returns no results, say so clearly`;

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
  const collectedNodeIds = new Set<string>();
  const collectedEdgeIds = new Set<string>();

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
        resultStr = await executeTool(tc.name, tc.input);
        // Collect node/edge IDs from tool results for subgraph tracking
        collectIdsFromToolResult(tc.name, resultStr, tc.input, collectedNodeIds, collectedEdgeIds);
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

// Store last RAG context for ID extraction (avoids parsing formatted text)
let lastRAGNodeIds: string[] = [];
let lastRAGEdgeIds: string[] = [];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_knowledge': {
      const context = await retrieveRAGContext(input.query as string);
      lastRAGNodeIds = context.relevantNodes.map((n) => n.id);
      lastRAGEdgeIds = context.relevantEdges.map((e) => e.id);
      return formatRAGPrompt(context);
    }

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
      const nodeId = input.nodeId as string;
      // Notes: read from OPFS
      const targetNode = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
      if (targetNode?.type === 'note') {
        const md = await readNote(nodeId);
        if (md) {
          const parsed = parseMarkdown(md);
          return JSON.stringify({
            url: `note://${nodeId}`,
            title: targetNode.name,
            content: parsed.content.substring(0, 5000),
          });
        }
      }
      // Resources: read from source_content
      const sc = await sourceContent.getByNodeId(nodeId);
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

function collectIdsFromToolResult(
  toolName: string,
  resultStr: string,
  input: Record<string, unknown>,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
) {
  try {
    if (toolName === 'search_knowledge') {
      for (const id of lastRAGNodeIds) nodeIds.add(id);
      for (const id of lastRAGEdgeIds) edgeIds.add(id);
      return;
    }

    const data = JSON.parse(resultStr);
    if (data?.error) return;

    switch (toolName) {
      case 'search_nodes':
      case 'get_neighbors':
        if (Array.isArray(data)) {
          for (const item of data) if (item.id) nodeIds.add(item.id);
        }
        break;
      case 'get_node_details':
        if (data.id) nodeIds.add(data.id);
        break;
      case 'get_edges_for_node':
        if (Array.isArray(data)) {
          for (const e of data) {
            if (e.id) edgeIds.add(e.id);
            if (e.sourceId) nodeIds.add(e.sourceId);
            if (e.targetId) nodeIds.add(e.targetId);
          }
        }
        break;
      case 'search_sources':
        if (Array.isArray(data)) {
          for (const s of data) if (s.nodeId) nodeIds.add(s.nodeId);
        }
        break;
      case 'get_source_content':
        if (input.nodeId) nodeIds.add(input.nodeId as string);
        break;
      case 'create_node':
      case 'update_node':
        if (data.id) nodeIds.add(data.id);
        break;
      case 'create_edge':
        if (data.id) edgeIds.add(data.id);
        break;
    }
  } catch {
    // Non-JSON result or parse error — skip ID collection
  }
}
