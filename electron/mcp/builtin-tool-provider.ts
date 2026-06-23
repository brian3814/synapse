import type { ToolProvider, ToolDefinition, ToolResult } from './types';
import type { CommandContext } from '../../src/commands/types';
import { ALL_CHAT_AGENT_TOOLS } from '../../src/shared/chat-agent-tools';
import { executeTool } from '../../src/commands/chat-tool-executor';

const READ_TOOLS = new Set([
  'search_knowledge', 'search_nodes', 'get_node_details',
  'get_neighbors', 'get_edges_for_node', 'search_sources',
  'get_source_content', 'semantic_search', 'get_nodes_batch',
  'read_note', 'list_notes', 'search_notes',
  'get_edges_between',
  'get_graph_overview', 'get_subgraph', 'get_nodes_by_type',
  'find_similar_entities', 'get_aliases', 'get_node_tags',
]);

const WRITE_TOOLS = new Set([
  'create_node', 'update_node', 'create_edge',
  'delete_node', 'delete_nodes_batch', 'merge_nodes',
  'create_note', 'update_note',
  'update_edge', 'delete_edge',
  'add_alias', 'tag_node',
  'create_artifact', 'update_artifact',
]);

export class BuiltinToolProvider implements ToolProvider {
  readonly id = 'builtin';
  readonly namespace = null;

  constructor(private ctx: CommandContext) {}

  listTools(): ToolDefinition[] {
    return ALL_CHAT_AGENT_TOOLS.map((t) => ({
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
