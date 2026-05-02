import type { CommandContext } from './types';
import { retrieveRAGContext, formatRAGPrompt } from './rag-commands';
import { parseMarkdown } from '../notes/markdown-utils';
import * as graphCommands from './graph-commands';

export interface ToolExecResult {
  result: string;
  collectedNodeIds?: string[];
  collectedEdgeIds?: string[];
}

export async function executeTool(
  ctx: CommandContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult> {
  switch (name) {
    case 'search_knowledge': {
      const context = await retrieveRAGContext(ctx, input.query as string);
      return {
        result: formatRAGPrompt(context),
        collectedNodeIds: context.relevantNodes.map((n) => n.id),
        collectedEdgeIds: context.relevantEdges.map((e) => e.id),
      };
    }

    case 'search_nodes': {
      const results = await ctx.db.nodes.search(input.query as string, (input.limit as number) ?? 10);
      return {
        result: JSON.stringify(
          (results as any[]).map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type,
            properties: typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties,
          })),
        ),
        collectedNodeIds: (results as any[]).map((n) => n.id),
      };
    }

    case 'get_node_details': {
      const node = await ctx.db.nodes.getById(input.nodeId as string);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }) };
      return {
        result: JSON.stringify({
          id: (node as any).id,
          name: (node as any).name,
          type: (node as any).type,
          properties:
            typeof (node as any).properties === 'string'
              ? JSON.parse((node as any).properties)
              : (node as any).properties,
          sourceUrl: (node as any).source_url,
        }),
        collectedNodeIds: [(node as any).id],
      };
    }

    case 'get_neighbors': {
      const result = await ctx.db.nodes.getNeighborhood(
        input.nodeId as string,
        Math.min((input.hops as number) ?? 1, 3),
      );
      const details = await Promise.all(
        (result as { nodeIds: string[] }).nodeIds.slice(0, 50).map((id: string) => ctx.db.nodes.getById(id)),
      );
      const filtered = details.filter(Boolean) as any[];
      return {
        result: JSON.stringify(filtered.map((n: any) => ({ id: n.id, name: n.name, type: n.type }))),
        collectedNodeIds: filtered.map((n: any) => n.id),
      };
    }

    case 'get_edges_for_node': {
      const edgeList = await ctx.db.edges.getForNode(input.nodeId as string);
      const mapped = (edgeList as any[]).map((e) => ({
        id: e.id,
        sourceId: e.source_id,
        targetId: e.target_id,
        label: e.label,
        type: e.type,
      }));
      return {
        result: JSON.stringify(mapped),
        collectedEdgeIds: mapped.map((e) => e.id),
        collectedNodeIds: mapped.flatMap((e) => [e.sourceId, e.targetId]),
      };
    }

    case 'search_sources': {
      const results = await ctx.db.sourceContent.search(input.query as string, (input.limit as number) ?? 5);
      const mapped = (results as any[]).map((s) => ({
        nodeId: s.node_id,
        url: s.url,
        title: s.title,
        excerpt: s.content?.substring(0, 500),
      }));
      return {
        result: JSON.stringify(mapped),
        collectedNodeIds: mapped.map((s) => s.nodeId),
      };
    }

    case 'get_source_content': {
      const nodeId = input.nodeId as string;
      const snapshot = await ctx.getGraphSnapshot();
      const targetNode = snapshot.nodes.find((n) => n.id === nodeId);
      if (targetNode?.type === 'note') {
        const md = await ctx.notes.read(nodeId);
        if (md) {
          const parsed = parseMarkdown(md);
          return {
            result: JSON.stringify({
              url: `note://${nodeId}`,
              title: targetNode.name,
              content: parsed.content.substring(0, 5000),
            }),
            collectedNodeIds: [nodeId],
          };
        }
      }
      const sc = await ctx.db.sourceContent.getByNodeId(nodeId);
      if (!sc) return { result: JSON.stringify({ error: 'No source content found' }) };
      return {
        result: JSON.stringify({
          url: (sc as any).url,
          title: (sc as any).title,
          content: (sc as any).content?.substring(0, 5000),
        }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'create_node': {
      const result = await graphCommands.createNode(ctx, {
        name: input.name as string,
        type: input.type as string,
        properties: (input.properties as Record<string, unknown>) ?? {},
      });
      if (!result.data) return { result: JSON.stringify({ error: 'Failed to create node' }) };
      return {
        result: JSON.stringify({ id: result.data.id, name: result.data.name, type: result.data.type }),
        collectedNodeIds: [result.data.id],
      };
    }

    case 'update_node': {
      const result = await graphCommands.updateNode(ctx, {
        id: input.nodeId as string,
        name: input.name as string | undefined,
        type: input.type as string | undefined,
        properties: (input.properties as Record<string, unknown>) ?? undefined,
      });
      if (!result.data) return { result: JSON.stringify({ error: 'Failed to update node' }) };
      return {
        result: JSON.stringify({ id: result.data.id, name: result.data.name }),
        collectedNodeIds: [result.data.id],
      };
    }

    case 'create_edge': {
      const result = await graphCommands.createEdge(ctx, {
        sourceId: input.sourceId as string,
        targetId: input.targetId as string,
        label: input.label as string,
        type: (input.type as string) ?? 'related',
      });
      if (!result.data) return { result: JSON.stringify({ error: 'Failed to create edge' }) };
      return {
        result: JSON.stringify({ id: result.data.id, label: result.data.label }),
        collectedEdgeIds: [result.data.id],
      };
    }

    case 'search_memories': {
      const allSemantic = await ctx.db.memory.getAllSemantic() as Array<{
        id: string;
        category: string;
        content: string;
        updated_at: string;
      }>;
      const category = (input.category as string) ?? 'all';
      const filtered = category === 'all'
        ? allSemantic
        : allSemantic.filter((m) => m.category === category);

      const recentEpisodic = await ctx.db.memory.getRecentEpisodic(5) as Array<{
        summary: string;
        created_at: string;
      }>;

      return {
        result: JSON.stringify({
          semanticMemories: filtered.map((m) => ({
            category: m.category,
            content: m.content,
            lastUsed: m.updated_at,
          })),
          recentSessionSummaries: recentEpisodic.map((e) => ({
            summary: e.summary,
            date: e.created_at,
          })),
          total: filtered.length,
        }),
      };
    }

    case 'index_notes_folder': {
      const { getStoredFolder, requestPermission } = await import('../filesystem/folder-access');
      const { indexMarkdownFolder } = await import('../filesystem/indexing-pipeline');
      const handle = await getStoredFolder();
      if (!handle) {
        return { result: JSON.stringify({ error: 'No folder connected. Connect one in Settings > Markdown Folder.' }) };
      }
      const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const granted = await requestPermission(handle);
        if (!granted) {
          return { result: JSON.stringify({ error: 'Permission denied. Please grant folder access in Settings.' }) };
        }
      }
      const indexResult = await indexMarkdownFolder(handle);
      return {
        result: JSON.stringify({
          processed: indexResult.processed,
          created: indexResult.created,
          updated: indexResult.updated,
          skipped: indexResult.skipped,
        }),
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}
