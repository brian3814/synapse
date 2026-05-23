import { executeQuery, executeExec } from '../query-executor';
import { generateIdentifier } from '../queries/node-queries';
import type {
  GraphMutation,
  CreateNodeDescriptor,
  CreateEdgeDescriptor,
  MutationResult,
  MutationOutcome,
} from './types';
import type { DbNode, DbEdge } from '../../../shared/types';

export async function executeMutation(mutation: GraphMutation): Promise<MutationResult> {
  const outcomes: MutationOutcome[] = [];
  const summary = { created: 0, merged: 0, skipped: 0, failed: 0 };

  if (mutation.create) {
    const onCollision = mutation.create.onCollision ?? 'fail';
    const mergeMode = mutation.create.mergeMode ?? 'overwrite';

    // Create nodes
    if (mutation.create.nodes) {
      for (const nodeDesc of mutation.create.nodes) {
        const outcome = await createNodeWithCollision(nodeDesc, onCollision, mergeMode);
        outcomes.push(outcome);
        summary[outcome.action === 'created' ? 'created'
          : outcome.action === 'merged' ? 'merged'
          : outcome.action === 'skipped' ? 'skipped'
          : 'failed']++;
      }
    }

    // Create edges
    if (mutation.create.edges) {
      for (const edgeDesc of mutation.create.edges) {
        try {
          const edge = await createEdgeFromDescriptor(edgeDesc);
          outcomes.push({
            identifier: `${edgeDesc.from}->${edgeDesc.to}:${edgeDesc.type}`,
            action: 'created',
            node: edge as unknown as Record<string, unknown>,
          });
          summary.created++;
        } catch (e: any) {
          outcomes.push({
            identifier: `${edgeDesc.from}->${edgeDesc.to}:${edgeDesc.type}`,
            action: 'failed',
            error: e.message,
          });
          summary.failed++;
        }
      }
    }
  }

  if (mutation.update) {
    for (const upd of mutation.update) {
      // Update operations require a preceding query that binds vars
      // For now, treat var as a node identifier
      try {
        const propsJson = JSON.stringify(upd.properties);
        const { rows } = await executeQuery<DbNode>(
          `UPDATE nodes SET properties = ?, updated_at = datetime('now')
           WHERE identifier = ? RETURNING *;`,
          [propsJson, upd.var]
        );
        if (rows.length > 0) {
          outcomes.push({
            identifier: upd.var,
            action: 'merged',
            node: rows[0] as unknown as Record<string, unknown>,
          });
          summary.merged++;
        }
      } catch (e: any) {
        outcomes.push({ identifier: upd.var, action: 'failed', error: e.message });
        summary.failed++;
      }
    }
  }

  if (mutation.delete) {
    for (const varRef of mutation.delete.vars) {
      try {
        const { changes } = await executeExec(
          'DELETE FROM nodes WHERE identifier = ?;',
          [varRef]
        );
        if (changes > 0) {
          outcomes.push({ identifier: varRef, action: 'created' /* deleted */ });
        }
      } catch (e: any) {
        outcomes.push({ identifier: varRef, action: 'failed', error: e.message });
        summary.failed++;
      }
    }
  }

  return { results: outcomes, summary };
}

async function createNodeWithCollision(
  desc: CreateNodeDescriptor,
  onCollision: 'fail' | 'skip' | 'merge' | 'create_new',
  mergeMode: 'overwrite' | 'keep_existing' | 'deep_merge',
): Promise<MutationOutcome> {
  const identifier = desc.identifier ?? generateIdentifier(desc.type, desc.name, desc.sourceUrl);

  // Check for existing node with same identifier
  const { rows: existing } = await executeQuery<DbNode>(
    'SELECT * FROM nodes WHERE identifier = ?;',
    [identifier]
  );

  if (existing.length === 0) {
    // No collision — create
    return await insertNode(desc, identifier);
  }

  // Collision detected
  const existingNode = existing[0];

  switch (onCollision) {
    case 'fail':
      return {
        identifier,
        action: 'failed',
        error: `Node with identifier "${identifier}" already exists`,
      };

    case 'skip':
      return {
        identifier,
        action: 'skipped',
        node: existingNode as unknown as Record<string, unknown>,
      };

    case 'merge':
      return await mergeNode(existingNode, desc, identifier, mergeMode);

    case 'create_new': {
      // Generate a unique identifier by appending a suffix
      const uniqueId = `${identifier}-${Date.now().toString(36)}`;
      return await insertNode(desc, uniqueId);
    }
  }
}

async function insertNode(
  desc: CreateNodeDescriptor,
  identifier: string,
): Promise<MutationOutcome> {
  try {
    const id = generateId();
    const { rows } = await executeQuery<DbNode>(
      `INSERT INTO nodes (id, identifier, name, type, properties, color, size, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *;`,
      [
        id,
        identifier,
        desc.name,
        desc.type,
        JSON.stringify(desc.properties ?? {}),
        desc.color ?? null,
        desc.size ?? 1.0,
        desc.sourceUrl ?? null,
      ]
    );
    return {
      identifier,
      action: 'created',
      node: rows[0] as unknown as Record<string, unknown>,
    };
  } catch (e: any) {
    return { identifier, action: 'failed', error: e.message };
  }
}

async function mergeNode(
  existing: DbNode,
  desc: CreateNodeDescriptor,
  identifier: string,
  mergeMode: 'overwrite' | 'keep_existing' | 'deep_merge',
): Promise<MutationOutcome> {
  try {
    const existingProps = JSON.parse(existing.properties || '{}');
    const newProps = desc.properties ?? {};
    let mergedProps: Record<string, unknown>;

    switch (mergeMode) {
      case 'overwrite':
        mergedProps = { ...existingProps, ...newProps };
        break;
      case 'keep_existing':
        mergedProps = { ...newProps, ...existingProps };
        break;
      case 'deep_merge':
        mergedProps = deepMerge(existingProps, newProps);
        break;
    }

    const { rows } = await executeQuery<DbNode>(
      `UPDATE nodes SET properties = ?, name = ?, updated_at = datetime('now')
       WHERE identifier = ? RETURNING *;`,
      [JSON.stringify(mergedProps), desc.name, identifier]
    );

    return {
      identifier,
      action: 'merged',
      node: rows[0] as unknown as Record<string, unknown>,
    };
  } catch (e: any) {
    return { identifier, action: 'failed', error: e.message };
  }
}

async function createEdgeFromDescriptor(desc: CreateEdgeDescriptor): Promise<DbEdge> {
  // Resolve `from` and `to` — could be identifiers or node IDs
  const sourceId = await resolveNodeRef(desc.from);
  const targetId = await resolveNodeRef(desc.to);

  const id = generateId();
  const { rows } = await executeQuery<DbEdge>(
    `INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [
      id,
      sourceId,
      targetId,
      desc.label ?? desc.type,
      desc.type,
      JSON.stringify(desc.properties ?? {}),
      desc.weight ?? 1.0,
      desc.directed !== false ? 1 : 0,
    ]
  );
  return rows[0];
}

async function resolveNodeRef(ref: string): Promise<string> {
  // Try as identifier first
  const { rows } = await executeQuery<{ id: string }>(
    'SELECT id FROM nodes WHERE identifier = ? OR id = ?;',
    [ref, ref]
  );
  if (rows.length === 0) {
    throw new Error(`Node not found: "${ref}"`);
  }
  return rows[0].id;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (
      val && typeof val === 'object' && !Array.isArray(val) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
