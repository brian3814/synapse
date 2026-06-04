import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';

export const definitions: ChatToolDefinition[] = [
  {
    name: 'get_graph_overview',
    description:
      'Get a high-level overview of the knowledge graph: total node/edge counts, type distribution, and recent nodes. Use this to orient yourself before performing operations.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_subgraph',
    description:
      'Extract a subgraph around a seed node. Returns all nodes and edges within the specified depth, with full details. More comprehensive than get_neighbors (which only returns IDs).',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Seed node ID to expand from' },
        depth: { type: 'number', description: 'Traversal depth (default 1, max 3)' },
        include_properties: {
          type: 'boolean',
          description: 'Include node properties in results (default false, keeps response compact)',
        },
      },
      required: ['node_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_nodes_by_type',
    description:
      'Get all nodes of a specific type (e.g., "person", "concept", "note"). Useful for understanding what entities exist in a domain.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Node type to filter by (e.g., person, concept, note, resource)' },
        limit: { type: 'number', description: 'Maximum results (default 50)' },
      },
      required: ['type'],
    },
    executionContext: 'ui',
  },
];

async function execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null> {
  switch (name) {
    case 'get_graph_overview': {
      const { nodes, edges } = await ctx.db.loadGraph();
      const types = await ctx.db.nodes.getTypes();

      const typeCounts: Record<string, number> = {};
      for (const n of nodes) {
        typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
      }

      const recentNodes = nodes
        .slice(-10)
        .reverse()
        .map((n) => ({ id: n.id, name: n.name, type: n.type }));

      return {
        result: JSON.stringify({
          nodeCount: nodes.length,
          edgeCount: edges.length,
          types: typeCounts,
          registeredTypes: types,
          recentNodes,
        }),
      };
    }

    case 'get_subgraph': {
      const nodeId = input.node_id as string;
      const depth = Math.min((input.depth as number) ?? 1, 3);
      const includeProps = (input.include_properties as boolean) ?? false;

      const { nodeIds } = await ctx.db.nodes.getNeighborhood(nodeId, depth);
      const allIds = [...new Set([nodeId, ...nodeIds])];

      const nodeDetails = await Promise.all(
        allIds.slice(0, 200).map((id) => ctx.db.nodes.getById(id))
      );
      const validNodes = nodeDetails.filter(Boolean).map((n: any) => {
        const base: Record<string, unknown> = { id: n.id, name: n.name, type: n.type, label: n.label };
        if (includeProps && n.properties) {
          base.properties = typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties;
        }
        return base;
      });

      const edges = await ctx.db.edges.getBetween(allIds);
      const mappedEdges = edges.map((e) => ({
        id: e.id,
        sourceId: e.source_id,
        targetId: e.target_id,
        label: e.label,
        type: e.type,
      }));

      return {
        result: JSON.stringify({
          seed: nodeId,
          depth,
          nodes: validNodes,
          edges: mappedEdges,
          nodeCount: validNodes.length,
          edgeCount: mappedEdges.length,
        }),
        collectedNodeIds: validNodes.map((n) => n.id as string),
        collectedEdgeIds: mappedEdges.map((e) => e.id),
      };
    }

    case 'get_nodes_by_type': {
      const type = input.type as string;
      const limit = (input.limit as number) ?? 50;

      const allNodes = await ctx.db.nodes.getAll();
      const filtered = allNodes
        .filter((n) => n.type === type || n.label === type)
        .slice(0, limit)
        .map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          label: n.label,
        }));

      return {
        result: JSON.stringify({ type, nodes: filtered, count: filtered.length }),
        collectedNodeIds: filtered.map((n) => n.id),
      };
    }

    default:
      return null;
  }
}

export const graphTools: ToolModule = { definitions, execute };
