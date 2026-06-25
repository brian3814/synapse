import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateToolInput } from '../../src/mcp/tools/validation';
import { executeToolHandler } from '../../src/mcp/tools/handlers';
import { ProfilePolicy } from '../../src/mcp/authorization';
import type { KnowledgeService } from '../../src/mcp/knowledge-service';
import type {
  EntityResult, RelationshipResult, NoteResult, MergeResult,
  MutationResult, SearchResult, EntityDetail, NeighborResult, AnalysisResult,
} from '../../src/mcp/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<KnowledgeService> = {}): KnowledgeService {
  return {
    search: vi.fn().mockResolvedValue([] as SearchResult[]),
    getEntity: vi.fn().mockResolvedValue(null),
    createEntity: vi.fn().mockResolvedValue({ data: { id: 'e1', name: 'E', type: 'entity', action: 'created' }, effects: { nodeIds: ['e1'], edgeIds: [] } } satisfies MutationResult<EntityResult>),
    updateEntity: vi.fn().mockResolvedValue({ data: { id: 'e1', name: 'E', type: 'entity', action: 'updated' }, effects: { nodeIds: ['e1'], edgeIds: [] } } satisfies MutationResult<EntityResult>),
    deleteEntities: vi.fn().mockResolvedValue({ data: { deleted: 1 }, effects: { nodeIds: ['e1'], edgeIds: ['edge1'] } } satisfies MutationResult<{ deleted: number }>),
    mergeEntities: vi.fn().mockResolvedValue({ data: { primary_id: 'p1', secondary_id: 's1', edges_transferred: 2, alias_added: 'SecondaryName' }, effects: { nodeIds: ['p1', 's1'], edgeIds: ['r1'] } } satisfies MutationResult<MergeResult>),
    getNeighbors: vi.fn().mockResolvedValue({ root_id: 'e1', nodes: [], total: 0 } satisfies NeighborResult),
    createRelationship: vi.fn().mockResolvedValue({ data: { id: 'r1', action: 'created' }, effects: { nodeIds: [], edgeIds: ['r1'] } } satisfies MutationResult<RelationshipResult>),
    updateRelationship: vi.fn().mockResolvedValue({ data: { id: 'r1', action: 'updated' }, effects: { nodeIds: [], edgeIds: ['r1'] } } satisfies MutationResult<RelationshipResult>),
    deleteRelationships: vi.fn().mockResolvedValue({ data: { deleted: 1 }, effects: { nodeIds: [], edgeIds: ['r1'] } } satisfies MutationResult<{ deleted: number }>),
    readNote: vi.fn().mockResolvedValue({ id: 'n1', title: 'Note', action: 'read', content: '# Hello' } satisfies NoteResult),
    createNote: vi.fn().mockResolvedValue({ data: { id: 'n1', title: 'Note', action: 'created' }, effects: { nodeIds: [], edgeIds: [] } } satisfies MutationResult<NoteResult>),
    updateNote: vi.fn().mockResolvedValue({ data: { id: 'n1', title: 'Note', action: 'updated' }, effects: { nodeIds: [], edgeIds: [] } } satisfies MutationResult<NoteResult>),
    analyzeGraph: vi.fn().mockResolvedValue({ analysis: 'overview', data: { node_count: 5 } } satisfies AnalysisResult),
    onGraphChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

const writePolicy = new ProfilePolicy({ capabilities: ['read', 'write'], blocked_tools: [], blocked_actions: [] });
const readPolicy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });

// ---------------------------------------------------------------------------
// validateToolInput — search
// ---------------------------------------------------------------------------

describe('validateToolInput: search', () => {
  it('passes with query string', () => {
    expect(validateToolInput('search', { query: 'hello' })).toEqual({ valid: true });
  });

  it('fails without query', () => {
    const r = validateToolInput('search', {});
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/query/);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — get_entity
// ---------------------------------------------------------------------------

describe('validateToolInput: get_entity', () => {
  it('passes with entity_id', () => {
    expect(validateToolInput('get_entity', { entity_id: 'abc' })).toEqual({ valid: true });
  });

  it('fails without entity_id', () => {
    const r = validateToolInput('get_entity', {});
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/entity_id/);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — get_neighbors
// ---------------------------------------------------------------------------

describe('validateToolInput: get_neighbors', () => {
  it('passes with entity_id', () => {
    expect(validateToolInput('get_neighbors', { entity_id: 'abc' })).toEqual({ valid: true });
  });

  it('fails without entity_id', () => {
    const r = validateToolInput('get_neighbors', {});
    expect(r.valid).toBe(false);
  });

  it('clamps depth below 1 to 1', () => {
    const r = validateToolInput('get_neighbors', { entity_id: 'abc', depth: 0 });
    expect(r.valid).toBe(true);
  });

  it('clamps depth above 3 to 3', () => {
    const r = validateToolInput('get_neighbors', { entity_id: 'abc', depth: 99 });
    expect(r.valid).toBe(true);
  });

  it('clamps limit below 1 to 1', () => {
    const r = validateToolInput('get_neighbors', { entity_id: 'abc', limit: -5 });
    expect(r.valid).toBe(true);
  });

  it('clamps limit above 200 to 200', () => {
    const r = validateToolInput('get_neighbors', { entity_id: 'abc', limit: 999 });
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — manage_entity
// ---------------------------------------------------------------------------

describe('validateToolInput: manage_entity', () => {
  it('create: passes with name and label', () => {
    expect(validateToolInput('manage_entity', { action: 'create', name: 'Alice', label: 'person' })).toEqual({ valid: true });
  });

  it('create: fails without name', () => {
    const r = validateToolInput('manage_entity', { action: 'create', label: 'person' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/name/);
  });

  it('create: fails without label', () => {
    const r = validateToolInput('manage_entity', { action: 'create', name: 'Alice' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/label/);
  });

  it('update: passes with entity_id', () => {
    expect(validateToolInput('manage_entity', { action: 'update', entity_id: 'e1' })).toEqual({ valid: true });
  });

  it('update: fails without entity_id', () => {
    const r = validateToolInput('manage_entity', { action: 'update' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/entity_id/);
  });

  it('delete: passes with entity_ids array', () => {
    expect(validateToolInput('manage_entity', { action: 'delete', entity_ids: ['e1'] })).toEqual({ valid: true });
  });

  it('delete: fails without entity_ids', () => {
    const r = validateToolInput('manage_entity', { action: 'delete' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/entity_ids/);
  });

  it('delete: fails with empty entity_ids array', () => {
    const r = validateToolInput('manage_entity', { action: 'delete', entity_ids: [] });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/entity_ids/);
  });

  it('fails with unknown action', () => {
    const r = validateToolInput('manage_entity', { action: 'noop' });
    expect(r.valid).toBe(false);
  });

  it('fails without action', () => {
    const r = validateToolInput('manage_entity', { name: 'Alice' });
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — manage_relationship
// ---------------------------------------------------------------------------

describe('validateToolInput: manage_relationship', () => {
  it('create: passes with source_id, target_id, label', () => {
    expect(validateToolInput('manage_relationship', { action: 'create', source_id: 's1', target_id: 't1', label: 'knows' })).toEqual({ valid: true });
  });

  it('create: fails missing source_id', () => {
    const r = validateToolInput('manage_relationship', { action: 'create', target_id: 't1', label: 'knows' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/source_id/);
  });

  it('create: fails missing target_id', () => {
    const r = validateToolInput('manage_relationship', { action: 'create', source_id: 's1', label: 'knows' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/target_id/);
  });

  it('create: fails missing label', () => {
    const r = validateToolInput('manage_relationship', { action: 'create', source_id: 's1', target_id: 't1' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/label/);
  });

  it('update: passes with relationship_id', () => {
    expect(validateToolInput('manage_relationship', { action: 'update', relationship_id: 'r1' })).toEqual({ valid: true });
  });

  it('update: fails without relationship_id', () => {
    const r = validateToolInput('manage_relationship', { action: 'update' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/relationship_id/);
  });

  it('delete: passes with relationship_ids array', () => {
    expect(validateToolInput('manage_relationship', { action: 'delete', relationship_ids: ['r1'] })).toEqual({ valid: true });
  });

  it('delete: fails without relationship_ids', () => {
    const r = validateToolInput('manage_relationship', { action: 'delete' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/relationship_ids/);
  });

  it('delete: fails with empty relationship_ids', () => {
    const r = validateToolInput('manage_relationship', { action: 'delete', relationship_ids: [] });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/relationship_ids/);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — manage_note
// ---------------------------------------------------------------------------

describe('validateToolInput: manage_note', () => {
  it('read: passes with note_id', () => {
    expect(validateToolInput('manage_note', { action: 'read', note_id: 'n1' })).toEqual({ valid: true });
  });

  it('read: fails without note_id', () => {
    const r = validateToolInput('manage_note', { action: 'read' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/note_id/);
  });

  it('create: passes with title and content', () => {
    expect(validateToolInput('manage_note', { action: 'create', title: 'T', content: 'C' })).toEqual({ valid: true });
  });

  it('create: fails without title', () => {
    const r = validateToolInput('manage_note', { action: 'create', content: 'C' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/title/);
  });

  it('create: fails without content', () => {
    const r = validateToolInput('manage_note', { action: 'create', title: 'T' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/content/);
  });

  it('update: passes with note_id', () => {
    expect(validateToolInput('manage_note', { action: 'update', note_id: 'n1' })).toEqual({ valid: true });
  });

  it('update: fails without note_id', () => {
    const r = validateToolInput('manage_note', { action: 'update' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/note_id/);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — merge_entities
// ---------------------------------------------------------------------------

describe('validateToolInput: merge_entities', () => {
  it('passes with primary_id and secondary_id', () => {
    expect(validateToolInput('merge_entities', { primary_id: 'p1', secondary_id: 's1' })).toEqual({ valid: true });
  });

  it('fails without primary_id', () => {
    const r = validateToolInput('merge_entities', { secondary_id: 's1' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/primary_id/);
  });

  it('fails without secondary_id', () => {
    const r = validateToolInput('merge_entities', { primary_id: 'p1' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/secondary_id/);
  });
});

// ---------------------------------------------------------------------------
// validateToolInput — analyze_graph
// ---------------------------------------------------------------------------

describe('validateToolInput: analyze_graph', () => {
  it('passes with valid analysis types (non-paths)', () => {
    for (const a of ['overview', 'health', 'centrality', 'orphans']) {
      expect(validateToolInput('analyze_graph', { analysis: a })).toEqual({ valid: true });
    }
  });

  it('fails without analysis', () => {
    const r = validateToolInput('analyze_graph', {});
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/analysis/);
  });

  it('fails with invalid analysis type', () => {
    const r = validateToolInput('analyze_graph', { analysis: 'magic' });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/analysis/);
  });

  it('paths: fails without options.source_id', () => {
    const r = validateToolInput('analyze_graph', { analysis: 'paths', options: { target_id: 't1' } });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/source_id/);
  });

  it('paths: fails without options.target_id', () => {
    const r = validateToolInput('analyze_graph', { analysis: 'paths', options: { source_id: 's1' } });
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/target_id/);
  });

  it('paths: fails without any options', () => {
    const r = validateToolInput('analyze_graph', { analysis: 'paths' });
    expect(r.valid).toBe(false);
  });

  it('paths: passes with source_id and target_id in options', () => {
    expect(validateToolInput('analyze_graph', { analysis: 'paths', options: { source_id: 's1', target_id: 't1' } })).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// executeToolHandler — authorization
// ---------------------------------------------------------------------------

describe('executeToolHandler: authorization', () => {
  it('readonly policy blocks manage_entity:create', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'manage_entity', { action: 'create', name: 'Alice', label: 'person' });
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.result);
    expect(body.error).toMatch(/not authorized/i);
    expect(svc.createEntity).not.toHaveBeenCalled();
  });

  it('readonly policy blocks manage_entity:delete', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'manage_entity', { action: 'delete', entity_ids: ['e1'] });
    expect(r.isError).toBe(true);
  });

  it('readonly policy allows manage_note:read', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'manage_note', { action: 'read', note_id: 'n1' });
    expect(r.isError).toBe(false);
    expect(svc.readNote).toHaveBeenCalledWith('n1');
  });

  it('readonly policy blocks manage_note:create', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'manage_note', { action: 'create', title: 'T', content: 'C' });
    expect(r.isError).toBe(true);
  });

  it('readonly policy blocks merge_entities', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'merge_entities', { primary_id: 'p1', secondary_id: 's1' });
    expect(r.isError).toBe(true);
    expect(svc.mergeEntities).not.toHaveBeenCalled();
  });

  it('write policy allows manage_entity:create', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_entity', { action: 'create', name: 'Alice', label: 'person' });
    expect(r.isError).toBe(false);
    expect(svc.createEntity).toHaveBeenCalledWith({ name: 'Alice', label: 'person' });
  });
});

// ---------------------------------------------------------------------------
// executeToolHandler — validation errors
// ---------------------------------------------------------------------------

describe('executeToolHandler: validation errors', () => {
  it('returns isError=true for invalid input', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'search', {});
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.result);
    expect(body.error).toBeDefined();
    expect(svc.search).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// executeToolHandler — dispatch and effects
// ---------------------------------------------------------------------------

describe('executeToolHandler: search dispatch', () => {
  it('calls service.search and returns empty effects', async () => {
    const svc = makeService();
    svc.search = vi.fn().mockResolvedValue([{ id: 'e1', name: 'Alice', type: 'entity', label: 'person', score: 0.9, source: 'entity' }]);
    const r = await executeToolHandler(svc, readPolicy, 'search', { query: 'Alice' });
    expect(r.isError).toBe(false);
    expect(svc.search).toHaveBeenCalledWith({ query: 'Alice' });
    expect(r.effects).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('forwards scope and limit to service.search', async () => {
    const svc = makeService();
    await executeToolHandler(svc, readPolicy, 'search', { query: 'x', scope: 'notes', limit: 5 });
    expect(svc.search).toHaveBeenCalledWith({ query: 'x', scope: 'notes', limit: 5 });
  });
});

describe('executeToolHandler: get_entity dispatch', () => {
  it('calls service.getEntity with entity_id', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'get_entity', { entity_id: 'e1' });
    expect(r.isError).toBe(false);
    expect(svc.getEntity).toHaveBeenCalledWith('e1');
    expect(r.effects).toEqual({ nodeIds: [], edgeIds: [] });
  });
});

describe('executeToolHandler: get_neighbors dispatch', () => {
  it('calls service.getNeighbors with clamped depth and limit', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'get_neighbors', { entity_id: 'e1', depth: 10, limit: 999 });
    expect(r.isError).toBe(false);
    expect(svc.getNeighbors).toHaveBeenCalledWith({ entity_id: 'e1', depth: 3, limit: 200 });
    expect(r.effects).toEqual({ nodeIds: [], edgeIds: [] });
  });
});

describe('executeToolHandler: manage_entity dispatch', () => {
  it('create calls createEntity and returns node effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_entity', { action: 'create', name: 'Bob', label: 'person', tags: ['vip'] });
    expect(r.isError).toBe(false);
    expect(svc.createEntity).toHaveBeenCalledWith({ name: 'Bob', label: 'person', tags: ['vip'] });
    expect(r.effects.nodeIds).toContain('e1');
    expect(r.effects.edgeIds).toEqual([]);
  });

  it('update calls updateEntity and returns effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_entity', { action: 'update', entity_id: 'e1', name: 'Bobby' });
    expect(r.isError).toBe(false);
    expect(svc.updateEntity).toHaveBeenCalledWith({ entity_id: 'e1', name: 'Bobby' });
    expect(r.effects.nodeIds).toContain('e1');
  });

  it('delete calls deleteEntities and returns effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_entity', { action: 'delete', entity_ids: ['e1', 'e2'] });
    expect(r.isError).toBe(false);
    expect(svc.deleteEntities).toHaveBeenCalledWith(['e1', 'e2']);
    expect(r.effects.nodeIds).toContain('e1');
    expect(r.effects.edgeIds).toContain('edge1');
  });
});

describe('executeToolHandler: manage_relationship dispatch', () => {
  it('create calls createRelationship and returns edge effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_relationship', { action: 'create', source_id: 's1', target_id: 't1', label: 'knows' });
    expect(r.isError).toBe(false);
    expect(svc.createRelationship).toHaveBeenCalledWith({ source_id: 's1', target_id: 't1', label: 'knows' });
    expect(r.effects.edgeIds).toContain('r1');
  });

  it('update calls updateRelationship and returns effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_relationship', { action: 'update', relationship_id: 'r1', label: 'knew' });
    expect(r.isError).toBe(false);
    expect(svc.updateRelationship).toHaveBeenCalledWith({ relationship_id: 'r1', label: 'knew' });
  });

  it('delete calls deleteRelationships and returns effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_relationship', { action: 'delete', relationship_ids: ['r1', 'r2'] });
    expect(r.isError).toBe(false);
    expect(svc.deleteRelationships).toHaveBeenCalledWith(['r1', 'r2']);
    expect(r.effects.edgeIds).toContain('r1');
  });
});

describe('executeToolHandler: merge_entities dispatch', () => {
  it('calls mergeEntities and returns effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'merge_entities', { primary_id: 'p1', secondary_id: 's1' });
    expect(r.isError).toBe(false);
    expect(svc.mergeEntities).toHaveBeenCalledWith('p1', 's1');
    expect(r.effects.nodeIds).toContain('p1');
  });
});

describe('executeToolHandler: manage_note dispatch', () => {
  it('read calls readNote and returns empty effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'manage_note', { action: 'read', note_id: 'n1' });
    expect(r.isError).toBe(false);
    expect(svc.readNote).toHaveBeenCalledWith('n1');
    expect(r.effects).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('create calls createNote and returns effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_note', { action: 'create', title: 'My Note', content: '# Hello' });
    expect(r.isError).toBe(false);
    expect(svc.createNote).toHaveBeenCalledWith('My Note', '# Hello');
    // read-like effects for notes (note service returns empty)
    expect(r.effects).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('update calls updateNote with title and content', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, writePolicy, 'manage_note', { action: 'update', note_id: 'n1', title: 'New Title', content: 'updated' });
    expect(r.isError).toBe(false);
    expect(svc.updateNote).toHaveBeenCalledWith('n1', { title: 'New Title', content: 'updated' });
  });
});

describe('executeToolHandler: analyze_graph dispatch', () => {
  it('calls analyzeGraph with analysis type and returns empty effects', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'analyze_graph', { analysis: 'overview' });
    expect(r.isError).toBe(false);
    expect(svc.analyzeGraph).toHaveBeenCalledWith('overview', undefined);
    expect(r.effects).toEqual({ nodeIds: [], edgeIds: [] });
  });

  it('passes options to analyzeGraph', async () => {
    const svc = makeService();
    await executeToolHandler(svc, readPolicy, 'analyze_graph', { analysis: 'centrality', options: { limit: 10 } });
    expect(svc.analyzeGraph).toHaveBeenCalledWith('centrality', { limit: 10 });
  });

  it('paths: calls analyzeGraph with options', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'analyze_graph', { analysis: 'paths', options: { source_id: 's1', target_id: 't1' } });
    expect(r.isError).toBe(false);
    expect(svc.analyzeGraph).toHaveBeenCalledWith('paths', { source_id: 's1', target_id: 't1' });
  });
});

// ---------------------------------------------------------------------------
// executeToolHandler — result format
// ---------------------------------------------------------------------------

describe('executeToolHandler: result is serialized JSON', () => {
  it('result is a JSON string', async () => {
    const svc = makeService();
    const r = await executeToolHandler(svc, readPolicy, 'search', { query: 'test' });
    expect(() => JSON.parse(r.result)).not.toThrow();
  });
});
