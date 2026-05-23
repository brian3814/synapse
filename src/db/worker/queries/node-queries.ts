import { executeQuery, executeExec } from '../query-executor';
import { isFTS5Available } from '../migrations';
import type { DbNode, DbNodeSlim } from '../../../shared/types';

export async function getAllNodes(): Promise<DbNode[]> {
  const { rows } = await executeQuery<DbNode>('SELECT * FROM nodes ORDER BY updated_at DESC;');
  return rows;
}

/** Slim projection for bulk graph loading — skips properties, timestamps */
export async function getAllNodesSlim(): Promise<DbNodeSlim[]> {
  const { rows } = await executeQuery<DbNodeSlim>(
    'SELECT id, identifier, name, type, label, folder_path, color, size, source_url, x, y FROM nodes;'
  );
  return rows;
}

export async function getNodeById(id: string): Promise<DbNode | null> {
  const { rows } = await executeQuery<DbNode>('SELECT * FROM nodes WHERE id = ?;', [id]);
  return rows[0] ?? null;
}

export async function createNode(input: {
  name: string;
  type?: string;
  label?: string;
  folderPath?: string;
  identifier?: string;
  properties?: string;
  color?: string;
  size?: number;
  sourceUrl?: string;
  vaultPath?: string;
  contentType?: string;
}): Promise<DbNode> {
  const id = generateId();
  const type = input.type ?? 'entity';
  const label = input.label ?? (type === 'entity' ? 'concept' : null);
  const folderPath = input.folderPath ?? '';
  const identifier = input.identifier ?? generateIdentifier(type, input.name, input.sourceUrl, label);

  // Return existing node if identifier already exists (common during extraction
  // when the same entity appears across multiple pages or re-extractions)
  const { rows: existing } = await executeQuery<DbNode>(
    'SELECT * FROM nodes WHERE identifier = ?;',
    [identifier]
  );
  if (existing.length > 0) return existing[0];

  const { rows } = await executeQuery<DbNode>(
    `INSERT INTO nodes (id, identifier, name, type, label, folder_path, properties, color, size, source_url, vault_path, content_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [
      id,
      identifier,
      input.name,
      type,
      label,
      folderPath,
      input.properties ?? '{}',
      input.color ?? null,
      input.size ?? 1.0,
      input.sourceUrl ?? null,
      input.vaultPath ?? null,
      input.contentType ?? null,
    ]
  );
  return rows[0];
}

export async function updateNode(input: {
  id: string;
  name?: string;
  type?: string;
  label?: string;
  summary?: string;
  folderPath?: string;
  properties?: string;
  x?: number;
  y?: number;
  z?: number;
  color?: string;
  size?: number;
}): Promise<DbNode | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.type !== undefined) {
    sets.push('type = ?');
    params.push(input.type);
  }
  if (input.label !== undefined) {
    sets.push('label = ?');
    params.push(input.label);
  }
  if (input.summary !== undefined) {
    sets.push('summary = ?');
    params.push(input.summary);
  }
  if (input.folderPath !== undefined) {
    sets.push('folder_path = ?');
    params.push(input.folderPath);
  }
  if (input.properties !== undefined) {
    sets.push('properties = ?');
    params.push(input.properties);
  }
  if (input.x !== undefined) {
    sets.push('x = ?');
    params.push(input.x);
  }
  if (input.y !== undefined) {
    sets.push('y = ?');
    params.push(input.y);
  }
  if (input.z !== undefined) {
    sets.push('z = ?');
    params.push(input.z);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    params.push(input.color);
  }
  if (input.size !== undefined) {
    sets.push('size = ?');
    params.push(input.size);
  }

  if (sets.length === 0) return getNodeById(input.id);

  sets.push("updated_at = datetime('now')");
  params.push(input.id);

  const { rows } = await executeQuery<DbNode>(
    `UPDATE nodes SET ${sets.join(', ')} WHERE id = ? RETURNING *;`,
    params
  );
  return rows[0] ?? null;
}

export async function deleteNode(id: string): Promise<boolean> {
  const { changes } = await executeExec('DELETE FROM nodes WHERE id = ?;', [id]);
  return changes > 0;
}

const FTS5_SPECIAL = /["*()\-+^:{}~|]/g;

function sanitizeFTS5Query(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(FTS5_SPECIAL, '').trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export async function searchNodes(queryText: string, limit = 50): Promise<DbNode[]> {
  if (isFTS5Available()) {
    const ftsQuery = sanitizeFTS5Query(queryText);
    if (ftsQuery !== null) {
      try {
        const { rows } = await executeQuery<DbNode>(
          `SELECT n.* FROM nodes n
           JOIN nodes_fts fts ON n.rowid = fts.rowid
           WHERE nodes_fts MATCH ?
           ORDER BY rank
           LIMIT ?;`,
          [ftsQuery, limit]
        );
        if (rows.length > 0) return rows;
      } catch {
        // FTS5 failed — fall through to LIKE
      }
    }
  }

  // Fallback: LIKE-based search (also used when FTS5 returns no results)
  const pattern = `%${queryText}%`;
  const { rows } = await executeQuery<DbNode>(
    `SELECT * FROM nodes
     WHERE name LIKE ? OR type LIKE ?
     ORDER BY name
     LIMIT ?;`,
    [pattern, pattern, limit]
  );
  return rows;
}

export async function getNodesByType(type: string): Promise<DbNode[]> {
  const { rows } = await executeQuery<DbNode>(
    'SELECT * FROM nodes WHERE type = ? ORDER BY name;',
    [type]
  );
  return rows;
}

export async function getNodeTypes(): Promise<string[]> {
  const { rows } = await executeQuery<{ type: string }>(
    'SELECT DISTINCT type FROM nodes ORDER BY type;'
  );
  return rows.map((r) => r.type);
}

// N-hop neighborhood subgraph query
export async function getNeighborhood(
  nodeId: string,
  hops: number = 2
): Promise<{ nodeIds: string[] }> {
  const { rows } = await executeQuery<{ id: string }>(
    `WITH RECURSIVE neighborhood(id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT CASE WHEN e.source_id = n.id THEN e.target_id ELSE e.source_id END, n.depth + 1
       FROM neighborhood n
       JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
       WHERE n.depth < ?
     )
     SELECT DISTINCT id FROM neighborhood;`,
    [nodeId, hops]
  );
  return { nodeIds: rows.map((r) => r.id) };
}

/** Fast term matching: find nodes whose labels match any of the given terms */
export async function matchTerms(
  terms: string[],
  limit = 20
): Promise<DbNode[]> {
  if (terms.length === 0) return [];

  // Build a query that checks for LIKE matches against each term
  // Use UNION for efficiency, limited terms to prevent huge queries
  const limitedTerms = terms.slice(0, 30);
  const placeholders = limitedTerms.map(() => 'LOWER(name) LIKE ?').join(' OR ');
  const params = limitedTerms.map((t) => `%${t.toLowerCase()}%`);

  const { rows } = await executeQuery<DbNode>(
    `SELECT DISTINCT * FROM nodes
     WHERE ${placeholders}
     ORDER BY updated_at DESC
     LIMIT ?;`,
    [...params, limit]
  );
  return rows;
}

export function generateIdentifier(
  type: string,
  name: string,
  sourceUrl?: string,
  label?: string | null
): string {
  if (type === 'resource' && sourceUrl) {
    const slug = sourceUrl
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    return `resource/${slug}`;
  }
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // For entities, use the label in the identifier slug (e.g., 'person/jane-doe')
  // so semantically distinct entities with the same name don't collide.
  if (type === 'entity' && label) {
    return `${label.toLowerCase()}/${slug}`;
  }
  return `${type.toLowerCase()}/${slug}`;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
