import { executeQuery, executeExec } from '../query-executor';
import type { NodeType } from '../../../shared/types';

interface DbNodeType {
  type: string;
  description: string | null;
  color: string | null;
  category: string;
  is_default: number;
  parent_type: string | null;
  properties_schema: string | null;
}

function toNodeType(row: DbNodeType): NodeType {
  const category = row.category === 'structural' ? 'structural' : 'entity_label';
  return {
    type: row.type,
    description: row.description,
    color: row.color,
    category,
    isDefault: row.is_default === 1,
  };
}

export async function getAllNodeTypes(): Promise<NodeType[]> {
  const { rows } = await executeQuery<DbNodeType>(
    'SELECT * FROM ontology_node_types ORDER BY category, type;'
  );
  return rows.map(toNodeType);
}

export async function createNodeType(input: {
  type: string;
  description?: string;
  color?: string;
  category?: 'structural' | 'entity_label';
}): Promise<NodeType> {
  const { rows } = await executeQuery<DbNodeType>(
    `INSERT INTO ontology_node_types (type, description, color, category)
     VALUES (?, ?, ?, ?)
     RETURNING *;`,
    [
      input.type,
      input.description ?? null,
      input.color ?? null,
      input.category ?? 'entity_label',
    ]
  );
  return toNodeType(rows[0]);
}

export async function deleteNodeType(type: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM ontology_node_types WHERE type = ?;',
    [type]
  );
  return changes > 0;
}
