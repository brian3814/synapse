import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { resolveEntityLinks } from '../../electron/entity-files/link-drift';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'entity');
    CREATE TABLE entity_aliases (id TEXT, node_id TEXT, alias TEXT, alias_lower TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, label TEXT NOT NULL,
      type TEXT DEFAULT 'related', properties TEXT DEFAULT '{}', weight REAL DEFAULT 1.0,
      directed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
  `);
  return db;
}

describe('resolveEntityLinks', () => {
  it('detects broken link when target was renamed', () => {
    const db = createDb();
    db.prepare("INSERT INTO nodes VALUES ('n1', 'TensorFlow 2.0', 'entity')").run();
    db.prepare("INSERT INTO entity_aliases VALUES ('a1', 'n1', 'TensorFlow', 'tensorflow')").run();

    const content = '## Relationships\n\n- [[TensorFlow]] — *uses*\n';
    const items = resolveEntityLinks(db, 'node-0', content);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link_broken');
    expect(items[0].linkText).toBe('TensorFlow');
    expect(items[0].suggestedFix).toBe('TensorFlow 2.0');
  });

  it('detects dead link when target was deleted', () => {
    const db = createDb();
    const content = '## Relationships\n\n- [[Nonexistent]] — *uses*\n';
    const items = resolveEntityLinks(db, 'node-0', content);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link_dead');
    expect(items[0].linkText).toBe('Nonexistent');
  });

  it('detects missing relationship only when completeness checks enabled', () => {
    const db = createDb();
    db.prepare("INSERT INTO nodes VALUES ('n1', 'PyTorch', 'entity')").run();
    db.prepare("INSERT INTO nodes VALUES ('n0', 'ML', 'entity')").run();
    db.prepare("INSERT INTO edges VALUES ('e1', 'n0', 'n1', 'uses', 'related', '{}', 1, 1, '', '')").run();

    const content = '## Relationships\n\n';

    // Without flag — no missing items
    expect(resolveEntityLinks(db, 'n0', content)).toHaveLength(0);

    // With flag — reports missing
    const items = resolveEntityLinks(db, 'n0', content, { includeMissingRelationships: true });
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link_missing');
    expect(items[0].linkText).toBe('PyTorch');
    expect(items[0].edgeLabel).toBe('uses');
  });

  it('returns empty when all links are valid', () => {
    const db = createDb();
    db.prepare("INSERT INTO nodes VALUES ('n1', 'PyTorch', 'entity')").run();

    const content = '## Relationships\n\n- [[PyTorch]] — *uses*\n';
    const items = resolveEntityLinks(db, 'node-0', content);

    expect(items).toHaveLength(0);
  });
});
