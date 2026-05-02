import { runAgentLoop as coreRunAgentLoop, type ToolExecutor } from '../core/agent-loop';
import { streamAnthropicWithTools } from './llm-executor';
import { AGENT_TOOLS } from '../shared/agent-tools';
import { fetchAndCleanContent, isBlockedUrl } from './url-utils';
import type { AgentProgressEvent, ToolCall } from '../shared/types';

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

class ContentScriptToolExecutor implements ToolExecutor {
  constructor(private tabId: number, private runId: string) {}

  async execute(tc: ToolCall): Promise<{ result: string; error?: string }> {
    const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
    if (!toolDef) return { result: '', error: `Unknown tool: ${tc.name}` };

    if (toolDef.executionContext === 'content-script') {
      return this.executeRemote(tc);
    } else if (tc.name === 'fetch_url') {
      const url = tc.input.url as string;
      if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
      const { content, error } = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
      return { result: content, error };
    }
    return { result: '', error: `Tool ${tc.name} cannot be executed here` };
  }

  private executeRemote(tc: ToolCall): Promise<{ result: string; error?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ result: '', error: `Tool ${tc.name} timed out after ${TOOL_TIMEOUT_MS / 1000}s` });
      }, TOOL_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        { type: 'TOOL_EXECUTE', payload: { runId: this.runId, toolCallId: tc.id, toolName: tc.name, toolInput: tc.input, tabId: this.tabId } },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) resolve({ result: '', error: chrome.runtime.lastError.message });
          else if (response?.error) resolve({ result: response.result ?? '', error: response.error });
          else resolve({ result: response?.result ?? '' });
        },
      );
    });
  }
}

export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
  const toolExecutor = new ContentScriptToolExecutor(params.tabId, params.runId);
  await coreRunAgentLoop(
    {
      runId: params.runId,
      userPrompt: params.userPrompt,
      apiKey: params.apiKey,
      model: params.model,
      maxIterations: params.maxIterations,
      notesEnabled: params.notesEnabled,
    },
    streamAnthropicWithTools,
    toolExecutor,
    params.onProgress,
  );
}
