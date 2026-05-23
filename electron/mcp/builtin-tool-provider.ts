import type { ToolProvider, ToolDefinition, ToolResult } from './types';
import type { CommandContext } from '../../src/commands/types';
import { CHAT_AGENT_TOOLS } from '../../src/shared/chat-agent-tools';
import { executeTool } from '../../src/commands/chat-tool-executor';

const READ_TOOLS = new Set([
  'search_knowledge', 'search_nodes', 'get_node_details',
  'get_neighbors', 'get_edges_for_node', 'search_sources',
  'get_source_content', 'semantic_search',
]);

const WRITE_TOOLS = new Set([
  'create_node', 'update_node', 'create_edge',
  'delete_node', 'merge_nodes',
]);

export class BuiltinToolProvider implements ToolProvider {
  readonly id = 'builtin';
  readonly namespace = null;

  constructor(private ctx: CommandContext) {}

  listTools(): ToolDefinition[] {
    return CHAT_AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      category: READ_TOOLS.has(t.name) ? 'read' as const
        : WRITE_TOOLS.has(t.name) ? 'write' as const
        : 'execute' as const,
    }));
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await executeTool(this.ctx, name, input);
      return {
        result: result.result,
        collectedNodeIds: result.collectedNodeIds,
        collectedEdgeIds: result.collectedEdgeIds,
      };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  dispose(): void {}
}
