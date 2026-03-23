import React, { useState, useEffect, useCallback } from 'react';
import { nodeTypes as dbNodeTypes } from '../../../db/client/db-client';

const OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IN', 'IS NULL'] as const;
type Operator = typeof OPERATORS[number];

interface PropertyFilter {
  property: string;
  operator: Operator;
  value: string;
}

interface RelationshipRow {
  edgeType: string;
  direction: 'out' | 'in' | 'any';
  targetType: string;
}

interface QueryBuilderProps {
  onQueryReady: (json: string | null) => void;
  initialState?: BuilderState | null;
}

export interface BuilderState {
  nodeType: string;
  namePattern: string;
  filters: PropertyFilter[];
  relationships: RelationshipRow[];
  orderByField: string;
  orderByDir: 'asc' | 'desc';
  limit: string;
}

const INPUT_CLASS = 'w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600';
const SELECT_CLASS = 'bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500';

export function QueryBuilder({ onQueryReady, initialState }: QueryBuilderProps) {
  const [nodeTypes, setNodeTypes] = useState<string[]>([]);
  const [nodeType, setNodeType] = useState(initialState?.nodeType ?? '');
  const [namePattern, setLabelPattern] = useState(initialState?.namePattern ?? '');
  const [filters, setFilters] = useState<PropertyFilter[]>(initialState?.filters ?? []);
  const [relationships, setRelationships] = useState<RelationshipRow[]>(initialState?.relationships ?? []);
  const [orderByField, setOrderByField] = useState(initialState?.orderByField ?? '');
  const [orderByDir, setOrderByDir] = useState<'asc' | 'desc'>(initialState?.orderByDir ?? 'asc');
  const [limit, setLimit] = useState(initialState?.limit ?? '25');
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Load node types from ontology
  useEffect(() => {
    dbNodeTypes.getAll().then((types) => {
      setNodeTypes(types.map((t: { type: string }) => t.type));
    }).catch(() => {});
  }, []);

  const buildQuery = useCallback(() => {
    const query: Record<string, unknown> = {
      type: nodeType || 'entity',
      var: 'n',
    };

    if (namePattern.trim()) {
      query.nodePattern = namePattern.trim();
    }

    // Where clause from filters
    if (filters.length > 0) {
      const where: Record<string, unknown> = {};
      for (const f of filters) {
        if (!f.property.trim()) continue;
        switch (f.operator) {
          case '=':
            where[f.property] = castValue(f.value);
            break;
          case '!=':
            where[f.property] = { $ne: castValue(f.value) };
            break;
          case '>':
            where[f.property] = { $gt: Number(f.value) || 0 };
            break;
          case '>=':
            where[f.property] = { $gte: Number(f.value) || 0 };
            break;
          case '<':
            where[f.property] = { $lt: Number(f.value) || 0 };
            break;
          case '<=':
            where[f.property] = { $lte: Number(f.value) || 0 };
            break;
          case 'LIKE':
            where[f.property] = { $like: f.value };
            break;
          case 'IN':
            where[f.property] = { $in: f.value.split(',').map((v) => castValue(v.trim())) };
            break;
          case 'IS NULL':
            where[f.property] = { $isNull: true };
            break;
        }
      }
      if (Object.keys(where).length > 0) {
        query.where = where;
      }
    }

    // Relationships
    if (relationships.length > 0) {
      const relObj: Record<string, unknown> = {};
      relationships.forEach((rel, i) => {
        if (!rel.edgeType.trim()) return;
        relObj[rel.edgeType.trim()] = {
          type: rel.targetType || 'entity',
          var: `r${i}`,
          direction: rel.direction,
        };
      });
      if (Object.keys(relObj).length > 0) {
        query.relationship = relObj;
      }
    }

    // Build return array
    const returnVars = ['n'];
    relationships.forEach((rel, i) => {
      if (rel.edgeType.trim()) returnVars.push(`r${i}`);
    });

    const graphQuery: Record<string, unknown> = {
      query: [query],
      return: returnVars,
    };

    // Options
    if (orderByField.trim()) {
      graphQuery.orderBy = [{ field: orderByField.trim(), direction: orderByDir }];
    }
    const limitNum = parseInt(limit, 10);
    if (limitNum > 0) {
      graphQuery.limit = limitNum;
    }

    return JSON.stringify(graphQuery, null, 2);
  }, [nodeType, namePattern, filters, relationships, orderByField, orderByDir, limit]);

  // Notify parent whenever form state changes
  useEffect(() => {
    onQueryReady(buildQuery());
  }, [buildQuery, onQueryReady]);

  return (
    <div className="space-y-3">
      {/* Node Type */}
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Node Type</label>
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value)}
          className={`${INPUT_CLASS}`}
        >
          <option value="">Any</option>
          {nodeTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Label Pattern */}
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Name Pattern</label>
        <input
          value={namePattern}
          onChange={(e) => setLabelPattern(e.target.value)}
          placeholder="e.g. Ali*"
          className={INPUT_CLASS}
        />
        <p className="text-[10px] text-zinc-600 mt-0.5">Use * as wildcard</p>
      </div>

      {/* Property Filters */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-zinc-400">Property Filters</label>
          <button
            type="button"
            onClick={() => setFilters([...filters, { property: '', operator: '=', value: '' }])}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            + Add
          </button>
        </div>
        {filters.map((f, i) => (
          <div key={i} className="flex gap-1 mb-1">
            <input
              value={f.property}
              onChange={(e) => {
                const next = [...filters];
                next[i] = { ...f, property: e.target.value };
                setFilters(next);
              }}
              placeholder="property"
              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
            />
            <select
              value={f.operator}
              onChange={(e) => {
                const next = [...filters];
                next[i] = { ...f, operator: e.target.value as Operator };
                setFilters(next);
              }}
              className="bg-zinc-800 border border-zinc-600 rounded px-1 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            {f.operator !== 'IS NULL' && (
              <input
                value={f.value}
                onChange={(e) => {
                  const next = [...filters];
                  next[i] = { ...f, value: e.target.value };
                  setFilters(next);
                }}
                placeholder="value"
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
            )}
            <button
              type="button"
              onClick={() => setFilters(filters.filter((_, j) => j !== i))}
              className="text-zinc-500 hover:text-red-400 px-1 text-xs"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Relationships */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-zinc-400">Relationships</label>
          <button
            type="button"
            onClick={() =>
              setRelationships([...relationships, { edgeType: '', direction: 'out', targetType: '' }])
            }
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            + Add
          </button>
        </div>
        {relationships.map((rel, i) => (
          <div key={i} className="bg-zinc-800/50 border border-zinc-700 rounded p-2 mb-1 space-y-1">
            <div className="flex gap-1 items-center">
              <input
                value={rel.edgeType}
                onChange={(e) => {
                  const next = [...relationships];
                  next[i] = { ...rel, edgeType: e.target.value };
                  setRelationships(next);
                }}
                placeholder="Edge type (e.g. WORKS_AT)"
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
              <button
                type="button"
                onClick={() => setRelationships(relationships.filter((_, j) => j !== i))}
                className="text-zinc-500 hover:text-red-400 px-1 text-xs"
              >
                x
              </button>
            </div>
            <div className="flex gap-1">
              <select
                value={rel.direction}
                onChange={(e) => {
                  const next = [...relationships];
                  next[i] = { ...rel, direction: e.target.value as 'out' | 'in' | 'any' };
                  setRelationships(next);
                }}
                className={`${SELECT_CLASS} text-xs flex-1`}
              >
                <option value="out">out</option>
                <option value="in">in</option>
                <option value="any">any</option>
              </select>
              <select
                value={rel.targetType}
                onChange={(e) => {
                  const next = [...relationships];
                  next[i] = { ...rel, targetType: e.target.value };
                  setRelationships(next);
                }}
                className={`${SELECT_CLASS} text-xs flex-1`}
              >
                <option value="">Any type</option>
                {nodeTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* Options (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setOptionsOpen(!optionsOpen)}
          className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
        >
          <span className={`transition-transform ${optionsOpen ? 'rotate-90' : ''}`}>&#9654;</span>
          Options
        </button>
        {optionsOpen && (
          <div className="mt-2 space-y-2">
            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1">Order By</label>
              <div className="flex gap-1">
                <input
                  value={orderByField}
                  onChange={(e) => setOrderByField(e.target.value)}
                  placeholder="e.g. n.name"
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
                />
                <select
                  value={orderByDir}
                  onChange={(e) => setOrderByDir(e.target.value as 'asc' | 'desc')}
                  className={`${SELECT_CLASS} text-xs`}
                >
                  <option value="asc">ASC</option>
                  <option value="desc">DESC</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1">Limit</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                min="1"
                max="1000"
                className="w-24 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function castValue(v: string): string | number | boolean | null {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const num = Number(v);
  if (!isNaN(num) && v.trim() !== '') return num;
  return v;
}

/** Best-effort parse of GraphQuery JSON back into builder state */
export function parseBuilderState(json: string): BuilderState | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.query?.[0]) return null;
    const root = parsed.query[0];

    const filters: PropertyFilter[] = [];
    if (root.where) {
      for (const [prop, val] of Object.entries(root.where)) {
        if (val === null || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          filters.push({ property: prop, operator: '=', value: String(val ?? 'null') });
        } else if (val && typeof val === 'object') {
          const op = val as Record<string, unknown>;
          if (op.$ne !== undefined) filters.push({ property: prop, operator: '!=', value: String(op.$ne) });
          else if (op.$gt !== undefined) filters.push({ property: prop, operator: '>', value: String(op.$gt) });
          else if (op.$gte !== undefined) filters.push({ property: prop, operator: '>=', value: String(op.$gte) });
          else if (op.$lt !== undefined) filters.push({ property: prop, operator: '<', value: String(op.$lt) });
          else if (op.$lte !== undefined) filters.push({ property: prop, operator: '<=', value: String(op.$lte) });
          else if (op.$like !== undefined) filters.push({ property: prop, operator: 'LIKE', value: String(op.$like) });
          else if (op.$in !== undefined) filters.push({ property: prop, operator: 'IN', value: (op.$in as unknown[]).join(',') });
          else if (op.$isNull !== undefined) filters.push({ property: prop, operator: 'IS NULL', value: '' });
        }
      }
    }

    const relationships: RelationshipRow[] = [];
    if (root.relationship) {
      for (const [edgeType, desc] of Object.entries(root.relationship)) {
        const d = desc as Record<string, unknown>;
        relationships.push({
          edgeType,
          direction: (d.direction as 'out' | 'in' | 'any') || 'out',
          targetType: (d.type as string) || '',
        });
      }
    }

    const orderBy = parsed.orderBy?.[0];

    return {
      nodeType: root.type || '',
      namePattern: root.nodePattern || '',
      filters,
      relationships,
      orderByField: orderBy?.field || '',
      orderByDir: orderBy?.direction || 'asc',
      limit: parsed.limit != null ? String(parsed.limit) : '25',
    };
  } catch {
    return null;
  }
}
