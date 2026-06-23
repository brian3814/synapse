import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import type { DbNodeSlim, DbEdgeSlim, GraphNode, GraphEdge } from '../../shared/types';
import { buildAdjacencyMap } from '../../graph/algorithms/adjacency';
import {
  degreeCentrality,
  connectedComponents,
  labelPropagation,
  findConnectionSuggestions,
  findOrphans,
  findBridgeNodes,
  computeGraphHealth,
  bfsPathWithEdges,
} from '../../graph/algorithms/graph-algorithms';

function toGraphNode(row: DbNodeSlim): GraphNode {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    type: row.type,
    label: row.label,
    properties: {},
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    color: row.color ?? undefined,
    size: row.size,
    sourceUrl: row.source_url ?? undefined,
    createdAt: '',
    updatedAt: '',
  };
}

function toGraphEdge(row: DbEdgeSlim): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    type: row.type,
    properties: {},
    weight: row.weight,
    directed: row.directed === 1,
    createdAt: '',
    updatedAt: '',
  };
}

export const definitions: ChatToolDefinition[] = [
  {
    name: 'get_centrality_ranking',
    description:
      'Rank nodes by degree centrality — how connected they are relative to the rest of the graph. Useful for identifying the most important or influential entities.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of nodes to return (default 10)' },
        node_type: { type: 'string', description: 'Filter to a specific node type (optional)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_orphan_nodes',
    description:
      'Find nodes with no connections. Orphans are candidates for enrichment or deletion.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of orphans to return (default 50)' },
        node_type: { type: 'string', description: 'Filter to a specific node type (optional)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_clusters',
    description:
      'Detect communities/clusters in the graph using label propagation. Returns natural groupings of tightly connected nodes.',
    parameters: {
      type: 'object',
      properties: {
        min_size: { type: 'number', description: 'Minimum cluster size to include (default 2)' },
        include_members: {
          type: 'boolean',
          description: 'Include cluster member details (id, name, type) in results (default false)',
        },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_bridge_nodes',
    description:
      'Find nodes that connect multiple clusters. Bridge nodes are critical cross-domain connectors whose removal would fragment the graph.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of bridge nodes to return (default 10)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_connection_suggestions',
    description:
      'Suggest potential new edges between nodes that share multiple common neighbors but are not yet directly connected. Helps discover implicit relationships.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum suggestions to return (default 10)' },
        min_shared: {
          type: 'number',
          description: 'Minimum shared neighbors required to suggest a connection (default 2)',
        },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_graph_health',
    description:
      'Compute overall graph health metrics: node/edge counts, orphan rate, density, average degree, cluster count, and connected component stats.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'find_shortest_path',
    description:
      'Find the shortest path between two nodes using BFS. Returns the sequence of nodes and edges connecting them.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Starting node ID' },
        target_id: { type: 'string', description: 'Destination node ID' },
        max_hops: { type: 'number', description: 'Maximum path length in hops (default 6)' },
      },
      required: ['source_id', 'target_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'synthesize_domains',
    description:
      'Find structural parallels between two knowledge domains. Loads nodes from each domain and uses the LLM to identify connections, shared patterns, and bridging concepts. Supports graph-only mode (strict, cites node IDs) or augmented mode (supplements with world knowledge).',
    parameters: {
      type: 'object',
      properties: {
        domain_a: { type: 'string', description: 'First domain: a node type (e.g. "concept"), or a search query' },
        domain_b: { type: 'string', description: 'Second domain: same format as domain_a' },
        mode: { type: 'string', description: '"graph-only" (default) or "augmented" — graph-only constrains analysis to graph data only' },
        limit: { type: 'number', description: 'Max nodes to load per domain (default 20)' },
      },
      required: ['domain_a', 'domain_b'],
    },
    executionContext: 'ui',
  },
  {
    name: 'analyze_gaps',
    description:
      'Identify what concepts or connections are missing from a knowledge domain. Loads nodes in the domain and asks the LLM what a practitioner would expect to find but is absent.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to analyze: a node type or search query' },
        mode: { type: 'string', description: '"graph-only" (default) or "augmented"' },
        limit: { type: 'number', description: 'Max nodes to load (default 30)' },
      },
      required: ['domain'],
    },
    executionContext: 'ui',
  },
];

async function resolveDomain(
  ctx: CommandContext,
  domain: string,
  limit: number
): Promise<Array<{ id: string; name: string; type: string; label?: string | null }>> {
  const slim = await ctx.db.loadGraph();
  const nodes = slim.nodes.map(toGraphNode);

  // 1. Match by node type or label
  const types = new Set(nodes.map(n => n.type));
  const labels = new Set(nodes.filter(n => n.label).map(n => n.label!));
  if (types.has(domain) || labels.has(domain)) {
    return nodes
      .filter(n => n.type === domain || n.label === domain)
      .slice(0, limit)
      .map(n => ({ id: n.id, name: n.name, type: n.type, label: n.label }));
  }

  // 2. Fall back to search
  const searchResults = await ctx.db.nodes.search(domain, limit);
  return searchResults.map(n => ({ id: n.id, name: n.name, type: n.type, label: n.label }));
}

async function getConfiguredModel(ctx: CommandContext): Promise<string> {
  try {
    const result = await ctx.storage.get('llmConfig') as Record<string, any>;
    return result.llmConfig?.model ?? 'claude-sonnet-4-6';
  } catch {
    return 'claude-sonnet-4-6';
  }
}

async function execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null> {
  switch (name) {
    case 'get_centrality_ranking': {
      const limit = (input.limit as number) ?? 10;
      const nodeType = input.node_type as string | undefined;

      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const centrality = degreeCentrality(map, nodes);

      let filtered = nodes;
      if (nodeType) {
        filtered = nodes.filter((n) => n.type === nodeType || n.label === nodeType);
      }

      const totalDegrees = filtered.reduce((sum, n) => sum + (map.get(n.id)?.length ?? 0), 0);
      const avgDegree = filtered.length > 0 ? totalDegrees / filtered.length : 0;

      const rankings = filtered
        .map((n) => ({
          nodeId: n.id,
          name: n.name,
          type: n.type,
          label: n.label,
          degree: map.get(n.id)?.length ?? 0,
          centrality: centrality.get(n.id) ?? 0,
        }))
        .sort((a, b) => b.centrality - a.centrality)
        .slice(0, limit);

      return {
        result: JSON.stringify({
          rankings,
          totalNodes: filtered.length,
          avgDegree: Math.round(avgDegree * 100) / 100,
        }),
        collectedNodeIds: rankings.map((r) => r.nodeId),
      };
    }

    case 'get_orphan_nodes': {
      const limit = (input.limit as number) ?? 50;
      const nodeType = input.node_type as string | undefined;

      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const orphans = findOrphans(map, nodes);

      let filtered = orphans;
      if (nodeType) {
        filtered = orphans.filter((n) => n.type === nodeType || n.label === nodeType);
      }

      const sliced = filtered.slice(0, limit).map((n) => ({
        nodeId: n.id,
        name: n.name,
        type: n.type,
        label: n.label,
        createdAt: n.createdAt,
      }));

      return {
        result: JSON.stringify({
          orphans: sliced,
          orphanCount: filtered.length,
          orphanRate: nodes.length > 0 ? Math.round((orphans.length / nodes.length) * 1000) / 1000 : 0,
          totalNodes: nodes.length,
        }),
        collectedNodeIds: sliced.map((o) => o.nodeId),
      };
    }

    case 'get_clusters': {
      const minSize = (input.min_size as number) ?? 2;
      const includeMembers = (input.include_members as boolean) ?? false;

      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const filtered = clusters.filter((c) => c.size >= minSize);

      const singletonCount = nodes.length - clusters.reduce((sum, c) => sum + c.size, 0);
      const nodesInClusters = filtered.reduce((sum, c) => sum + c.size, 0);

      const result = filtered.map((c) => {
        const entry: Record<string, unknown> = {
          id: c.id,
          label: c.label,
          size: c.size,
        };
        if (includeMembers) {
          entry.members = c.nodeIds.map((id) => {
            const n = nodeMap.get(id);
            return { id, name: n?.name ?? id, type: n?.type ?? 'unknown' };
          });
        }
        return entry;
      });

      return {
        result: JSON.stringify({
          clusters: result,
          clusterCount: filtered.length,
          nodesInClusters,
          singletonCount: Math.max(singletonCount, 0),
        }),
        collectedNodeIds: filtered.flatMap((c) => c.nodeIds),
      };
    }

    case 'get_bridge_nodes': {
      const limit = (input.limit as number) ?? 10;

      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);
      const bridges = findBridgeNodes(map, nodes, clusters);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const result = bridges.slice(0, limit).map((b) => {
        const n = nodeMap.get(b.nodeId);
        return {
          nodeId: b.nodeId,
          name: n?.name ?? b.nodeId,
          type: n?.type ?? 'unknown',
          label: n?.label,
          clustersConnected: b.clustersConnected,
          clusterCount: b.clustersConnected.length,
        };
      });

      return {
        result: JSON.stringify({ bridges: result }),
        collectedNodeIds: result.map((b) => b.nodeId),
      };
    }

    case 'get_connection_suggestions': {
      const limit = (input.limit as number) ?? 10;
      const minShared = (input.min_shared as number) ?? 2;

      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const suggestions = findConnectionSuggestions(map, nodes, minShared, limit);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const result = suggestions.map((s) => ({
        nodeA: { id: s.nodeA, name: nodeMap.get(s.nodeA)?.name ?? s.nodeA },
        nodeB: { id: s.nodeB, name: nodeMap.get(s.nodeB)?.name ?? s.nodeB },
        sharedNeighborCount: s.sharedNeighbors.length,
        score: s.score,
      }));

      const allNodeIds = [...new Set(suggestions.flatMap((s) => [s.nodeA, s.nodeB]))];

      return {
        result: JSON.stringify({ suggestions: result }),
        collectedNodeIds: allNodeIds,
      };
    }

    case 'get_graph_health': {
      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);
      const components = connectedComponents(map, nodes);
      const health = computeGraphHealth(nodes, edges, map, clusters, components);

      return {
        result: JSON.stringify({
          ...health,
          orphanRate: Math.round(health.orphanRate * 1000) / 1000,
          density: Math.round(health.density * 10000) / 10000,
          avgDegree: Math.round(health.avgDegree * 100) / 100,
          largestComponentRatio: Math.round(health.largestComponentRatio * 1000) / 1000,
        }),
      };
    }

    case 'find_shortest_path': {
      const sourceId = input.source_id as string;
      const targetId = input.target_id as string;
      const maxHops = (input.max_hops as number) ?? 6;

      const slim = await ctx.db.loadGraph();
      const nodes = slim.nodes.map(toGraphNode);
      const edges = slim.edges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const pathResult = bfsPathWithEdges(map, sourceId, targetId, maxHops);

      if (!pathResult) {
        return {
          result: JSON.stringify({ found: false, pathLength: 0, nodes: [], edges: [] }),
        };
      }

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const edgeMap = new Map(edges.map((e) => [e.id, e]));

      const pathNodes = pathResult.nodeIds.map((id) => {
        const n = nodeMap.get(id);
        return { id, name: n?.name ?? id, type: n?.type ?? 'unknown' };
      });

      const pathEdges = pathResult.edgeIds.map((id) => {
        const e = edgeMap.get(id);
        return {
          id,
          label: e?.label ?? '',
          sourceId: e?.sourceId ?? '',
          targetId: e?.targetId ?? '',
        };
      });

      return {
        result: JSON.stringify({
          found: true,
          pathLength: pathResult.nodeIds.length - 1,
          nodes: pathNodes,
          edges: pathEdges,
        }),
        collectedNodeIds: pathResult.nodeIds,
        collectedEdgeIds: pathResult.edgeIds,
      };
    }

    case 'synthesize_domains': {
      const domainA = input.domain_a as string;
      const domainB = input.domain_b as string;
      const mode = (input.mode as string) ?? 'graph-only';
      const limit = (input.limit as number) ?? 20;

      const [nodesA, nodesB] = await Promise.all([
        resolveDomain(ctx, domainA, limit),
        resolveDomain(ctx, domainB, limit),
      ]);

      const formatNodes = (nodes: Array<{ id: string; name: string; type: string; label?: string | null }>) =>
        nodes.map(n => `- [${n.id}] ${n.name} (${n.label ?? n.type})`).join('\n');

      const systemPrompt =
        mode === 'augmented'
          ? 'Start from the provided graph data. You may supplement with world knowledge, but clearly prefix each insight with [GRAPH] or [WORLD] to indicate its source.'
          : 'Analyze ONLY the provided graph data. Do not introduce external knowledge. Every claim must reference specific node IDs in brackets.';

      const userContent =
        `Find structural parallels between these two knowledge domains.\n\n` +
        `Domain A — "${domainA}" (${nodesA.length} nodes):\n${formatNodes(nodesA)}\n\n` +
        `Domain B — "${domainB}" (${nodesB.length} nodes):\n${formatNodes(nodesB)}\n\n` +
        `Identify connections, shared patterns, and bridging concepts between the two domains.`;

      const requestId = crypto.randomUUID();
      const result = await ctx.llm.streamChat(
        {
          requestId,
          model: await getConfiguredModel(ctx),
          systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          tools: [],
        },
        () => {},
      );

      const allNodeIds = [...new Set([...nodesA.map(n => n.id), ...nodesB.map(n => n.id)])];

      return {
        result: JSON.stringify({
          synthesis: result.textContent,
          domainA: { query: domainA, nodeCount: nodesA.length },
          domainB: { query: domainB, nodeCount: nodesB.length },
          mode,
        }),
        collectedNodeIds: allNodeIds,
      };
    }

    case 'analyze_gaps': {
      const domain = input.domain as string;
      const mode = (input.mode as string) ?? 'graph-only';
      const limit = (input.limit as number) ?? 30;

      const nodes = await resolveDomain(ctx, domain, limit);

      const formatNodes = (ns: Array<{ id: string; name: string; type: string; label?: string | null }>) =>
        ns.map(n => `- [${n.id}] ${n.name} (${n.label ?? n.type})`).join('\n');

      const systemPrompt =
        mode === 'augmented'
          ? 'Start from the provided graph data. You may supplement with world knowledge, but clearly prefix each insight with [GRAPH] or [WORLD] to indicate its source.'
          : 'Analyze ONLY the provided graph data. Do not introduce external knowledge. Every claim must reference specific node IDs in brackets.';

      const userContent =
        `Analyze what is missing from this knowledge domain.\n\n` +
        `Domain — "${domain}" (${nodes.length} nodes):\n${formatNodes(nodes)}\n\n` +
        `What concepts, connections, or topics would a practitioner expect to find in this domain that are absent from the graph?`;

      const requestId = crypto.randomUUID();
      const result = await ctx.llm.streamChat(
        {
          requestId,
          model: await getConfiguredModel(ctx),
          systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          tools: [],
        },
        () => {},
      );

      return {
        result: JSON.stringify({
          analysis: result.textContent,
          domain: { query: domain, nodeCount: nodes.length },
          mode,
        }),
        collectedNodeIds: nodes.map(n => n.id),
      };
    }

    default:
      return null;
  }
}

export const intelligenceTools: ToolModule = { definitions, execute };
