// ── Query DSL Types ──

export interface GraphQuery {
  query: NodeDescriptor[];
  return: string[];
  orderBy?: OrderByItem[];
  skip?: number;
  limit?: number;
}

export interface OrderByItem {
  field: string;  // "var.property" e.g. "p.name"
  direction?: 'asc' | 'desc';
}

export interface NodeDescriptor {
  type: string;                  // Node type. "|" for unions: "Person|Engineer"
  var?: string;                  // Variable name for return/orderBy references
  nodePattern?: string | null;   // Label/identifier pattern. Wildcards: "Ali*"
  where?: WhereClause;
  relationship?: Record<string, NodeDescriptor | ContextDirective>;
  direction?: 'out' | 'in' | 'any';
  edgeVar?: string;
  edgeWhere?: WhereClause;
}

export type FilterValue = string | number | boolean | null;

export interface FilterOperator {
  $eq?: FilterValue;
  $ne?: FilterValue;
  $gt?: number;
  $gte?: number;
  $lt?: number;
  $lte?: number;
  $like?: string;
  $in?: FilterValue[];
  $notIn?: FilterValue[];
  $isNull?: boolean;
}

export interface WhereClause {
  [property: string]: FilterValue | FilterOperator;
}

export interface ContextDirective {
  _context: true;
  for: string[];
  repeat: {
    maxDepth: number;
    endType?: string | null;
    endNodePattern?: string | null;
  };
}

export function isContextDirective(
  value: NodeDescriptor | ContextDirective
): value is ContextDirective {
  return '_context' in value && (value as ContextDirective)._context === true;
}

// ── Mutation Types ──

export interface GraphMutation {
  create?: {
    nodes?: CreateNodeDescriptor[];
    edges?: CreateEdgeDescriptor[];
    onCollision?: 'fail' | 'skip' | 'merge' | 'create_new';
    mergeMode?: 'overwrite' | 'keep_existing' | 'deep_merge';
  };
  update?: { var: string; properties: Record<string, unknown> }[];
  delete?: { vars: string[] };
}

export interface CreateNodeDescriptor {
  type: string;
  identifier?: string;
  name: string;
  properties?: Record<string, unknown>;
  color?: string;
  size?: number;
  sourceUrl?: string;
}

export interface CreateEdgeDescriptor {
  type: string;
  from: string;
  to: string;
  label?: string;
  properties?: Record<string, unknown>;
  weight?: number;
  directed?: boolean;
}

// ── Result Types ──

export interface QueryResult {
  results: ResultNode[];
  metadata: {
    count: number;
    executionTimeMs: number;
  };
}

export interface ResultNode {
  type: string;
  var?: string;
  data: Record<string, unknown>;
  relationship: Record<string, ResultNode[]>;
}

export interface MutationResult {
  results: MutationOutcome[];
  summary: {
    created: number;
    merged: number;
    skipped: number;
    failed: number;
  };
}

export interface MutationOutcome {
  identifier: string;
  action: 'created' | 'merged' | 'skipped' | 'failed';
  node?: Record<string, unknown>;
  error?: string;
}

// ── Internal Planner Types ──

export interface PlannedQuery {
  sql: string;
  params: unknown[];
  columnMap: ColumnMapping[];
}

export interface ColumnMapping {
  level: number;
  alias: string;      // SQL alias prefix e.g. "n0", "e0"
  varName?: string;    // User-assigned variable name
  edgeVarName?: string;
  isEdge: boolean;
  relKey?: string;     // The relationship key that connects to parent
  parentLevel?: number;
}
