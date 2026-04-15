import { AGENT_TOOLS, toAnthropicTools } from '../shared/agent-tools';
import type { AgentProgressEvent, ExtractionResult } from '../shared/types';
import {
  streamAnthropicWithTools,
  type AnthropicMessage,
  type AnthropicContentBlock,
} from './llm-executor';
import { isBlockedUrl, fetchAndCleanContent } from './url-utils';

function getAgentSystemPrompt(notesEnabled: boolean): string {
  const notesRules = notesEnabled
    ? `

Rules for NOTES (enabled):
- When calling save_entities, include exactly ONE note in the "notes" array — a structured summary of the resource.
- Title: "Summary: <page title>"
- The note content MUST be markdown with this structure:
  1. **TL;DR** section first — 2-3 sentences capturing the core message.
  2. Then 3-5 **sections** that break down the content by topic/theme. Each section should have a ## heading and a descriptive paragraph.
  3. Include **markdown tables** where the page contains structured/comparative data (features, specs, comparisons, timelines, etc.). Reproduce key tables from the source.
  4. Include **images** from the page where relevant using ![description](image_url). Use the original image URLs from the page. Only include images that add value (diagrams, charts, screenshots), not decorative ones.
- Use [[Entity Name]] wikilinks to reference entities from the nodes array.
- "about" lists 1-3 key entities the note covers. "mentions" lists other referenced entities.
- Entity names in about/mentions must match the nodes array exactly.`
    : '';

  return `You are a knowledge graph extraction agent. Your job is to inspect a web page using the provided tools, then extract entities (nodes) and typed relationships (edges) into a structured knowledge graph.

Workflow:
1. Start by using get_page_metadata to understand the page structure
2. Use get_page_content to read the main content (returns markdown by default, preserving headings, links, tables, and lists). Use format: "text" only if you need plain text.
3. Use more targeted tools (query_selector, get_tables, get_structured_data) for specific content if needed
4. If the user asks about linked content, use fetch_url to read linked pages (also returns markdown)
5. When you have gathered enough information, call save_entities with the extracted nodes and edges

Rules for NODES:
- Do NOT output resource nodes. The system automatically creates a resource node for the source URL. Every node you emit is an entity.
- Use the "label" field on each node to categorize it semantically. Allowed labels:
  concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Include relevant properties as key-value pairs on nodes.
- Include a "tags" array for domain annotations (e.g. ["technology", "ai"]).

Rules for EDGES:
- Leverage markdown structure (headings, tables, links) to identify relationships more accurately.
- Prefer these seed relationship labels when applicable: subfield_of, part_of, instance_of, created_by, affiliated_with, used_in, builds_on, enables, contradicts, alternative_to, preceded_by.
- Otherwise use consistent, lowercase snake_case labels (e.g., "works_at", "located_in").
- Ensure all edges reference entities that exist in your nodes array by their exact name.
- Call save_entities exactly once when done — it is the terminal tool.${notesRules}

Be efficient: don't call tools unnecessarily. If get_page_content gives you everything you need, proceed directly to save_entities.`;
}

const MAX_ITERATIONS = 15;
const TOOL_TIMEOUT_MS = 30_000;
const FETCH_MAX_BYTES = 20_000;

interface AgentLoopParams {
  runId: string;
  userPrompt: string;
  tabId: number;
  apiKey: string;
  model: string;
  maxIterations?: number;
  notesEnabled?: boolean;
  onProgress: (event: AgentProgressEvent) => void;
}

export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
  const { runId, userPrompt, tabId, apiKey, model, onProgress } = params;
  const maxIter = params.maxIterations ?? MAX_ITERATIONS;
  const systemPrompt = getAgentSystemPrompt(params.notesEnabled ?? false);

  const anthropicTools = toAnthropicTools(AGENT_TOOLS);
  const messages: AnthropicMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < maxIter; i++) {
    onProgress({ type: 'llm_start' });

    let result;
    try {
      result = await streamAnthropicWithTools(
        apiKey,
        model,
        systemPrompt,
        messages,
        anthropicTools,
        (chunk) => onProgress({ type: 'llm_chunk', text: chunk })
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
      onProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
      return;
    }

    // Build the assistant message with all content blocks
    const assistantContent: AnthropicContentBlock[] = [];
    if (result.textContent) {
      assistantContent.push({ type: 'text', text: result.textContent });
    }
    for (const tc of result.toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool call and collect results
    const toolResultBlocks: AnthropicContentBlock[] = [];

    for (const tc of result.toolCalls) {
      onProgress({ type: 'tool_call', toolCall: tc });

      // Check for terminal tool
      if (tc.name === 'save_entities') {
        const extractionResult = tc.input as unknown as ExtractionResult;
        onProgress({ type: 'extraction_complete', extractionResult, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
        onProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
        return;
      }

      let toolResult: string;
      let toolError: string | undefined;

      const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
      if (!toolDef) {
        toolResult = '';
        toolError = `Unknown tool: ${tc.name}`;
      } else if (toolDef.executionContext === 'content-script') {
        // Execute via service worker relay to content script
        const res = await executeRemoteTool(tc.id, tc.name, tc.input, tabId, runId);
        toolResult = res.result;
        toolError = res.error;
      } else if (tc.name === 'fetch_url') {
        const res = await executeFetchUrl(tc.input.url as string);
        toolResult = res.result;
        toolError = res.error;
      } else {
        toolResult = '';
        toolError = `Tool ${tc.name} cannot be executed here`;
      }

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

async function executeRemoteTool(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  tabId: number,
  runId: string
): Promise<{ result: string; error?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ result: '', error: `Tool ${toolName} timed out after ${TOOL_TIMEOUT_MS / 1000}s` });
    }, TOOL_TIMEOUT_MS);

    // Send TOOL_EXECUTE to SW, which relays to content script
    // The SW uses chrome.tabs.sendMessage and returns the response directly
    chrome.runtime.sendMessage(
      {
        type: 'TOOL_EXECUTE',
        payload: { runId, toolCallId, toolName, toolInput, tabId },
      },
      (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          resolve({ result: '', error: chrome.runtime.lastError.message });
        } else if (response?.error) {
          resolve({ result: response.result ?? '', error: response.error });
        } else {
          resolve({ result: response?.result ?? '' });
        }
      }
    );
  });
}

async function executeFetchUrl(url: string): Promise<{ result: string; error?: string }> {
  const { content, error } = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
  return { result: content, error };
}
