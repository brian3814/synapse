import type { KnowledgeService } from './knowledge-service';
import type {
  SearchResult, EntityDetail, CreateEntityInput, UpdateEntityInput,
  EntityResult, MergeResult, MutationResult, NeighborResult, NeighborNode,
  CreateRelationshipInput, UpdateRelationshipInput, RelationshipResult,
  NoteResult, AnalysisType, AnalysisResult, GraphChangeEvent,
  EntityEdge, EntitySource,
} from './types';
import type { CommandContext, CommandEvent } from '../commands/types';
import type { DbNode, DbEdge } from '../shared/types';
import * as graphCommands from '../commands/graph-commands';
import { saveNote } from '../commands/note-commands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert CommandResult.events into MutationResult.effects.
 */
function eventsToEffects(events: CommandEvent[]): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  for (const e of events) {
    if ('node' in e) nodeIds.push((e as any).node.id);
    if ('id' in e && e.type.startsWith('node_')) nodeIds.push((e as any).id);
    if ('edge' in e) edgeIds.push((e as any).edge.id);
    if ('id' in e && e.type.startsWith('edge_')) edgeIds.push((e as any).id);
  }
  return { nodeIds, edgeIds };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DefaultKnowledgeService implements KnowledgeService {
  private ctx: CommandContext;
  private changeListeners = new Set<(event: GraphChangeEvent) => void>();

  constructor(ctx: CommandContext) {
    this.ctx = ctx;
  }

  // ── Search ────────────────────────────────────────────────────────

  async search(params: {
    query: string;
    scope?: 'all' | 'entities' | 'notes' | 'semantic';
    limit?: number;
  }): Promise<SearchResult[]> {
    const { query, scope = 'all', limit = 20 } = params;
    const results: SearchResult[] = [];

    if (scope === 'semantic') {
      return this.searchSemantic(query, limit);
    }

    if (scope === 'entities' || scope === 'all') {
      const nodes = await this.ctx.db.nodes.search(query, limit);
      for (const n of nodes) {
        results.push({
          id: n.id,
          name: n.name,
          type: n.type,
          label: n.label,
          score: 1,
          source: 'entity',
        });
      }
    }

    if (scope === 'notes' || scope === 'all') {
      const notes = await this.ctx.db.noteSearch.search(query, limit);
      for (const n of notes) {
        results.push({
          id: n.node_id,
          name: n.title,
          type: 'note',
          label: null,
          score: 1,
          snippet: n.snippet,
          source: 'note',
        });
      }
    }

    return results;
  }

  private async searchSemantic(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.ctx.embedding) {
      return [{ error: 'Semantic search requires embeddings to be enabled' } as any];
    }

    const semanticResults = await this.ctx.embedding.searchSimilar(query, limit);
    const results: SearchResult[] = [];

    for (const sr of semanticResults) {
      const node = await this.ctx.db.nodes.getById(sr.nodeId);
      if (!node) continue;
      results.push({
        id: sr.nodeId,
        name: node.name,
        type: node.type,
        label: node.label,
        score: sr.score,
        source: 'semantic',
      });
    }

    return results;
  }

  // ── Entity CRUD ───────────────────────────────────────────────────

  async getEntity(id: string): Promise<EntityDetail | null> {
    const node = await this.ctx.db.nodes.getById(id);
    if (!node) return null;

    // Fetch edges for this node
    const dbEdges = await this.ctx.db.edges.getForNode(id);

    // Resolve neighbor names
    const edges: EntityEdge[] = [];
    for (const e of dbEdges) {
      const isOutgoing = e.source_id === id;
      const neighborId = isOutgoing ? e.target_id : e.source_id;
      const neighbor = await this.ctx.db.nodes.getById(neighborId);

      edges.push({
        id: e.id,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        label: e.label,
        type: e.type,
        neighbor_id: neighborId,
        neighbor_name: neighbor?.name ?? '(unknown)',
        neighbor_type: neighbor?.type ?? 'entity',
      });
    }

    // Fetch tags
    const tags = await this.ctx.db.tags.getForNode(id);

    // Fetch aliases
    const aliasRows = await this.ctx.db.entityResolution.getAliases(id);
    const aliases = aliasRows.map((a) => a.alias);

    // Fetch sources
    const sourceRows = await this.ctx.db.entitySources.getForEntity(id);
    const sources: EntitySource[] = [];
    for (const sr of sourceRows) {
      const resource = await this.ctx.db.nodes.getById(sr.resourceId);
      sources.push({
        url: resource?.source_url ?? '',
        title: resource?.name ?? null,
      });
    }

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      label: node.label,
      summary: node.summary,
      properties: JSON.parse(node.properties || '{}'),
      aliases,
      tags,
      edges,
      sources,
      created_at: node.created_at,
      updated_at: node.updated_at,
    };
  }

  async createEntity(input: CreateEntityInput): Promise<MutationResult<EntityResult>> {
    const result = await graphCommands.createNode(this.ctx, {
      name: input.name,
      type: 'entity',
      label: input.label,
      properties: input.properties,
    });

    if (!result.data) {
      throw new Error('Failed to create entity');
    }

    const nodeId = result.data.id;

    // Set tags if provided
    if (input.tags && input.tags.length > 0) {
      await this.ctx.db.tags.setForNode(nodeId, input.tags);
    }

    // Add aliases if provided
    if (input.aliases && input.aliases.length > 0) {
      for (const alias of input.aliases) {
        await this.ctx.db.entityResolution.addAlias(nodeId, alias);
      }
    }

    const effects = eventsToEffects(result.events);
    return {
      data: {
        id: nodeId,
        name: result.data.name,
        type: result.data.type,
        action: 'created',
      },
      effects,
    };
  }

  async updateEntity(input: UpdateEntityInput): Promise<MutationResult<EntityResult>> {
    const updateInput: any = { id: input.entity_id };
    if (input.name !== undefined) updateInput.name = input.name;
    if (input.label !== undefined) updateInput.label = input.label;
    if (input.properties !== undefined) updateInput.properties = input.properties;

    const result = await graphCommands.updateNode(this.ctx, updateInput);

    if (!result.data) {
      throw new Error('Entity not found');
    }

    // Update tags if provided
    if (input.tags !== undefined) {
      await this.ctx.db.tags.setForNode(input.entity_id, input.tags);
    }

    // Update aliases if provided
    if (input.aliases !== undefined) {
      // Remove existing aliases
      const existing = await this.ctx.db.entityResolution.getAliases(input.entity_id);
      for (const a of existing) {
        await this.ctx.db.entityResolution.removeAlias(a.id);
      }
      // Add new aliases
      for (const alias of input.aliases) {
        await this.ctx.db.entityResolution.addAlias(input.entity_id, alias);
      }
    }

    const effects = eventsToEffects(result.events);
    return {
      data: {
        id: result.data.id,
        name: result.data.name,
        type: result.data.type,
        action: 'updated',
      },
      effects,
    };
  }

  async deleteEntities(ids: string[]): Promise<MutationResult<{ deleted: number }>> {
    const allEffects: { nodeIds: string[]; edgeIds: string[] } = { nodeIds: [], edgeIds: [] };
    let deleted = 0;

    for (const id of ids) {
      const result = await graphCommands.deleteNode(this.ctx, id);
      if (result.data) {
        deleted++;
        const effects = eventsToEffects(result.events);
        allEffects.nodeIds.push(...effects.nodeIds);
        allEffects.edgeIds.push(...effects.edgeIds);
      }
    }

    return {
      data: { deleted },
      effects: allEffects,
    };
  }

  async mergeEntities(
    primary_id: string,
    secondary_id: string,
  ): Promise<MutationResult<MergeResult>> {
    const primary = await this.ctx.db.nodes.getById(primary_id);
    const secondary = await this.ctx.db.nodes.getById(secondary_id);

    if (!primary) throw new Error(`Primary entity ${primary_id} not found`);
    if (!secondary) throw new Error(`Secondary entity ${secondary_id} not found`);

    const allEffects: { nodeIds: string[]; edgeIds: string[] } = { nodeIds: [], edgeIds: [] };

    // 1. Transfer edges from secondary to primary
    const secondaryEdges = await this.ctx.db.edges.getForNode(secondary_id);
    let edgesTransferred = 0;

    for (const edge of secondaryEdges) {
      const isSource = edge.source_id === secondary_id;
      const newSourceId = isSource ? primary_id : edge.source_id;
      const newTargetId = isSource ? edge.target_id : primary_id;

      // Skip self-loops (edge between primary and secondary)
      if (newSourceId === newTargetId) continue;

      // Create new edge pointing to/from primary
      const createResult = await graphCommands.createEdge(this.ctx, {
        sourceId: newSourceId,
        targetId: newTargetId,
        label: edge.label,
        type: edge.type,
        properties: JSON.parse(edge.properties || '{}'),
        weight: edge.weight,
        directed: edge.directed === 1,
        skipProvenance: true,
      });

      if (createResult.data) {
        edgesTransferred++;
        const effects = eventsToEffects(createResult.events);
        allEffects.edgeIds.push(...effects.edgeIds);
      }

      // Delete old edge
      const deleteResult = await graphCommands.deleteEdge(this.ctx, edge.id);
      const delEffects = eventsToEffects(deleteResult.events);
      allEffects.edgeIds.push(...delEffects.edgeIds);
    }

    // 2. Add secondary's name as alias on primary
    await this.ctx.db.entityResolution.addAlias(primary_id, secondary.name);

    // 3. Delete secondary node
    const deleteResult = await graphCommands.deleteNode(this.ctx, secondary_id);
    const deleteEffects = eventsToEffects(deleteResult.events);
    allEffects.nodeIds.push(...deleteEffects.nodeIds);

    return {
      data: {
        primary_id,
        secondary_id,
        edges_transferred: edgesTransferred,
        alias_added: secondary.name,
      },
      effects: allEffects,
    };
  }

  // ── Neighbors ─────────────────────────────────────────────────────

  async getNeighbors(params: {
    entity_id: string;
    depth?: number;
    limit?: number;
  }): Promise<NeighborResult> {
    const { entity_id, depth = 1, limit = 50 } = params;
    const nodes: NeighborNode[] = [];
    const visited = new Set<string>([entity_id]);

    // BFS traversal
    let frontier = [entity_id];

    for (let d = 1; d <= depth && nodes.length < limit; d++) {
      const nextFrontier: string[] = [];

      for (const nodeId of frontier) {
        const edges = await this.ctx.db.edges.getForNode(nodeId);

        for (const edge of edges) {
          if (nodes.length >= limit) break;

          const isOutgoing = edge.source_id === nodeId;
          const neighborId = isOutgoing ? edge.target_id : edge.source_id;

          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const neighbor = await this.ctx.db.nodes.getById(neighborId);
          if (!neighbor) continue;

          nodes.push({
            id: neighbor.id,
            name: neighbor.name,
            type: neighbor.type,
            label: neighbor.label,
            edge_label: edge.label,
            edge_direction: isOutgoing ? 'outgoing' : 'incoming',
            depth: d,
          });

          nextFrontier.push(neighborId);
        }
      }

      frontier = nextFrontier;
    }

    return {
      root_id: entity_id,
      nodes,
      total: nodes.length,
    };
  }

  // ── Relationships ─────────────────────────────────────────────────

  async createRelationship(input: CreateRelationshipInput): Promise<MutationResult<RelationshipResult>> {
    const result = await graphCommands.createEdge(this.ctx, {
      sourceId: input.source_id,
      targetId: input.target_id,
      label: input.label,
      type: input.type,
    });

    if (!result.data) {
      throw new Error('Failed to create relationship');
    }

    const effects = eventsToEffects(result.events);
    return {
      data: {
        id: result.data.id,
        action: 'created',
      },
      effects,
    };
  }

  async updateRelationship(input: UpdateRelationshipInput): Promise<MutationResult<RelationshipResult>> {
    const updateInput: any = { id: input.relationship_id };
    if (input.label !== undefined) updateInput.label = input.label;
    if (input.type !== undefined) updateInput.type = input.type;

    const result = await graphCommands.updateEdge(this.ctx, updateInput);

    if (!result.data) {
      throw new Error('Relationship not found');
    }

    const effects = eventsToEffects(result.events);
    return {
      data: {
        id: result.data.id,
        action: 'updated',
      },
      effects,
    };
  }

  async deleteRelationships(ids: string[]): Promise<MutationResult<{ deleted: number }>> {
    const allEffects: { nodeIds: string[]; edgeIds: string[] } = { nodeIds: [], edgeIds: [] };
    let deleted = 0;

    for (const id of ids) {
      const result = await graphCommands.deleteEdge(this.ctx, id);
      if (result.data) {
        deleted++;
        const effects = eventsToEffects(result.events);
        allEffects.edgeIds.push(...effects.edgeIds);
      }
    }

    return {
      data: { deleted },
      effects: allEffects,
    };
  }

  // ── Notes ─────────────────────────────────────────────────────────

  async readNote(note_id: string): Promise<NoteResult> {
    const node = await this.ctx.db.nodes.getById(note_id);
    if (!node) {
      throw new Error(`Note ${note_id} not found`);
    }

    const content = await this.ctx.notes.read(note_id);

    return {
      id: note_id,
      title: node.name,
      action: 'read',
      content: content ?? undefined,
    };
  }

  async createNote(title: string, content: string): Promise<MutationResult<NoteResult>> {
    const result = await saveNote(this.ctx, {
      nodeId: null,
      name: title,
      content,
      isNew: true,
    });

    return {
      data: {
        id: result.nodeId,
        title,
        action: 'created',
      },
      effects: {
        nodeIds: [result.nodeId],
        edgeIds: [],
      },
    };
  }

  async updateNote(
    note_id: string,
    updates: { title?: string; content?: string },
  ): Promise<MutationResult<NoteResult>> {
    const node = await this.ctx.db.nodes.getById(note_id);
    if (!node) {
      throw new Error(`Note ${note_id} not found`);
    }

    const title = updates.title ?? node.name;
    const content = updates.content ?? await this.ctx.notes.read(note_id) ?? '';

    await saveNote(this.ctx, {
      nodeId: note_id,
      name: title,
      content,
      isNew: false,
    });

    return {
      data: {
        id: note_id,
        title,
        action: 'updated',
      },
      effects: {
        nodeIds: [note_id],
        edgeIds: [],
      },
    };
  }

  // ── Analysis ──────────────────────────────────────────────────────

  async analyzeGraph(
    analysis: AnalysisType,
    options?: Record<string, unknown>,
  ): Promise<AnalysisResult> {
    switch (analysis) {
      case 'overview':
        return this.analyzeOverview();
      case 'health':
        return this.analyzeHealth();
      case 'centrality':
        return this.analyzeCentrality(options);
      case 'orphans':
        return this.analyzeOrphans();
      case 'paths':
        return this.analyzePaths(options);
      default:
        throw new Error(`Unknown analysis type: ${analysis}`);
    }
  }

  private async analyzeOverview(): Promise<AnalysisResult> {
    const [entities, notes, resources, edges] = await Promise.all([
      this.ctx.db.rawQuery<{ count: number }>(
        "SELECT COUNT(*) as count FROM nodes WHERE type = 'entity'",
      ),
      this.ctx.db.rawQuery<{ count: number }>(
        "SELECT COUNT(*) as count FROM nodes WHERE type = 'note'",
      ),
      this.ctx.db.rawQuery<{ count: number }>(
        "SELECT COUNT(*) as count FROM nodes WHERE type = 'resource'",
      ),
      this.ctx.db.rawQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM edges',
      ),
    ]);

    return {
      analysis: 'overview',
      data: {
        entity_count: entities[0]?.count ?? 0,
        note_count: notes[0]?.count ?? 0,
        resource_count: resources[0]?.count ?? 0,
        edge_count: edges[0]?.count ?? 0,
      },
    };
  }

  private async analyzeHealth(): Promise<AnalysisResult> {
    const [nodeCount, edgeCount, orphanCount, componentInfo] = await Promise.all([
      this.ctx.db.rawQuery<{ count: number }>('SELECT COUNT(*) as count FROM nodes'),
      this.ctx.db.rawQuery<{ count: number }>('SELECT COUNT(*) as count FROM edges'),
      this.ctx.db.rawQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM nodes n
         WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)`,
      ),
      this.ctx.db.rawQuery<{ count: number }>(
        'SELECT COUNT(DISTINCT label) as count FROM edges',
      ),
    ]);

    const nodes = nodeCount[0]?.count ?? 0;
    const edgesTotal = edgeCount[0]?.count ?? 0;
    const orphans = orphanCount[0]?.count ?? 0;
    const edgeTypes = componentInfo[0]?.count ?? 0;

    return {
      analysis: 'health',
      data: {
        total_nodes: nodes,
        total_edges: edgesTotal,
        orphan_nodes: orphans,
        edge_types: edgeTypes,
        density: nodes > 1 ? (2 * edgesTotal) / (nodes * (nodes - 1)) : 0,
      },
    };
  }

  private async analyzeCentrality(
    options?: Record<string, unknown>,
  ): Promise<AnalysisResult> {
    const limit = (options?.limit as number) ?? 20;

    const rankings = await this.ctx.db.rawQuery<{
      id: string;
      name: string;
      type: string;
      label: string | null;
      degree: number;
    }>(
      `SELECT n.id, n.name, n.type, n.label,
              (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) as degree
       FROM nodes n
       ORDER BY degree DESC
       LIMIT ?`,
      [limit],
    );

    return {
      analysis: 'centrality',
      data: { rankings },
    };
  }

  private async analyzeOrphans(): Promise<AnalysisResult> {
    const orphans = await this.ctx.db.rawQuery<{
      id: string;
      name: string;
      type: string;
      label: string | null;
    }>(
      `SELECT n.id, n.name, n.type, n.label FROM nodes n
       WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)`,
    );

    return {
      analysis: 'orphans',
      data: { orphans },
    };
  }

  private async analyzePaths(
    options?: Record<string, unknown>,
  ): Promise<AnalysisResult> {
    const sourceId = options?.source_id as string;
    const targetId = options?.target_id as string;

    if (!sourceId || !targetId) {
      throw new Error('paths analysis requires source_id and target_id options');
    }

    // BFS to find shortest path
    const allEdges = await this.ctx.db.edges.getAll();

    // Build adjacency list
    const adjacency = new Map<string, Array<{ neighborId: string; edgeId: string }>>();
    for (const edge of allEdges) {
      if (!adjacency.has(edge.source_id)) adjacency.set(edge.source_id, []);
      if (!adjacency.has(edge.target_id)) adjacency.set(edge.target_id, []);
      adjacency.get(edge.source_id)!.push({ neighborId: edge.target_id, edgeId: edge.id });
      adjacency.get(edge.target_id)!.push({ neighborId: edge.source_id, edgeId: edge.id });
    }

    // BFS
    const visited = new Set<string>([sourceId]);
    const parent = new Map<string, { from: string; edgeId: string }>();
    const queue = [sourceId];
    let found = false;

    while (queue.length > 0 && !found) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current) ?? [];

      for (const { neighborId, edgeId } of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        parent.set(neighborId, { from: current, edgeId });

        if (neighborId === targetId) {
          found = true;
          break;
        }

        queue.push(neighborId);
      }
    }

    if (!found) {
      return {
        analysis: 'paths',
        data: { paths: [], message: 'No path found between the specified nodes' },
      };
    }

    // Reconstruct path
    const path: Array<{ id: string; name: string }> = [];
    let current = targetId;
    while (current !== sourceId) {
      const node = await this.ctx.db.nodes.getById(current);
      path.unshift({ id: current, name: node?.name ?? current });
      const p = parent.get(current);
      if (!p) break;
      current = p.from;
    }
    const sourceNode = await this.ctx.db.nodes.getById(sourceId);
    path.unshift({ id: sourceId, name: sourceNode?.name ?? sourceId });

    return {
      analysis: 'paths',
      data: {
        paths: [{ nodes: path, length: path.length - 1 }],
      },
    };
  }

  // ── Events ────────────────────────────────────────────────────────

  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  /** Emit a graph change event to all listeners. */
  protected emitChange(event: GraphChangeEvent): void {
    for (const cb of this.changeListeners) {
      try {
        cb(event);
      } catch {
        // Listener errors should not crash the service
      }
    }
  }
}
