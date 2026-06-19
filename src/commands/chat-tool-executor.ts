import type { CommandContext } from './types';
import { retrieveRAGContext, formatRAGPrompt } from './rag-commands';
import { parseMarkdown } from '../notes/markdown-utils';
import * as graphCommands from './graph-commands';
import * as memoryCommands from './memory-commands';
import { executeExtendedTool } from './tools';

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

    case 'manage_memory': {
      const result = await memoryCommands.executeManageMemory(ctx, input);
      return { result };
    }

    case 'get_nodes_batch': {
      const ids = (input.node_ids as string[]).slice(0, 50);
      const nodes = await Promise.all(ids.map((id) => ctx.db.nodes.getById(id)));
      const results = nodes
        .filter(Boolean)
        .map((n: any) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          label: n.label,
          summary: n.summary,
          properties: typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties,
          sourceUrl: n.source_url,
        }));
      return {
        result: JSON.stringify({ nodes: results, found: results.length, requested: ids.length }),
        collectedNodeIds: results.map((n) => n.id),
      };
    }

    case 'delete_node': {
      const nodeId = input.node_id as string;
      const node = await ctx.db.nodes.getById(nodeId);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }) };
      const result = await graphCommands.deleteNode(ctx, nodeId);
      return {
        result: JSON.stringify({ deleted: result.data, id: nodeId, name: (node as any).name }),
      };
    }

    case 'delete_nodes_batch': {
      const ids = (input.node_ids as string[]).slice(0, 50);
      const deleted: Array<{ id: string; name: string }> = [];
      const errors: string[] = [];
      for (const id of ids) {
        const node = await ctx.db.nodes.getById(id);
        if (!node) { errors.push(`${id}: not found`); continue; }
        try {
          await graphCommands.deleteNode(ctx, id);
          deleted.push({ id, name: (node as any).name });
        } catch (e: any) {
          errors.push(`${id}: ${e.message}`);
        }
      }
      return {
        result: JSON.stringify({ deleted: deleted.length, nodes: deleted, errors }),
      };
    }

    case 'merge_nodes': {
      const primaryId = input.primary_node_id as string;
      const secondaryId = input.secondary_node_id as string;
      const primary = await ctx.db.nodes.getById(primaryId);
      const secondary = await ctx.db.nodes.getById(secondaryId);
      if (!primary) return { result: JSON.stringify({ error: `Primary node ${primaryId} not found` }) };
      if (!secondary) return { result: JSON.stringify({ error: `Secondary node ${secondaryId} not found` }) };

      const secondaryEdges = await ctx.db.edges.getForNode(secondaryId) as any[];
      let transferred = 0;
      for (const edge of secondaryEdges) {
        const newSource = edge.source_id === secondaryId ? primaryId : edge.source_id;
        const newTarget = edge.target_id === secondaryId ? primaryId : edge.target_id;
        if (newSource === newTarget) continue;
        try {
          await ctx.db.edges.create({ sourceId: newSource, targetId: newTarget, label: edge.label, type: edge.type });
          transferred++;
        } catch {
          // duplicate edge — skip
        }
      }

      await ctx.db.entityResolution.addAlias(primaryId, (secondary as any).name);
      await graphCommands.deleteNode(ctx, secondaryId);

      return {
        result: JSON.stringify({
          merged: true,
          kept: { id: primaryId, name: (primary as any).name },
          deleted: { id: secondaryId, name: (secondary as any).name },
          edgesTransferred: transferred,
          aliasAdded: (secondary as any).name,
        }),
        collectedNodeIds: [primaryId],
      };
    }

    case 'semantic_search': {
      const query = input.query as string;
      const limit = (input.limit as number) ?? 5;
      if (!ctx.embedding) {
        return { result: JSON.stringify({ message: 'Embeddings not enabled. Configure in Settings > Embeddings.' }) };
      }
      const results = await ctx.embedding.searchSimilar(query, limit);
      if (results.length === 0) {
        return { result: JSON.stringify({ message: 'No semantic matches found.' }) };
      }
      const nodeDetails = [];
      for (const r of results) {
        const node = await ctx.db.nodes.getById(r.nodeId);
        if (node) {
          nodeDetails.push({ id: (node as any).id, name: (node as any).name, type: (node as any).type, similarity: r.score.toFixed(2) });
        }
      }
      return { result: JSON.stringify(nodeDetails), collectedNodeIds: nodeDetails.map((n) => n.id) };
    }

    case 'read_entity_file': {
      if (!ctx.entityFiles) return { result: 'Entity files not available', collectedNodeIds: [] };
      const efResult = await ctx.entityFiles.read(input.node_id as string);
      if (!efResult) return { result: 'Entity file not found for this node', collectedNodeIds: [] };
      return {
        result: `# ${efResult.path}\n\ncontent_hash: ${efResult.contentHash}\n\n${efResult.content}`,
        collectedNodeIds: [input.node_id as string],
      };
    }

    case 'append_entity_file': {
      if (!ctx.entityFiles) return { result: 'Entity files not available', collectedNodeIds: [] };
      const appendResult = await ctx.entityFiles.append(
        input.node_id as string,
        input.text as string,
        input.expected_hash as string | undefined,
      );
      return {
        result: `Appended successfully. New content_hash: ${appendResult.contentHash}`,
        collectedNodeIds: [input.node_id as string],
      };
    }

    case 'patch_entity_file': {
      if (!ctx.entityFiles) return { result: 'Entity files not available', collectedNodeIds: [] };
      const patchResult = await ctx.entityFiles.patch(
        input.node_id as string,
        { oldText: input.old_text as string, newText: input.new_text as string },
        input.expected_hash as string | undefined,
      );
      return {
        result: `Patched successfully. New content_hash: ${patchResult.contentHash}`,
        collectedNodeIds: [input.node_id as string],
      };
    }

    default: {
      const extended = await executeExtendedTool(ctx, name, input);
      if (extended) return extended;
      return { result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
    }
  }
}
