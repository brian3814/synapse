import type {
  GraphQuery,
  NodeDescriptor,
  WhereClause,
  FilterOperator,
  FilterValue,
  PlannedQuery,
  ColumnMapping,
  ContextDirective,
  OrderByItem,
} from './types';
import { isContextDirective } from './types';

// Validation for property names used in json_extract paths
const SAFE_PROPERTY_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validatePropertyName(name: string): void {
  if (!SAFE_PROPERTY_NAME.test(name)) {
    throw new Error(`Invalid property name: "${name}". Property names must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`);
  }
}

// Columns that live directly on the nodes/edges tables (not in JSON properties)
const NODE_DIRECT_COLUMNS = new Set([
  'id', 'identifier', 'name', 'type', 'color', 'size',
  'source_url', 'x', 'y', 'created_at', 'updated_at',
]);
const EDGE_DIRECT_COLUMNS = new Set([
  'id', 'source_id', 'target_id', 'label', 'type', 'weight',
  'directed', 'created_at', 'updated_at',
]);

interface PlannerState {
  selectCols: string[];
  fromClauses: string[];
  joinClauses: string[];
  whereClauses: string[];
  params: unknown[];
  columnMap: ColumnMapping[];
  levelCounter: number;
  cteParts: string[];     // For recursive CTEs (_context.repeat)
}

export function planQuery(graphQuery: GraphQuery): PlannedQuery {
  const state: PlannerState = {
    selectCols: [],
    fromClauses: [],
    joinClauses: [],
    whereClauses: [],
    params: [],
    columnMap: [],
    levelCounter: 0,
    cteParts: [],
  };

  // Resolve _context directives into per-relationship repeat configs
  const contextMap = new Map<string, ContextDirective['repeat']>();

  // Process each root node descriptor
  for (const rootDesc of graphQuery.query) {
    walkDescriptor(rootDesc, state, null, null, contextMap);
  }

  // Build SELECT columns
  const select = state.selectCols.join(', ');

  // Build FROM + JOINs
  const from = state.fromClauses.join('');
  const joins = state.joinClauses.join('\n');

  // Build WHERE
  const where = state.whereClauses.length > 0
    ? `WHERE ${state.whereClauses.join(' AND ')}`
    : '';

  // ORDER BY
  const orderBy = buildOrderBy(graphQuery.orderBy, state.columnMap);

  // LIMIT / OFFSET
  const limitOffset = buildLimitOffset(graphQuery.skip, graphQuery.limit, state.params);

  // Assemble
  const ctePreamble = state.cteParts.length > 0
    ? `WITH ${state.cteParts.join(', ')}\n`
    : '';

  const sql = `${ctePreamble}SELECT ${select}\nFROM ${from}\n${joins}\n${where}\n${orderBy}\n${limitOffset}`.trim() + ';';

  return {
    sql,
    params: state.params,
    columnMap: state.columnMap,
  };
}

function walkDescriptor(
  desc: NodeDescriptor,
  state: PlannerState,
  parentNodeAlias: string | null,
  relKey: string | null,
  contextMap: Map<string, ContextDirective['repeat']>,
  parentLevel?: number,
): void {
  const level = state.levelCounter++;
  const nodeAlias = `n${level}`;
  const edgeAlias = `e${level}`;

  // Register column mapping
  state.columnMap.push({
    level,
    alias: nodeAlias,
    varName: desc.var,
    edgeVarName: desc.edgeVar,
    isEdge: false,
    relKey: relKey ?? undefined,
    parentLevel,
  });

  // SELECT all node columns with alias prefix
  addNodeSelectColumns(nodeAlias, state);

  if (parentNodeAlias !== null && relKey !== null) {
    // This is a relationship join — also select edge columns
    addEdgeSelectColumns(edgeAlias, state);

    // Check if this relationship has a recursive _context directive
    const repeatConfig = contextMap.get(relKey);

    if (repeatConfig) {
      buildRecursiveJoin(
        desc, state, parentNodeAlias, relKey, nodeAlias, edgeAlias, level, repeatConfig,
      );
    } else {
      buildEdgeJoin(desc, state, parentNodeAlias, relKey, nodeAlias, edgeAlias, level);
    }
  } else {
    // Root node — FROM clause
    state.fromClauses.push(`nodes ${nodeAlias}`);
  }

  // Type filter
  addTypeFilter(desc.type, nodeAlias, state);

  // nodePattern filter (wildcard label matching)
  if (desc.nodePattern) {
    const sqlPattern = desc.nodePattern.replace(/\*/g, '%');
    state.whereClauses.push(`${nodeAlias}.name LIKE ?`);
    state.params.push(sqlPattern);
  }

  // Where clause
  if (desc.where) {
    addWhereFilters(desc.where, nodeAlias, NODE_DIRECT_COLUMNS, state);
  }

  // Edge where clause
  if (desc.edgeWhere && parentNodeAlias !== null) {
    addWhereFilters(desc.edgeWhere, edgeAlias, EDGE_DIRECT_COLUMNS, state);
  }

  // Collect _context directives from relationships before walking children
  const childContextMap = new Map(contextMap);
  if (desc.relationship) {
    for (const [key, value] of Object.entries(desc.relationship)) {
      if (isContextDirective(value)) {
        for (const targetKey of value.for) {
          childContextMap.set(targetKey, value.repeat);
        }
      }
    }
  }

  // Walk child relationships
  if (desc.relationship) {
    for (const [key, value] of Object.entries(desc.relationship)) {
      if (!isContextDirective(value)) {
        walkDescriptor(value, state, nodeAlias, key, childContextMap, level);
      }
    }
  }
}

function buildEdgeJoin(
  desc: NodeDescriptor,
  state: PlannerState,
  parentNodeAlias: string,
  relKey: string,
  nodeAlias: string,
  edgeAlias: string,
  _level: number,
): void {
  const direction = desc.direction ?? 'out';

  if (direction === 'out') {
    state.joinClauses.push(
      `LEFT JOIN edges ${edgeAlias} ON ${edgeAlias}.source_id = ${parentNodeAlias}.id AND ${edgeAlias}.type = ?`
    );
    state.params.push(relKey);
    state.joinClauses.push(
      `LEFT JOIN nodes ${nodeAlias} ON ${edgeAlias}.target_id = ${nodeAlias}.id`
    );
  } else if (direction === 'in') {
    state.joinClauses.push(
      `LEFT JOIN edges ${edgeAlias} ON ${edgeAlias}.target_id = ${parentNodeAlias}.id AND ${edgeAlias}.type = ?`
    );
    state.params.push(relKey);
    state.joinClauses.push(
      `LEFT JOIN nodes ${nodeAlias} ON ${edgeAlias}.source_id = ${nodeAlias}.id`
    );
  } else {
    // direction === 'any'
    state.joinClauses.push(
      `LEFT JOIN edges ${edgeAlias} ON (${edgeAlias}.source_id = ${parentNodeAlias}.id OR ${edgeAlias}.target_id = ${parentNodeAlias}.id) AND ${edgeAlias}.type = ?`
    );
    state.params.push(relKey);
    state.joinClauses.push(
      `LEFT JOIN nodes ${nodeAlias} ON ${nodeAlias}.id = CASE WHEN ${edgeAlias}.source_id = ${parentNodeAlias}.id THEN ${edgeAlias}.target_id ELSE ${edgeAlias}.source_id END`
    );
  }
}

function buildRecursiveJoin(
  desc: NodeDescriptor,
  state: PlannerState,
  parentNodeAlias: string,
  _relKey: string,
  nodeAlias: string,
  edgeAlias: string,
  level: number,
  repeatConfig: ContextDirective['repeat'],
): void {
  const cteName = `cte_${level}`;
  const direction = desc.direction ?? 'out';

  // All user-supplied values use parameterized bindings via cteParams
  const cteParams: unknown[] = [];

  // Build the recursive CTE with parameterized bindings
  let traversalJoin: string;
  if (direction === 'out') {
    traversalJoin = `JOIN edges e ON e.source_id = r.node_id AND e.type = ?
       JOIN nodes n ON e.target_id = n.id`;
    cteParams.push(_relKey);
  } else if (direction === 'in') {
    traversalJoin = `JOIN edges e ON e.target_id = r.node_id AND e.type = ?
       JOIN nodes n ON e.source_id = n.id`;
    cteParams.push(_relKey);
  } else {
    traversalJoin = `JOIN edges e ON (e.source_id = r.node_id OR e.target_id = r.node_id) AND e.type = ?
       JOIN nodes n ON n.id = CASE WHEN e.source_id = r.node_id THEN e.target_id ELSE e.source_id END`;
    cteParams.push(_relKey);
  }

  let stopCondition = '';
  if (repeatConfig.endType) {
    stopCondition += ` AND n.type != ?`;
    cteParams.push(repeatConfig.endType);
  }
  if (repeatConfig.endNodePattern) {
    const pat = repeatConfig.endNodePattern.replace(/\*/g, '%');
    stopCondition += ` AND n.name NOT LIKE ?`;
    cteParams.push(pat);
  }

  // maxDepth is parameterized to prevent injection
  cteParams.push(repeatConfig.maxDepth);

  const cte = `${cteName}(node_id, depth, path) AS (
    SELECT ${parentNodeAlias}.id, 0, ${parentNodeAlias}.id
    UNION ALL
    SELECT n.id, r.depth + 1, r.path || ',' || n.id
    FROM ${cteName} r
    ${traversalJoin}
    WHERE r.depth < ?
      AND instr(r.path, n.id) = 0${stopCondition}
  )`;

  // CTE params must come before the main query params
  state.params.unshift(...cteParams);
  state.cteParts.push(cte);

  // Join the CTE result back into the main query
  state.joinClauses.push(
    `LEFT JOIN ${cteName} ON 1=1`
  );
  state.joinClauses.push(
    `LEFT JOIN edges ${edgeAlias} ON ${edgeAlias}.type = ? AND (
      (${edgeAlias}.source_id = ${parentNodeAlias}.id AND ${edgeAlias}.target_id = ${cteName}.node_id)
      OR (${edgeAlias}.target_id = ${parentNodeAlias}.id AND ${edgeAlias}.source_id = ${cteName}.node_id)
    )`
  );
  state.params.push(_relKey);
  state.joinClauses.push(
    `LEFT JOIN nodes ${nodeAlias} ON ${nodeAlias}.id = ${cteName}.node_id`
  );
}

function addTypeFilter(type: string, alias: string, state: PlannerState): void {
  if (type.includes('|')) {
    const types = type.split('|').map(t => t.trim());
    const placeholders = types.map(() => '?').join(', ');
    state.whereClauses.push(`${alias}.type IN (${placeholders})`);
    state.params.push(...types);
  } else {
    state.whereClauses.push(`${alias}.type = ?`);
    state.params.push(type);
  }
}

function addWhereFilters(
  where: WhereClause,
  alias: string,
  directColumns: Set<string>,
  state: PlannerState,
): void {
  for (const [prop, value] of Object.entries(where)) {
    if (!directColumns.has(prop)) {
      validatePropertyName(prop);
    }
    const colRef = directColumns.has(prop)
      ? `${alias}.${prop}`
      : `json_extract(${alias}.properties, '$.${prop}')`;

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // Shorthand: exact equality
      if (value === null) {
        state.whereClauses.push(`${colRef} IS NULL`);
      } else {
        state.whereClauses.push(`${colRef} = ?`);
        state.params.push(value);
      }
    } else {
      // FilterOperator object
      const op = value as FilterOperator;
      applyFilterOperator(colRef, op, state);
    }
  }
}

function applyFilterOperator(
  colRef: string,
  op: FilterOperator,
  state: PlannerState,
): void {
  if (op.$eq !== undefined) {
    if (op.$eq === null) {
      state.whereClauses.push(`${colRef} IS NULL`);
    } else {
      state.whereClauses.push(`${colRef} = ?`);
      state.params.push(op.$eq);
    }
  }
  if (op.$ne !== undefined) {
    if (op.$ne === null) {
      state.whereClauses.push(`${colRef} IS NOT NULL`);
    } else {
      state.whereClauses.push(`${colRef} != ?`);
      state.params.push(op.$ne);
    }
  }
  if (op.$gt !== undefined) {
    state.whereClauses.push(`${colRef} > ?`);
    state.params.push(op.$gt);
  }
  if (op.$gte !== undefined) {
    state.whereClauses.push(`${colRef} >= ?`);
    state.params.push(op.$gte);
  }
  if (op.$lt !== undefined) {
    state.whereClauses.push(`${colRef} < ?`);
    state.params.push(op.$lt);
  }
  if (op.$lte !== undefined) {
    state.whereClauses.push(`${colRef} <= ?`);
    state.params.push(op.$lte);
  }
  if (op.$like !== undefined) {
    state.whereClauses.push(`${colRef} LIKE ?`);
    state.params.push(op.$like);
  }
  if (op.$in !== undefined && op.$in.length > 0) {
    const placeholders = op.$in.map(() => '?').join(', ');
    state.whereClauses.push(`${colRef} IN (${placeholders})`);
    state.params.push(...op.$in);
  }
  if (op.$notIn !== undefined && op.$notIn.length > 0) {
    const placeholders = op.$notIn.map(() => '?').join(', ');
    state.whereClauses.push(`${colRef} NOT IN (${placeholders})`);
    state.params.push(...op.$notIn);
  }
  if (op.$isNull !== undefined) {
    if (op.$isNull) {
      state.whereClauses.push(`${colRef} IS NULL`);
    } else {
      state.whereClauses.push(`${colRef} IS NOT NULL`);
    }
  }
}

function addNodeSelectColumns(alias: string, state: PlannerState): void {
  const cols = [
    'id', 'identifier', 'name', 'type', 'properties',
    'x', 'y', 'color', 'size', 'source_url',
    'created_at', 'updated_at',
  ];
  for (const col of cols) {
    state.selectCols.push(`${alias}.${col} AS ${alias}_${col}`);
  }
}

function addEdgeSelectColumns(alias: string, state: PlannerState): void {
  const cols = [
    'id', 'source_id', 'target_id', 'label', 'type',
    'properties', 'weight', 'directed',
    'created_at', 'updated_at',
  ];
  for (const col of cols) {
    state.selectCols.push(`${alias}.${col} AS ${alias}_${col}`);
  }
}

function buildOrderBy(
  orderBy: OrderByItem[] | undefined,
  columnMap: ColumnMapping[],
): string {
  if (!orderBy || orderBy.length === 0) return '';

  const parts: string[] = [];
  for (const item of orderBy) {
    const sqlCol = resolveFieldRef(item.field, columnMap);
    if (sqlCol) {
      parts.push(`${sqlCol} ${item.direction === 'desc' ? 'DESC' : 'ASC'}`);
    }
  }

  return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : '';
}

function resolveFieldRef(
  field: string,
  columnMap: ColumnMapping[],
): string | null {
  const dotIdx = field.indexOf('.');
  if (dotIdx === -1) return null;

  const varName = field.slice(0, dotIdx);
  const prop = field.slice(dotIdx + 1);

  const mapping = columnMap.find(m => m.varName === varName);
  if (!mapping) return null;

  const alias = mapping.alias;
  if (NODE_DIRECT_COLUMNS.has(prop)) {
    return `${alias}.${prop}`;
  }
  validatePropertyName(prop);
  return `json_extract(${alias}.properties, '$.${prop}')`;
}

function buildLimitOffset(
  skip: number | undefined,
  limit: number | undefined,
  params: unknown[],
): string {
  const parts: string[] = [];
  if (limit !== undefined) {
    parts.push('LIMIT ?');
    params.push(limit);
  }
  if (skip !== undefined) {
    if (limit === undefined) {
      parts.push('LIMIT -1');
    }
    parts.push('OFFSET ?');
    params.push(skip);
  }
  return parts.join(' ');
}

