import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import * as graphCommands from '../graph-commands';

export const definitions: ChatToolDefinition[] = [
  {
    name: 'update_edge',
    description:
      'Update an existing edge\'s label, type, or properties.',
    parameters: {
      type: 'object',
      properties: {
        edge_id: { type: 'string', description: 'The ID of the edge to update' },
        label: { type: 'string', description: 'New relationship label' },
        type: { type: 'string', description: 'New relationship type/category' },
        properties: { type: 'object', description: 'Properties to merge into the edge' },
      },
      required: ['edge_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'delete_edge',
    description:
      'Delete a single edge (relationship) from the knowledge graph by ID.',
    parameters: {
      type: 'object',
      properties: {
        edge_id: { type: 'string', description: 'The ID of the edge to delete' },
      },
      required: ['edge_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_edges_between',
    description:
      'Get all edges between two specific nodes (in either direction).',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'First node ID' },
        target_id: { type: 'string', description: 'Second node ID' },
      },
      required: ['source_id', 'target_id'],
    },
    executionContext: 'ui',
  },
];

async function execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null> {
  switch (name) {
    case 'update_edge': {
      const result = await graphCommands.updateEdge(ctx, {
        id: input.edge_id as string,
        label: input.label as string | undefined,
        type: input.type as string | undefined,
        properties: input.properties as Record<string, unknown> | undefined,
      });
      if (!result.data) return { result: JSON.stringify({ error: 'Edge not found' }) };
      return {
        result: JSON.stringify({ id: result.data.id, label: result.data.label, type: result.data.type }),
        collectedEdgeIds: [result.data.id],
      };
    }

    case 'delete_edge': {
      const edgeId = input.edge_id as string;
      const edge = await ctx.db.edges.getById(edgeId);
      if (!edge) return { result: JSON.stringify({ error: 'Edge not found' }) };

      const result = await graphCommands.deleteEdge(ctx, edgeId);
      return {
        result: JSON.stringify({ deleted: result.data, id: edgeId, label: edge.label }),
      };
    }

    case 'get_edges_between': {
      const sourceId = input.source_id as string;
      const targetId = input.target_id as string;
      const edges = await ctx.db.edges.getBetween([sourceId, targetId]);
      const mapped = edges.map((e) => ({
        id: e.id,
        sourceId: e.source_id,
        targetId: e.target_id,
        label: e.label,
        type: e.type,
      }));
      return {
        result: JSON.stringify(mapped),
        collectedEdgeIds: mapped.map((e) => e.id),
        collectedNodeIds: [sourceId, targetId],
      };
    }

    default:
      return null;
  }
}

export const edgeTools: ToolModule = { definitions, execute };
