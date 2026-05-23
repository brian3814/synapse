import type { CommandContext, CommandResult, CommandEvent } from './types';
import type { GraphNode, GraphEdge, CreateNodeInput, UpdateNodeInput, CreateEdgeInput, UpdateEdgeInput, DbNode, DbEdge } from '../shared/types';

function dbNodeToGraphNode(row: DbNode): GraphNode {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    type: row.type,
    label: row.label,
    summary: row.summary,
    folderPath: row.folder_path,
    properties: JSON.parse(row.properties || '{}'),
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    z: row.z ?? undefined,
    color: row.color ?? undefined,
    size: row.size,
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dbEdgeToGraphEdge(row: DbEdge): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    type: row.type,
    properties: JSON.parse(row.properties || '{}'),
    weight: row.weight,
    directed: row.directed === 1,
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createNode(
  ctx: CommandContext,
  input: CreateNodeInput,
): Promise<CommandResult<GraphNode | null>> {
  const row = await ctx.db.nodes.create({
    name: input.name,
    type: input.type,
    label: input.label,
    folderPath: input.folderPath,
    properties: JSON.stringify(input.properties ?? {}),
    color: input.color,
    size: input.size,
    sourceUrl: input.sourceUrl,
  });
  if (!row) return { data: null, events: [] };
  const node = dbNodeToGraphNode(row);
  return { data: node, events: [{ type: 'node_created', node: row }] };
}

export async function updateNode(
  ctx: CommandContext,
  input: UpdateNodeInput,
): Promise<CommandResult<GraphNode | null>> {
  const row = await ctx.db.nodes.update({
    id: input.id,
    name: input.name,
    type: input.type,
    label: input.label,
    summary: input.summary,
    folderPath: input.folderPath,
    properties: input.properties ? JSON.stringify(input.properties) : undefined,
    x: input.x,
    y: input.y,
    z: input.z,
    color: input.color,
    size: input.size,
  });
  if (!row) return { data: null, events: [] };
  const node = dbNodeToGraphNode(row);
  return { data: node, events: [{ type: 'node_updated', node: row }] };
}

export async function deleteNode(
  ctx: CommandContext,
  id: string,
): Promise<CommandResult<boolean>> {
  const snapshot = await ctx.getGraphSnapshot();
  const node = snapshot.nodes.find((n) => n.id === id);

  const success = await ctx.db.nodes.delete(id);
  if (!success) return { data: false, events: [] };

  const events: CommandEvent[] = [{ type: 'node_deleted', id }];

  if (node?.type === 'resource') {
    ctx.db.entitySources.removeAllForResource(node.id).catch(() => {});
  }

  if (node?.type === 'note') {
    ctx.db.noteSearch.delete(node.id).catch(() => {});
    ctx.notes.remove(node.id).catch(() => {});
  }

  return { data: true, events };
}

export async function createEdge(
  ctx: CommandContext,
  input: CreateEdgeInput,
): Promise<CommandResult<GraphEdge | null>> {
  const row = await ctx.db.edges.create({
    sourceId: input.sourceId,
    targetId: input.targetId,
    label: input.label,
    type: input.type,
    properties: JSON.stringify(input.properties ?? {}),
    weight: input.weight,
    directed: input.directed,
    sourceUrl: input.sourceUrl,
  });
  if (!row) return { data: null, events: [] };
  const edge = dbEdgeToGraphEdge(row);

  if (!input.skipProvenance) {
    ctx.db.edgeSources
      .add({ edgeId: edge.id, sourceType: 'user' })
      .catch(() => {});
  }

  return { data: edge, events: [{ type: 'edge_created', edge: row }] };
}

export async function updateEdge(
  ctx: CommandContext,
  input: UpdateEdgeInput,
): Promise<CommandResult<GraphEdge | null>> {
  const row = await ctx.db.edges.update({
    id: input.id,
    label: input.label,
    type: input.type,
    properties: input.properties ? JSON.stringify(input.properties) : undefined,
    weight: input.weight,
  });
  if (!row) return { data: null, events: [] };
  const edge = dbEdgeToGraphEdge(row);
  return { data: edge, events: [{ type: 'edge_updated', edge: row }] };
}

export async function deleteEdge(
  ctx: CommandContext,
  id: string,
): Promise<CommandResult<boolean>> {
  const success = await ctx.db.edges.delete(id);
  if (!success) return { data: false, events: [] };
  return { data: true, events: [{ type: 'edge_deleted', id }] };
}

export async function clearAll(
  ctx: CommandContext,
): Promise<CommandResult<boolean>> {
  await ctx.db.clearAll();
  return { data: true, events: [{ type: 'reset' }] };
}
