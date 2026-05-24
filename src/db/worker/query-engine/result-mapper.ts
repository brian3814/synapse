import type { GraphQuery, NodeDescriptor, ResultNode, ColumnMapping, QueryResult } from './types';
import { isContextDirective } from './types';

const NODE_COLUMNS = [
  'id', 'identifier', 'label', 'type', 'properties',
  'x', 'y', 'z', 'color', 'size', 'source_url',
  'created_at', 'updated_at',
];

const EDGE_COLUMNS = [
  'id', 'source_id', 'target_id', 'label', 'type',
  'properties', 'weight', 'directed', 'source_url',
  'created_at', 'updated_at',
];

export function mapResults(
  rows: Record<string, unknown>[],
  graphQuery: GraphQuery,
  columnMap: ColumnMapping[],
  executionTimeMs: number,
): QueryResult {
  const returnVars = new Set(graphQuery.return);
  const results: ResultNode[] = [];

  // Find root-level mappings (parentLevel === undefined)
  const rootMappings = columnMap.filter(m => m.parentLevel === undefined && !m.isEdge);

  // Build a tree structure from column mappings
  const childrenByParent = new Map<number, ColumnMapping[]>();
  for (const m of columnMap) {
    if (m.parentLevel !== undefined) {
      const children = childrenByParent.get(m.parentLevel) ?? [];
      children.push(m);
      childrenByParent.set(m.parentLevel, children);
    }
  }

  // Group rows by root node id to build the tree
  const rootGroups = new Map<string, Record<string, unknown>[]>();
  const rootOrder: string[] = [];

  for (const row of rows) {
    for (const rootMap of rootMappings) {
      const rootId = row[`${rootMap.alias}_id`] as string | null;
      if (rootId == null) continue;

      if (!rootGroups.has(rootId)) {
        rootGroups.set(rootId, []);
        rootOrder.push(rootId);
      }
      rootGroups.get(rootId)!.push(row);
    }
  }

  // Build result tree for each root group
  for (const rootId of rootOrder) {
    const groupRows = rootGroups.get(rootId)!;
    for (const rootMap of rootMappings) {
      const firstRow = groupRows[0];
      const checkId = firstRow[`${rootMap.alias}_id`] as string | null;
      if (checkId !== rootId) continue;

      const rootNode = buildResultNode(
        groupRows,
        rootMap,
        columnMap,
        childrenByParent,
        graphQuery.query[0], // Use first query descriptor as template
        returnVars,
      );

      if (rootNode && !results.some(r => r.data?.id === rootNode.data?.id)) {
        results.push(rootNode);
      }
    }
  }

  return {
    results,
    metadata: {
      count: results.length,
      executionTimeMs,
    },
  };
}

function buildResultNode(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  allMappings: ColumnMapping[],
  childrenByParent: Map<number, ColumnMapping[]>,
  descriptor: NodeDescriptor | undefined,
  returnVars: Set<string>,
): ResultNode | null {
  const firstRow = rows[0];
  const nodeId = firstRow[`${mapping.alias}_id`] as string | null;
  if (nodeId == null) return null;

  // Extract node data
  const data = extractNodeData(firstRow, mapping.alias);

  // Build relationships
  const relationship: Record<string, ResultNode[]> = {};
  const childMappings = childrenByParent.get(mapping.level) ?? [];

  for (const childMap of childMappings) {
    const relKey = childMap.relKey;
    if (!relKey) continue;

    // Find matching descriptor for this relationship
    const childDescriptor = descriptor?.relationship?.[relKey];
    const childDesc = childDescriptor && !isContextDirective(childDescriptor)
      ? childDescriptor
      : undefined;

    // Collect unique child nodes across all rows
    const seenChildIds = new Set<string>();
    const childNodes: ResultNode[] = [];

    for (const row of rows) {
      const childId = row[`${childMap.alias}_id`] as string | null;
      if (childId == null || seenChildIds.has(childId)) continue;
      seenChildIds.add(childId);

      // Filter rows relevant to this child
      const childRows = rows.filter(r => r[`${childMap.alias}_id`] === childId);

      const childNode = buildResultNode(
        childRows,
        childMap,
        allMappings,
        childrenByParent,
        childDesc,
        returnVars,
      );

      if (childNode) {
        childNodes.push(childNode);
      }
    }

    relationship[relKey] = childNodes;
  }

  // If descriptor has relationship keys with no matching data, include empty arrays
  if (descriptor?.relationship) {
    for (const key of Object.keys(descriptor.relationship)) {
      if (!isContextDirective(descriptor.relationship[key]) && !(key in relationship)) {
        relationship[key] = [];
      }
    }
  }

  return {
    type: data.type as string,
    var: mapping.varName,
    data,
    relationship,
  };
}

function extractNodeData(
  row: Record<string, unknown>,
  alias: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const col of NODE_COLUMNS) {
    const val = row[`${alias}_${col}`];
    if (val !== undefined) {
      data[col] = col === 'properties' && typeof val === 'string'
        ? tryParseJSON(val)
        : val;
    }
  }
  return data;
}

export function extractEdgeData(
  row: Record<string, unknown>,
  alias: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const col of EDGE_COLUMNS) {
    const val = row[`${alias}_${col}`];
    if (val !== undefined) {
      data[col] = col === 'properties' && typeof val === 'string'
        ? tryParseJSON(val)
        : val;
    }
  }
  return data;
}

function tryParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
