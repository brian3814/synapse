/**
 * Integration tests: full MCP stack end-to-end.
 *
 * Exercises: standalone context → DefaultKnowledgeService → executeToolHandler
 * Using an in-memory SQLite database for speed and isolation.
 *
 * These tests verify COMBINED behavior (validation + auth + service + data store)
 * rather than individual units — each unit test file covers its layer in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createStandaloneContext } from '../../src/mcp/adapters/standalone';
import { DefaultKnowledgeService } from '../../src/mcp/knowledge-service-impl';
import { executeToolHandler } from '../../src/mcp/tools/handlers';
import { ProfilePolicy } from '../../src/mcp/authorization';
import { MCP_TOOL_DEFINITIONS } from '../../src/mcp/tools/definitions';
import type { CommandContext } from '../../src/commands/types';
import type { KnowledgeService } from '../../src/mcp/knowledge-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePolicy(): ProfilePolicy {
  return new ProfilePolicy({ capabilities: ['read', 'write'], blocked_tools: [], blocked_actions: [] });
}

function readPolicy(): ProfilePolicy {
  return new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
}

async function exec(
  service: KnowledgeService,
  policy: ProfilePolicy,
  name: string,
  input: Record<string, unknown>,
) {
  return executeToolHandler(service, policy, name, input);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let db: Database.Database;
let ctx: CommandContext;
let service: KnowledgeService;

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ctx = await createStandaloneContext(db, '/tmp/test-vault-integration');
  service = new DefaultKnowledgeService(ctx);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// 1. Tool count
// ---------------------------------------------------------------------------

describe('MCP_TOOL_DEFINITIONS', () => {
  it('exports exactly 8 tools', () => {
    expect(MCP_TOOL_DEFINITIONS).toHaveLength(8);
  });

  // 2. Snake_case
  it('all tool names are snake_case', () => {
    const pattern = /^[a-z][a-z0-9_]*$/;
    for (const tool of MCP_TOOL_DEFINITIONS) {
      expect(tool.name, `Tool "${tool.name}" fails snake_case check`).toMatch(pattern);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Full CRUD cycle
// ---------------------------------------------------------------------------

describe('full entity CRUD cycle via executeToolHandler', () => {
  it('create → search → get → update → delete → verify gone', async () => {
    const policy = writePolicy();

    // Create
    const created = await exec(service, policy, 'manage_entity', {
      action: 'create',
      name: 'GraphQL',
      label: 'technology',
    });
    expect(created.isError).toBe(false);
    const createdData = JSON.parse(created.result);
    const entityId: string = createdData.id;
    expect(entityId).toBeTruthy();
    expect(createdData.name).toBe('GraphQL');

    // Search
    const searched = await exec(service, policy, 'search', { query: 'GraphQL' });
    expect(searched.isError).toBe(false);
    const searchResults = JSON.parse(searched.result);
    expect(Array.isArray(searchResults)).toBe(true);
    const names = searchResults.map((r: any) => r.name);
    expect(names).toContain('GraphQL');

    // Get
    const got = await exec(service, policy, 'get_entity', { entity_id: entityId });
    expect(got.isError).toBe(false);
    const entityData = JSON.parse(got.result);
    expect(entityData.name).toBe('GraphQL');
    expect(entityData.type).toBe('entity');

    // Update
    const updated = await exec(service, policy, 'manage_entity', {
      action: 'update',
      entity_id: entityId,
      label: 'query_language',
    });
    expect(updated.isError).toBe(false);
    const updatedData = JSON.parse(updated.result);
    expect(updatedData.action).toBe('updated');

    // Get after update
    const gotAfterUpdate = await exec(service, policy, 'get_entity', { entity_id: entityId });
    const afterUpdate = JSON.parse(gotAfterUpdate.result);
    expect(afterUpdate.label).toBe('query_language');

    // Delete
    const deleted = await exec(service, policy, 'manage_entity', {
      action: 'delete',
      entity_ids: [entityId],
    });
    expect(deleted.isError).toBe(false);
    const deletedData = JSON.parse(deleted.result);
    expect(deletedData.deleted).toBe(1);

    // Verify gone
    const gone = await exec(service, policy, 'get_entity', { entity_id: entityId });
    expect(gone.isError).toBe(false);
    const goneData = JSON.parse(gone.result);
    expect(goneData).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Relationship cycle
// ---------------------------------------------------------------------------

describe('relationship cycle via executeToolHandler', () => {
  it('create two entities → create relationship → get_neighbors → delete relationship', async () => {
    const policy = writePolicy();

    const resA = await exec(service, policy, 'manage_entity', {
      action: 'create', name: 'Python', label: 'language',
    });
    const resB = await exec(service, policy, 'manage_entity', {
      action: 'create', name: 'Django', label: 'framework',
    });
    const idA = JSON.parse(resA.result).id;
    const idB = JSON.parse(resB.result).id;

    // Create relationship
    const rel = await exec(service, policy, 'manage_relationship', {
      action: 'create',
      source_id: idA,
      target_id: idB,
      label: 'powers',
    });
    expect(rel.isError).toBe(false);
    const relData = JSON.parse(rel.result);
    expect(relData.action).toBe('created');
    const relId: string = relData.id;

    // Get neighbors
    const neighbors = await exec(service, policy, 'get_neighbors', { entity_id: idA });
    expect(neighbors.isError).toBe(false);
    const nbData = JSON.parse(neighbors.result);
    expect(nbData.nodes).toHaveLength(1);
    expect(nbData.nodes[0].name).toBe('Django');

    // Delete relationship
    const delRel = await exec(service, policy, 'manage_relationship', {
      action: 'delete',
      relationship_ids: [relId],
    });
    expect(delRel.isError).toBe(false);
    const delRelData = JSON.parse(delRel.result);
    expect(delRelData.deleted).toBe(1);

    // Verify no neighbors
    const noNeighbors = await exec(service, policy, 'get_neighbors', { entity_id: idA });
    const noNbData = JSON.parse(noNeighbors.result);
    expect(noNbData.nodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Note via domain commands
// ---------------------------------------------------------------------------

describe('note via domain commands', () => {
  it('create note returns node created with type note', async () => {
    const policy = writePolicy();

    const res = await exec(service, policy, 'manage_note', {
      action: 'create',
      title: 'My Integration Note',
      content: '# Hello World\n\nThis is content.',
    });
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.result);
    expect(data.title).toBe('My Integration Note');
    expect(data.action).toBe('created');
    expect(data.id).toBeTruthy();

    // Verify the node was created in the graph via search
    const searchRes = await exec(service, policy, 'search', { query: 'My Integration Note', scope: 'notes' });
    expect(searchRes.isError).toBe(false);
    const searchData = JSON.parse(searchRes.result);
    const noteResult = searchData.find((r: any) => r.type === 'note');
    expect(noteResult).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Merge with effects
// ---------------------------------------------------------------------------

describe('merge_entities with effects', () => {
  it('create two entities + edge → merge → alias added, edges transferred, effects populated', async () => {
    const policy = writePolicy();

    const primary = await exec(service, policy, 'manage_entity', {
      action: 'create', name: 'React', label: 'library',
    });
    const secondary = await exec(service, policy, 'manage_entity', {
      action: 'create', name: 'ReactJS', label: 'library',
    });
    const other = await exec(service, policy, 'manage_entity', {
      action: 'create', name: 'JavaScript', label: 'language',
    });

    const primaryId = JSON.parse(primary.result).id;
    const secondaryId = JSON.parse(secondary.result).id;
    const otherId = JSON.parse(other.result).id;

    // Edge on secondary
    await exec(service, policy, 'manage_relationship', {
      action: 'create',
      source_id: secondaryId,
      target_id: otherId,
      label: 'built_with',
    });

    // Merge
    const merged = await exec(service, policy, 'merge_entities', {
      primary_id: primaryId,
      secondary_id: secondaryId,
    });
    expect(merged.isError).toBe(false);
    const mergedData = JSON.parse(merged.result);
    expect(mergedData.alias_added).toBe('ReactJS');
    expect(mergedData.edges_transferred).toBe(1);

    // Effects should contain the secondary node ID (it was deleted)
    // The secondary is deleted so its ID appears in the delete event;
    // the primary is modified in-place (alias/edge transfer) so its ID
    // may not appear — we assert at least one nodeId is present.
    expect(merged.effects.nodeIds.length).toBeGreaterThanOrEqual(1);

    // Secondary is gone
    const goneRes = await exec(service, policy, 'get_entity', { entity_id: secondaryId });
    const goneData = JSON.parse(goneRes.result);
    expect(goneData).toBeNull();

    // Primary has alias and edge
    const mergedEntityRes = await exec(service, policy, 'get_entity', { entity_id: primaryId });
    const mergedEntity = JSON.parse(mergedEntityRes.result);
    expect(mergedEntity.aliases).toContain('ReactJS');
    expect(mergedEntity.edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Authorization: readonly blocks writes
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('readonly policy blocks manage_entity:create', async () => {
    const policy = readPolicy();

    const res = await exec(service, policy, 'manage_entity', {
      action: 'create',
      name: 'Blocked',
      label: 'test',
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse(res.result);
    expect(data.error).toMatch(/Not authorized/);
  });

  // 8. Authorization: action-level block
  it('action-level block allows create but blocks delete', async () => {
    const policy = new ProfilePolicy({
      capabilities: ['read', 'write'],
      blocked_tools: [],
      blocked_actions: ['manage_entity:delete'],
    });

    // Create should succeed
    const createRes = await exec(service, policy, 'manage_entity', {
      action: 'create',
      name: 'ActionTest',
      label: 'concept',
    });
    expect(createRes.isError).toBe(false);
    const created = JSON.parse(createRes.result);

    // Delete should be blocked
    const deleteRes = await exec(service, policy, 'manage_entity', {
      action: 'delete',
      entity_ids: [created.id],
    });
    expect(deleteRes.isError).toBe(true);
    const deleteData = JSON.parse(deleteRes.result);
    expect(deleteData.error).toMatch(/Not authorized/);
    expect(deleteData.error).toMatch(/delete/);
  });

  // 9. Authorization: manage_note:read allowed in readonly
  it('readonly policy allows manage_note:read when note exists', async () => {
    // Write policy to create note first
    const writeP = writePolicy();
    const createNoteRes = await exec(service, writeP, 'manage_note', {
      action: 'create',
      title: 'ReadOnly Note',
      content: '# Content',
    });
    const noteId = JSON.parse(createNoteRes.result).id;

    // Readonly policy should allow reading it
    const readP = readPolicy();
    const readRes = await exec(service, readP, 'manage_note', {
      action: 'read',
      note_id: noteId,
    });
    expect(readRes.isError).toBe(false);
    const readData = JSON.parse(readRes.result);
    expect(readData.title).toBe('ReadOnly Note');
  });
});

// ---------------------------------------------------------------------------
// 10. Mutation effects populated
// ---------------------------------------------------------------------------

describe('mutation effects', () => {
  it('create entity effects.nodeIds contains the new entity ID', async () => {
    const policy = writePolicy();

    const res = await exec(service, policy, 'manage_entity', {
      action: 'create',
      name: 'EffectTest',
      label: 'concept',
    });
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.result);
    const newId: string = data.id;

    expect(res.effects.nodeIds).toContain(newId);
  });
});

// ---------------------------------------------------------------------------
// 11. Analyze graph overview
// ---------------------------------------------------------------------------

describe('analyze_graph', () => {
  it('overview returns correct entity counts', async () => {
    const policy = writePolicy();

    await exec(service, policy, 'manage_entity', { action: 'create', name: 'E1', label: 'concept' });
    await exec(service, policy, 'manage_entity', { action: 'create', name: 'E2', label: 'concept' });
    await exec(service, policy, 'manage_entity', { action: 'create', name: 'E3', label: 'concept' });

    const res = await exec(service, policy, 'analyze_graph', { analysis: 'overview' });
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.result);
    expect(data.analysis).toBe('overview');
    expect(data.data.entity_count).toBeGreaterThanOrEqual(3);
  });

  // 12. Analyze graph paths
  it('paths finds shortest path through A→B→C chain', async () => {
    const policy = writePolicy();

    const resA = await exec(service, policy, 'manage_entity', { action: 'create', name: 'PathA', label: 'node' });
    const resB = await exec(service, policy, 'manage_entity', { action: 'create', name: 'PathB', label: 'node' });
    const resC = await exec(service, policy, 'manage_entity', { action: 'create', name: 'PathC', label: 'node' });

    const idA = JSON.parse(resA.result).id;
    const idB = JSON.parse(resB.result).id;
    const idC = JSON.parse(resC.result).id;

    await exec(service, policy, 'manage_relationship', {
      action: 'create', source_id: idA, target_id: idB, label: 'connects',
    });
    await exec(service, policy, 'manage_relationship', {
      action: 'create', source_id: idB, target_id: idC, label: 'connects',
    });

    const res = await exec(service, policy, 'analyze_graph', {
      analysis: 'paths',
      options: { source_id: idA, target_id: idC },
    });
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.result);
    expect(data.analysis).toBe('paths');
    // Path is returned as data.data.paths[0].nodes — array of {id, name}
    expect(data.data.paths).toHaveLength(1);
    const pathNodeIds: string[] = data.data.paths[0].nodes.map((n: any) => n.id);
    expect(pathNodeIds).toContain(idA);
    expect(pathNodeIds).toContain(idC);
  });
});

// ---------------------------------------------------------------------------
// 13. Entity label mapping
// ---------------------------------------------------------------------------

describe('entity label mapping', () => {
  it('get_entity returns type:entity and preserves label', async () => {
    const policy = writePolicy();

    const res = await exec(service, policy, 'manage_entity', {
      action: 'create',
      name: 'Alice',
      label: 'person',
    });
    const entityId = JSON.parse(res.result).id;

    const gotRes = await exec(service, policy, 'get_entity', { entity_id: entityId });
    expect(gotRes.isError).toBe(false);
    const entity = JSON.parse(gotRes.result);

    expect(entity.type).toBe('entity');
    expect(entity.label).toBe('person');
  });
});

// ---------------------------------------------------------------------------
// 14. Validation: missing required fields
// ---------------------------------------------------------------------------

describe('validation errors', () => {
  it('manage_entity:create without name returns descriptive error', async () => {
    const policy = writePolicy();

    const res = await exec(service, policy, 'manage_entity', {
      action: 'create',
      // name is missing
      label: 'concept',
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse(res.result);
    expect(data.error).toMatch(/name/);
  });

  // 15. Validation: paths without source_id
  it('analyze_graph:paths without source_id returns descriptive error', async () => {
    const policy = writePolicy();

    const res = await exec(service, policy, 'analyze_graph', {
      analysis: 'paths',
      // options missing entirely
    });
    expect(res.isError).toBe(true);
    const data = JSON.parse(res.result);
    expect(data.error).toMatch(/source_id/);
  });
});
