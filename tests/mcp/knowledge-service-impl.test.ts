import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultKnowledgeService } from '../../src/mcp/knowledge-service-impl';
import type { CommandContext, CommandEvent } from '../../src/commands/types';
import type { DbNode, DbEdge } from '../../src/shared/types';
import * as graphCommands from '../../src/commands/graph-commands';
import * as noteCommands from '../../src/commands/note-commands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDbNode(overrides: Partial<DbNode> = {}): DbNode {
  return {
    id: overrides.id ?? 'node-1',
    identifier: overrides.identifier ?? null,
    name: overrides.name ?? 'Test Entity',
    type: overrides.type ?? 'entity',
    label: overrides.label ?? 'concept',
    summary: overrides.summary ?? null,
    properties: overrides.properties ?? '{}',
    x: overrides.x ?? null,
    y: overrides.y ?? null,
    color: overrides.color ?? null,
    size: overrides.size ?? 1,
    source_url: overrides.source_url ?? null,
    vault_path: overrides.vault_path ?? null,
    file_mtime: overrides.file_mtime ?? null,
    file_size: overrides.file_size ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
  };
}

function makeDbEdge(overrides: Partial<DbEdge> = {}): DbEdge {
  return {
    id: overrides.id ?? 'edge-1',
    source_id: overrides.source_id ?? 'node-1',
    target_id: overrides.target_id ?? 'node-2',
    label: overrides.label ?? 'related_to',
    type: overrides.type ?? 'relationship',
    properties: overrides.properties ?? '{}',
    weight: overrides.weight ?? 1,
    directed: overrides.directed ?? 1,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
  };
}

function makeMockCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    db: {
      nodes: {
        getAll: vi.fn().mockResolvedValue([]),
        getAllSlim: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
        getTypes: vi.fn().mockResolvedValue([]),
        matchTerms: vi.fn().mockResolvedValue([]),
        getNeighborhood: vi.fn().mockResolvedValue({ nodeIds: [] }),
      },
      edges: {
        getAll: vi.fn().mockResolvedValue([]),
        getAllSlim: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        getForNode: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        getTypes: vi.fn().mockResolvedValue([]),
        search: vi.fn().mockResolvedValue([]),
        getBetween: vi.fn().mockResolvedValue([]),
        getOntologyEdgeTypes: vi.fn().mockResolvedValue([]),
        getDistinctEdgeLabels: vi.fn().mockResolvedValue([]),
        createOntologyEdgeType: vi.fn(),
      },
      nodeTypes: {
        getAll: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        delete: vi.fn(),
        getDistinctEntityLabels: vi.fn().mockResolvedValue([]),
      },
      sourceContent: {
        save: vi.fn(),
        getByNodeId: vi.fn().mockResolvedValue(null),
        getByUrl: vi.fn().mockResolvedValue(null),
        search: vi.fn().mockResolvedValue([]),
        deleteByNodeId: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
      },
      entityResolution: {
        findMatches: vi.fn().mockResolvedValue([]),
        addAlias: vi.fn().mockResolvedValue({ id: 'alias-1', node_id: 'node-1', alias: 'test', alias_lower: 'test' }),
        getAliases: vi.fn().mockResolvedValue([]),
        removeAlias: vi.fn().mockResolvedValue(true),
      },
      tags: {
        getForNode: vi.fn().mockResolvedValue([]),
        setForNode: vi.fn(),
        getAllTags: vi.fn().mockResolvedValue([]),
      },
      edgeSources: {
        add: vi.fn().mockResolvedValue(undefined),
        getForEdge: vi.fn().mockResolvedValue([]),
        removeForNote: vi.fn(),
        getEdgesFromNote: vi.fn().mockResolvedValue([]),
      },
      entitySources: {
        getForEntity: vi.fn().mockResolvedValue([]),
        add: vi.fn(),
        remove: vi.fn(),
        removeAllForResource: vi.fn(),
        getEntitiesForResource: vi.fn().mockResolvedValue([]),
      },
      spatial: {
        batchUpdatePositions: vi.fn(),
        nodesInBounds: vi.fn().mockResolvedValue([]),
        edgesForNodes: vi.fn().mockResolvedValue([]),
        clusterSummary: vi.fn().mockResolvedValue([]),
        interClusterEdges: vi.fn().mockResolvedValue([]),
        nodeCountInBounds: vi.fn(),
        totalNodeCount: vi.fn().mockResolvedValue(0),
        nodeDegrees: vi.fn().mockResolvedValue([]),
      },
      readingList: {
        save: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
        getByUrl: vi.fn().mockResolvedValue(null),
        getRecent: vi.fn().mockResolvedValue([]),
      },
      chat: {
        getActiveSession: vi.fn().mockResolvedValue(null),
        createSession: vi.fn(),
        expireSession: vi.fn(),
        expireStale: vi.fn(),
        touchSession: vi.fn(),
        pruneSessions: vi.fn(),
        saveMessage: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
        getRecentMessages: vi.fn().mockResolvedValue([]),
        getAllSessions: vi.fn().mockResolvedValue([]),
      },
      noteAttachments: {
        create: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
        getForNote: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
      noteSearch: {
        upsert: vi.fn(),
        delete: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
        getEntry: vi.fn().mockResolvedValue(null),
        getAll: vi.fn().mockResolvedValue([]),
      },
      stressTest: {
        generate: vi.fn(),
      },
      init: vi.fn(),
      reset: vi.fn(),
      loadGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      clearAll: vi.fn(),
      graphQuery: vi.fn(),
      graphMutate: vi.fn(),
      rawQuery: vi.fn().mockResolvedValue([]),
      rawExec: vi.fn().mockResolvedValue(0),
    } as any,
    storage: {} as any,
    notes: {
      read: vi.fn(),
      write: vi.fn(),
      remove: vi.fn(),
      list: vi.fn(),
    } as any,
    files: {} as any,
    llm: {} as any,
    browser: {} as any,
    getGraphSnapshot: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    ...overrides,
  } as CommandContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DefaultKnowledgeService', () => {
  let ctx: CommandContext;
  let service: DefaultKnowledgeService;

  beforeEach(() => {
    ctx = makeMockCtx();
    service = new DefaultKnowledgeService(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searches entities when scope is "entities"', async () => {
      const node = makeDbNode({ id: 'n1', name: 'AI', label: 'concept' });
      (ctx.db.nodes.search as any).mockResolvedValue([node]);

      const results = await service.search({ query: 'AI', scope: 'entities' });

      expect(ctx.db.nodes.search).toHaveBeenCalledWith('AI', 20);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'n1',
        name: 'AI',
        type: 'entity',
        label: 'concept',
        source: 'entity',
      });
    });

    it('searches notes when scope is "notes"', async () => {
      (ctx.db.noteSearch.search as any).mockResolvedValue([
        { node_id: 'note-1', title: 'My Note', snippet: 'snippet text' },
      ]);

      const results = await service.search({ query: 'note', scope: 'notes' });

      expect(ctx.db.noteSearch.search).toHaveBeenCalledWith('note', 20);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'note-1',
        name: 'My Note',
        source: 'note',
        snippet: 'snippet text',
      });
    });

    it('throws when scope is "semantic" but embedding is unavailable', async () => {
      await expect(service.search({ query: 'test', scope: 'semantic' })).rejects.toThrow(
        'Semantic search requires embeddings to be enabled',
      );
    });

    it('resolves semantic search results to names/types', async () => {
      const ctxWithEmbed = makeMockCtx({
        embedding: {
          searchSimilar: vi.fn().mockResolvedValue([
            { nodeId: 'n1', score: 0.95 },
          ]),
        },
      });
      const node = makeDbNode({ id: 'n1', name: 'Neural Net', label: 'technology' });
      (ctxWithEmbed.db.nodes.getById as any).mockResolvedValue(node);

      const svc = new DefaultKnowledgeService(ctxWithEmbed);
      const results = await svc.search({ query: 'neural', scope: 'semantic' });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'n1',
        name: 'Neural Net',
        type: 'entity',
        score: 0.95,
        source: 'semantic',
      });
    });

    it('searches all scopes when scope is "all" or unset', async () => {
      const node = makeDbNode({ id: 'n1', name: 'Node' });
      (ctx.db.nodes.search as any).mockResolvedValue([node]);
      (ctx.db.noteSearch.search as any).mockResolvedValue([
        { node_id: 'note-1', title: 'Note', snippet: 'snippet' },
      ]);

      const results = await service.search({ query: 'test' });

      expect(ctx.db.nodes.search).toHaveBeenCalled();
      expect(ctx.db.noteSearch.search).toHaveBeenCalled();
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Entity CRUD ─────────────────────────────────────────────────────

  describe('createEntity', () => {
    it('delegates to graphCommands.createNode and returns effects', async () => {
      const mockDbNode = makeDbNode({ id: 'new-1', name: 'Machine Learning', label: 'concept' });
      const mockGraphNode = {
        id: 'new-1', name: 'Machine Learning', type: 'entity', label: 'concept',
        identifier: null, summary: null, properties: {}, size: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };
      const createNodeSpy = vi.spyOn(graphCommands, 'createNode').mockResolvedValue({
        data: mockGraphNode,
        events: [{ type: 'node_created', node: mockDbNode }],
      });

      const result = await service.createEntity({
        name: 'Machine Learning',
        label: 'concept',
        properties: { domain: 'AI' },
      });

      expect(createNodeSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        type: 'entity',
        name: 'Machine Learning',
        label: 'concept',
      }));

      expect(result.data).toMatchObject({
        id: 'new-1',
        name: 'Machine Learning',
        action: 'created',
      });
      expect(result.effects.nodeIds).toContain('new-1');
    });

    it('sets tags after creation if provided', async () => {
      const mockDbNode = makeDbNode({ id: 'new-2', name: 'Test' });
      const mockGraphNode = {
        id: 'new-2', name: 'Test', type: 'entity', label: 'concept',
        identifier: null, summary: null, properties: {}, size: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };
      vi.spyOn(graphCommands, 'createNode').mockResolvedValue({
        data: mockGraphNode,
        events: [{ type: 'node_created', node: mockDbNode }],
      });

      await service.createEntity({
        name: 'Test',
        label: 'concept',
        tags: ['ai', 'ml'],
      });

      expect(ctx.db.tags.setForNode).toHaveBeenCalledWith('new-2', ['ai', 'ml']);
    });

    it('adds aliases after creation if provided', async () => {
      const mockDbNode = makeDbNode({ id: 'new-3', name: 'Test' });
      const mockGraphNode = {
        id: 'new-3', name: 'Test', type: 'entity', label: 'concept',
        identifier: null, summary: null, properties: {}, size: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };
      vi.spyOn(graphCommands, 'createNode').mockResolvedValue({
        data: mockGraphNode,
        events: [{ type: 'node_created', node: mockDbNode }],
      });

      await service.createEntity({
        name: 'Test',
        label: 'concept',
        aliases: ['alias1', 'alias2'],
      });

      expect(ctx.db.entityResolution.addAlias).toHaveBeenCalledTimes(2);
      expect(ctx.db.entityResolution.addAlias).toHaveBeenCalledWith('new-3', 'alias1');
      expect(ctx.db.entityResolution.addAlias).toHaveBeenCalledWith('new-3', 'alias2');
    });
  });

  describe('updateEntity', () => {
    it('delegates to graphCommands.updateNode', async () => {
      const node = makeDbNode({ id: 'n1', name: 'Updated', label: 'person' });
      (ctx.db.nodes.update as any).mockResolvedValue(node);

      const result = await service.updateEntity({
        entity_id: 'n1',
        name: 'Updated',
        label: 'person',
      });

      expect(ctx.db.nodes.update).toHaveBeenCalled();
      expect(result.data).toMatchObject({ id: 'n1', name: 'Updated', action: 'updated' });
      expect(result.effects.nodeIds).toContain('n1');
    });
  });

  describe('deleteEntities', () => {
    it('deletes multiple entities and collects effects', async () => {
      const deleteNodeSpy = vi.spyOn(graphCommands, 'deleteNode')
        .mockResolvedValueOnce({ data: true, events: [{ type: 'node_deleted', node: makeDbNode({ id: 'n1' }) }] })
        .mockResolvedValueOnce({ data: true, events: [{ type: 'node_deleted', node: makeDbNode({ id: 'n2' }) }] });

      const result = await service.deleteEntities(['n1', 'n2']);

      expect(deleteNodeSpy).toHaveBeenCalledTimes(2);
      expect(deleteNodeSpy).toHaveBeenCalledWith(expect.anything(), 'n1');
      expect(deleteNodeSpy).toHaveBeenCalledWith(expect.anything(), 'n2');
      expect(result.data.deleted).toBe(2);
      expect(result.effects.nodeIds).toContain('n1');
      expect(result.effects.nodeIds).toContain('n2');
    });
  });

  // ── Mutation effect extraction ──────────────────────────────────────

  describe('effect extraction', () => {
    it('extracts node and edge IDs from CommandEvents', async () => {
      const mockDbNode = makeDbNode({ id: 'eff-1' });
      const mockGraphNode = {
        id: 'eff-1', name: 'Test', type: 'entity', label: 'concept',
        identifier: null, summary: null, properties: {}, size: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };
      vi.spyOn(graphCommands, 'createNode').mockResolvedValue({
        data: mockGraphNode,
        events: [{ type: 'node_created', node: mockDbNode }],
      });

      const result = await service.createEntity({ name: 'Test', label: 'concept' });

      // node_created event should produce nodeIds
      expect(result.effects.nodeIds).toEqual(['eff-1']);
      expect(result.effects.edgeIds).toEqual([]);
    });
  });

  // ── Note operations ─────────────────────────────────────────────────

  describe('createNote', () => {
    it('delegates to noteCommands.saveNote', async () => {
      const saveNoteSpy = vi.spyOn(noteCommands, 'saveNote').mockResolvedValue({ nodeId: 'note-new' });

      const result = await service.createNote('My Note', 'Some content');

      expect(saveNoteSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        nodeId: null,
        name: 'My Note',
        content: 'Some content',
        isNew: true,
      }));

      expect(result.data).toMatchObject({
        id: 'note-new',
        title: 'My Note',
        action: 'created',
      });
    });
  });

  describe('updateNote', () => {
    it('delegates to noteCommands.saveNote with isNew=false', async () => {
      const noteNode = makeDbNode({ id: 'note-1', name: 'Existing Note', type: 'note' });
      (ctx.db.nodes.getById as any).mockResolvedValue(noteNode);
      (ctx.notes.read as any).mockResolvedValue('existing body');
      const saveNoteSpy = vi.spyOn(noteCommands, 'saveNote').mockResolvedValue({ nodeId: 'note-1' });

      const result = await service.updateNote('note-1', { title: 'Updated', content: 'new content' });

      expect(saveNoteSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        nodeId: 'note-1',
        name: 'Updated',
        content: 'new content',
        isNew: false,
      }));
      expect(result.data).toMatchObject({ id: 'note-1', action: 'updated' });
    });

    it('preserves existing content when only title is updated', async () => {
      const noteNode = makeDbNode({ id: 'note-2', name: 'Old Title', type: 'note' });
      (ctx.db.nodes.getById as any).mockResolvedValue(noteNode);
      (ctx.notes.read as any).mockResolvedValue('preserved body text');
      const saveNoteSpy = vi.spyOn(noteCommands, 'saveNote').mockResolvedValue({ nodeId: 'note-2' });

      await service.updateNote('note-2', { title: 'New Title' });

      expect(saveNoteSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        nodeId: 'note-2',
        name: 'New Title',
        content: 'preserved body text',
        isNew: false,
      }));
    });
  });

  describe('readNote', () => {
    it('reads note content via platform notes', async () => {
      const noteNode = makeDbNode({ id: 'note-1', name: 'My Note', type: 'note' });
      (ctx.db.nodes.getById as any).mockResolvedValue(noteNode);
      (ctx.notes.read as any).mockResolvedValue('# My Note\n\nContent here');

      const result = await service.readNote('note-1');

      expect(result).toMatchObject({
        id: 'note-1',
        title: 'My Note',
        action: 'read',
        content: '# My Note\n\nContent here',
      });
    });
  });

  // ── Merge entities ──────────────────────────────────────────────────

  describe('mergeEntities', () => {
    it('transfers edges, adds alias, and deletes secondary', async () => {
      const primary = makeDbNode({ id: 'p1', name: 'Primary' });
      const secondary = makeDbNode({ id: 's1', name: 'Secondary' });

      (ctx.db.nodes.getById as any)
        .mockResolvedValueOnce(primary)   // primary lookup
        .mockResolvedValueOnce(secondary); // secondary lookup

      // Edges on secondary node
      const edgeFromSecondary = makeDbEdge({
        id: 'e1',
        source_id: 's1',
        target_id: 'node-3',
      });
      const edgeToSecondary = makeDbEdge({
        id: 'e2',
        source_id: 'node-4',
        target_id: 's1',
      });
      (ctx.db.edges.getForNode as any).mockResolvedValue([edgeFromSecondary, edgeToSecondary]);

      // Edge creation for transfer
      const newEdge1 = makeDbEdge({ id: 'new-e1', source_id: 'p1', target_id: 'node-3' });
      const newEdge2 = makeDbEdge({ id: 'new-e2', source_id: 'node-4', target_id: 'p1' });
      (ctx.db.edges.create as any)
        .mockResolvedValueOnce(newEdge1)
        .mockResolvedValueOnce(newEdge2);
      (ctx.db.edges.delete as any).mockResolvedValue(true);

      // Alias addition
      (ctx.db.entityResolution.addAlias as any).mockResolvedValue({
        id: 'alias-new', node_id: 'p1', alias: 'Secondary', alias_lower: 'secondary',
      });

      // Delete secondary
      (ctx.getGraphSnapshot as any).mockResolvedValue({ nodes: [], edges: [] });
      (ctx.db.nodes.delete as any).mockResolvedValue(true);

      const result = await service.mergeEntities('p1', 's1');

      expect(result.data.primary_id).toBe('p1');
      expect(result.data.secondary_id).toBe('s1');
      expect(result.data.edges_transferred).toBe(2);
      expect(result.data.alias_added).toBe('Secondary');

      // Effects should include both node IDs and the edge IDs
      expect(result.effects.nodeIds).toContain('s1');
      expect(result.effects.edgeIds.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── getEntity ───────────────────────────────────────────────────────

  describe('getEntity', () => {
    it('returns entity detail with resolved neighbor names', async () => {
      const entity = makeDbNode({ id: 'e1', name: 'Alpha', label: 'concept' });
      const neighbor = makeDbNode({ id: 'e2', name: 'Beta', label: 'person' });

      (ctx.db.nodes.getById as any)
        .mockResolvedValueOnce(entity)   // initial entity lookup
        .mockResolvedValueOnce(neighbor); // neighbor resolution

      (ctx.db.edges.getForNode as any).mockResolvedValue([
        makeDbEdge({ id: 'edge-1', source_id: 'e1', target_id: 'e2', label: 'knows' }),
      ]);

      (ctx.db.tags.getForNode as any).mockResolvedValue(['tag1']);
      (ctx.db.entityResolution.getAliases as any).mockResolvedValue([
        { id: 'a1', node_id: 'e1', alias: 'A', alias_lower: 'a' },
      ]);
      (ctx.db.entitySources.getForEntity as any).mockResolvedValue([]);

      const detail = await service.getEntity('e1');

      expect(detail).not.toBeNull();
      expect(detail!.id).toBe('e1');
      expect(detail!.name).toBe('Alpha');
      expect(detail!.tags).toEqual(['tag1']);
      expect(detail!.aliases).toEqual(['A']);
      expect(detail!.edges).toHaveLength(1);
      expect(detail!.edges[0].neighbor_name).toBe('Beta');
      expect(detail!.edges[0].neighbor_type).toBe('entity');
      expect(detail!.edges[0].direction).toBe('outgoing');
    });

    it('returns null when entity not found', async () => {
      (ctx.db.nodes.getById as any).mockResolvedValue(null);
      const detail = await service.getEntity('nonexistent');
      expect(detail).toBeNull();
    });
  });

  // ── Relationships ───────────────────────────────────────────────────

  describe('createRelationship', () => {
    it('delegates to graphCommands.createEdge', async () => {
      const edge = makeDbEdge({ id: 'r1', source_id: 's1', target_id: 't1', label: 'works_at' });
      (ctx.db.edges.create as any).mockResolvedValue(edge);

      const result = await service.createRelationship({
        source_id: 's1',
        target_id: 't1',
        label: 'works_at',
      });

      expect(ctx.db.edges.create).toHaveBeenCalled();
      expect(result.data).toMatchObject({ id: 'r1', action: 'created' });
      expect(result.effects.edgeIds).toContain('r1');
    });
  });

  describe('deleteRelationships', () => {
    it('deletes multiple relationships and collects effects', async () => {
      (ctx.db.edges.delete as any).mockResolvedValue(true);

      const result = await service.deleteRelationships(['r1', 'r2']);

      expect(ctx.db.edges.delete).toHaveBeenCalledTimes(2);
      expect(result.data.deleted).toBe(2);
      expect(result.effects.edgeIds).toContain('r1');
      expect(result.effects.edgeIds).toContain('r2');
    });
  });

  // ── getNeighbors ────────────────────────────────────────────────────

  describe('getNeighbors', () => {
    it('returns neighbor nodes with edge info', async () => {
      const neighbor = makeDbNode({ id: 'n1', name: 'Neighbor', label: 'person' });

      // getNeighbors only calls getById for neighbors, not the root node
      (ctx.db.nodes.getById as any).mockResolvedValueOnce(neighbor);

      (ctx.db.edges.getForNode as any).mockResolvedValue([
        makeDbEdge({ id: 'e1', source_id: 'r1', target_id: 'n1', label: 'knows' }),
      ]);

      const result = await service.getNeighbors({ entity_id: 'r1' });

      expect(result.root_id).toBe('r1');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toMatchObject({
        id: 'n1',
        name: 'Neighbor',
        edge_label: 'knows',
        edge_direction: 'outgoing',
        depth: 1,
      });
    });
  });

  // ── analyzeGraph ────────────────────────────────────────────────────

  describe('analyzeGraph', () => {
    it('returns overview statistics via rawQuery', async () => {
      (ctx.db.rawQuery as any)
        .mockResolvedValueOnce([{ count: 50 }])   // entity count
        .mockResolvedValueOnce([{ count: 5 }])     // note count
        .mockResolvedValueOnce([{ count: 3 }])     // resource count
        .mockResolvedValueOnce([{ count: 100 }]);  // edge count

      const result = await service.analyzeGraph('overview');

      expect(result.analysis).toBe('overview');
      expect(result.data).toMatchObject({
        entity_count: 50,
        note_count: 5,
        resource_count: 3,
        edge_count: 100,
      });
    });

    it('returns orphan nodes via rawQuery', async () => {
      (ctx.db.rawQuery as any).mockResolvedValue([
        { id: 'o1', name: 'Orphan1', type: 'entity', label: 'concept' },
      ]);

      const result = await service.analyzeGraph('orphans');

      expect(result.analysis).toBe('orphans');
      expect((result.data as any).orphans).toHaveLength(1);
    });

    it('returns centrality ranking via rawQuery', async () => {
      (ctx.db.rawQuery as any).mockResolvedValue([
        { id: 'c1', name: 'Hub', type: 'entity', label: 'concept', degree: 10 },
      ]);

      const result = await service.analyzeGraph('centrality');

      expect(result.analysis).toBe('centrality');
      expect((result.data as any).rankings).toHaveLength(1);
      expect((result.data as any).rankings[0].degree).toBe(10);
    });

    it('finds paths between two nodes via BFS', async () => {
      const edges = [
        makeDbEdge({ id: 'e1', source_id: 'a', target_id: 'b', label: 'link' }),
        makeDbEdge({ id: 'e2', source_id: 'b', target_id: 'c', label: 'link' }),
      ];
      (ctx.db.edges.getAll as any).mockResolvedValue(edges);

      const nodeA = makeDbNode({ id: 'a', name: 'A' });
      const nodeB = makeDbNode({ id: 'b', name: 'B' });
      const nodeC = makeDbNode({ id: 'c', name: 'C' });
      (ctx.db.nodes.getById as any)
        .mockResolvedValueOnce(nodeA)
        .mockResolvedValueOnce(nodeB)
        .mockResolvedValueOnce(nodeC);

      const result = await service.analyzeGraph('paths', { source_id: 'a', target_id: 'c' });

      expect(result.analysis).toBe('paths');
      expect((result.data as any).paths).toBeDefined();
      expect((result.data as any).paths.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── onGraphChanged ──────────────────────────────────────────────────

  describe('onGraphChanged', () => {
    it('returns a cleanup function', () => {
      const cb = vi.fn();
      const unsub = service.onGraphChanged(cb);
      expect(typeof unsub).toBe('function');
    });
  });
});
