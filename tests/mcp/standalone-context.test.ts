/**
 * Integration test: standalone context + DefaultKnowledgeService.
 *
 * Creates an in-memory better-sqlite3 database, wires it through
 * createStandaloneContext, then exercises the full CRUD cycle via
 * DefaultKnowledgeService to verify the DataStore delegation layer
 * works correctly in direct-SQLite mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createStandaloneContext } from '../../src/mcp/adapters/standalone';
import { DefaultKnowledgeService } from '../../src/mcp/knowledge-service-impl';
import type { KnowledgeService } from '../../src/mcp/knowledge-service';
import type { CommandContext } from '../../src/commands/types';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('standalone context + DefaultKnowledgeService', () => {
  let db: Database.Database;
  let ctx: CommandContext;
  let service: KnowledgeService;

  beforeEach(async () => {
    // In-memory database — fast, isolated, no cleanup needed
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // createStandaloneContext wires the engine and runs migrations
    ctx = await createStandaloneContext(db, '/tmp/test-vault');
    service = new DefaultKnowledgeService(ctx);
  });

  afterEach(() => {
    db.close();
  });

  // ── Entity CRUD ─────────────────────────────────────────────────────

  it('creates an entity and retrieves it', async () => {
    const result = await service.createEntity({
      name: 'TypeScript',
      label: 'technology',
    });

    expect(result.data.name).toBe('TypeScript');
    expect(result.data.action).toBe('created');
    expect(result.effects.nodeIds).toHaveLength(1);

    const entity = await service.getEntity(result.data.id);
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('TypeScript');
    expect(entity!.label).toBe('technology');
    expect(entity!.type).toBe('entity');
  });

  it('creates an entity with tags and aliases', async () => {
    const result = await service.createEntity({
      name: 'React',
      label: 'library',
      tags: ['frontend', 'javascript'],
      aliases: ['ReactJS', 'React.js'],
    });

    const entity = await service.getEntity(result.data.id);
    expect(entity!.tags).toEqual(expect.arrayContaining(['frontend', 'javascript']));
    expect(entity!.aliases).toEqual(expect.arrayContaining(['ReactJS', 'React.js']));
  });

  it('updates an entity', async () => {
    const created = await service.createEntity({
      name: 'Node',
      label: 'runtime',
    });

    const updated = await service.updateEntity({
      entity_id: created.data.id,
      name: 'Node.js',
      label: 'runtime_environment',
    });

    expect(updated.data.name).toBe('Node.js');
    expect(updated.data.action).toBe('updated');

    const entity = await service.getEntity(created.data.id);
    expect(entity!.name).toBe('Node.js');
    expect(entity!.label).toBe('runtime_environment');
  });

  it('deletes an entity', async () => {
    const created = await service.createEntity({
      name: 'ToDelete',
      label: 'test',
    });

    const deleted = await service.deleteEntities([created.data.id]);
    expect(deleted.data.deleted).toBe(1);

    const entity = await service.getEntity(created.data.id);
    expect(entity).toBeNull();
  });

  // ── Relationships ───────────────────────────────────────────────────

  it('creates and retrieves a relationship', async () => {
    const a = await service.createEntity({ name: 'A', label: 'concept' });
    const b = await service.createEntity({ name: 'B', label: 'concept' });

    const rel = await service.createRelationship({
      source_id: a.data.id,
      target_id: b.data.id,
      label: 'related_to',
    });

    expect(rel.data.action).toBe('created');
    expect(rel.effects.edgeIds).toHaveLength(1);

    // Verify via getEntity
    const entityA = await service.getEntity(a.data.id);
    expect(entityA!.edges).toHaveLength(1);
    expect(entityA!.edges[0].label).toBe('related_to');
    expect(entityA!.edges[0].neighbor_name).toBe('B');
  });

  it('updates a relationship', async () => {
    const a = await service.createEntity({ name: 'X', label: 'concept' });
    const b = await service.createEntity({ name: 'Y', label: 'concept' });

    const rel = await service.createRelationship({
      source_id: a.data.id,
      target_id: b.data.id,
      label: 'uses',
    });

    const updated = await service.updateRelationship({
      relationship_id: rel.data.id,
      label: 'depends_on',
    });

    expect(updated.data.action).toBe('updated');
  });

  it('deletes a relationship', async () => {
    const a = await service.createEntity({ name: 'P', label: 'concept' });
    const b = await service.createEntity({ name: 'Q', label: 'concept' });

    const rel = await service.createRelationship({
      source_id: a.data.id,
      target_id: b.data.id,
      label: 'link',
    });

    const result = await service.deleteRelationships([rel.data.id]);
    expect(result.data.deleted).toBe(1);

    const entity = await service.getEntity(a.data.id);
    expect(entity!.edges).toHaveLength(0);
  });

  // ── Merge ───────────────────────────────────────────────────────────

  it('merges two entities', async () => {
    const primary = await service.createEntity({ name: 'React', label: 'library' });
    const secondary = await service.createEntity({ name: 'ReactJS', label: 'library' });

    // Create an edge to secondary that should be transferred
    const other = await service.createEntity({ name: 'JavaScript', label: 'language' });
    await service.createRelationship({
      source_id: secondary.data.id,
      target_id: other.data.id,
      label: 'part_of',
    });

    const result = await service.mergeEntities(primary.data.id, secondary.data.id);
    expect(result.data.alias_added).toBe('ReactJS');
    expect(result.data.edges_transferred).toBe(1);

    // Secondary should be gone
    const deleted = await service.getEntity(secondary.data.id);
    expect(deleted).toBeNull();

    // Primary should have the transferred edge and new alias
    const merged = await service.getEntity(primary.data.id);
    expect(merged!.aliases).toContain('ReactJS');
    expect(merged!.edges).toHaveLength(1);
    expect(merged!.edges[0].neighbor_name).toBe('JavaScript');
  });

  // ── Neighbors ───────────────────────────────────────────────────────

  it('gets neighbors at depth 1', async () => {
    const a = await service.createEntity({ name: 'Center', label: 'concept' });
    const b = await service.createEntity({ name: 'Near', label: 'concept' });
    const c = await service.createEntity({ name: 'Far', label: 'concept' });

    await service.createRelationship({
      source_id: a.data.id,
      target_id: b.data.id,
      label: 'link',
    });
    await service.createRelationship({
      source_id: b.data.id,
      target_id: c.data.id,
      label: 'link',
    });

    const result = await service.getNeighbors({ entity_id: a.data.id, depth: 1 });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('Near');
  });

  it('gets neighbors at depth 2', async () => {
    const a = await service.createEntity({ name: 'Center', label: 'concept' });
    const b = await service.createEntity({ name: 'Near', label: 'concept' });
    const c = await service.createEntity({ name: 'Far', label: 'concept' });

    await service.createRelationship({
      source_id: a.data.id,
      target_id: b.data.id,
      label: 'link',
    });
    await service.createRelationship({
      source_id: b.data.id,
      target_id: c.data.id,
      label: 'link',
    });

    const result = await service.getNeighbors({ entity_id: a.data.id, depth: 2 });
    expect(result.nodes).toHaveLength(2);
    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('Near');
    expect(names).toContain('Far');
  });

  // ── Search ──────────────────────────────────────────────────────────

  it('searches for entities', async () => {
    await service.createEntity({ name: 'TypeScript', label: 'language' });
    await service.createEntity({ name: 'JavaScript', label: 'language' });
    await service.createEntity({ name: 'Rust', label: 'language' });

    const results = await service.search({ query: 'Script', scope: 'entities' });
    // FTS5 should match both *Script entities
    expect(results.length).toBeGreaterThanOrEqual(1);
    const names = results.map((r) => r.name);
    expect(names.some((n) => n.includes('Script'))).toBe(true);
  });

  // ── Analysis ────────────────────────────────────────────────────────

  it('returns graph overview', async () => {
    await service.createEntity({ name: 'Entity1', label: 'concept' });
    await service.createEntity({ name: 'Entity2', label: 'concept' });

    const result = await service.analyzeGraph('overview');
    expect(result.analysis).toBe('overview');
    expect(result.data.entity_count).toBe(2);
  });

  it('returns graph health', async () => {
    const result = await service.analyzeGraph('health');
    expect(result.analysis).toBe('health');
    expect(result.data).toHaveProperty('total_nodes');
    expect(result.data).toHaveProperty('density');
  });

  it('returns orphan analysis', async () => {
    // Create a disconnected entity
    await service.createEntity({ name: 'Orphan', label: 'concept' });

    const result = await service.analyzeGraph('orphans');
    expect(result.analysis).toBe('orphans');
    expect(result.data.orphans.length).toBeGreaterThanOrEqual(1);
  });

  // ── DataStore raw access ────────────────────────────────────────────

  it('supports rawQuery and rawExec', async () => {
    await service.createEntity({ name: 'RawTest', label: 'concept' });

    const rows = await ctx.db.rawQuery<{ count: number }>(
      'SELECT COUNT(*) as count FROM nodes',
    );
    expect(rows[0].count).toBeGreaterThanOrEqual(1);

    const changes = await ctx.db.rawExec(
      "UPDATE nodes SET summary = ? WHERE name = ?",
      ['test', 'RawTest'],
    );
    expect(changes).toBe(1);
  });

  // ── loadGraph ───────────────────────────────────────────────────────

  it('loads the full graph', async () => {
    await service.createEntity({ name: 'GraphNode1', label: 'concept' });
    await service.createEntity({ name: 'GraphNode2', label: 'concept' });

    const graph = await ctx.db.loadGraph();
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
