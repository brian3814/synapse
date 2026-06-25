/**
 * Input validation for MCP tool calls.
 *
 * validateToolInput checks per-action required fields based on the
 * discriminated oneOf schemas in definitions.ts and returns either
 * { valid: true } or { valid: false, error: string }.
 *
 * Side-effect: for get_neighbors, depth and limit values are clamped
 * in-place on the input object before the handler runs. The validation
 * result is still { valid: true } — callers should use the mutated
 * input object after a successful validation.
 */

import type { McpToolName } from './types';

type ValidationOk = { valid: true };
type ValidationErr = { valid: false; error: string };
type ValidationResult = ValidationOk | ValidationErr;

const VALID_ANALYSIS_TYPES = new Set(['overview', 'health', 'centrality', 'orphans', 'paths']);

function ok(): ValidationOk { return { valid: true }; }
function err(msg: string): ValidationErr { return { valid: false, error: msg }; }

function has(input: Record<string, unknown>, field: string): boolean {
  return input[field] !== undefined && input[field] !== null;
}

function hasString(input: Record<string, unknown>, field: string): boolean {
  return typeof input[field] === 'string';
}

function hasNonEmptyArray(input: Record<string, unknown>, field: string): boolean {
  return Array.isArray(input[field]) && (input[field] as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------

function validateSearch(input: Record<string, unknown>): ValidationResult {
  if (!hasString(input, 'query')) return err("search requires 'query' (string)");
  return ok();
}

function validateGetEntity(input: Record<string, unknown>): ValidationResult {
  if (!hasString(input, 'entity_id')) return err("get_entity requires 'entity_id'");
  return ok();
}

function validateGetNeighbors(input: Record<string, unknown>): ValidationResult {
  if (!hasString(input, 'entity_id')) return err("get_neighbors requires 'entity_id'");

  // Clamp depth [1, 3] in place
  if (typeof input.depth === 'number') {
    input.depth = Math.min(3, Math.max(1, input.depth));
  }
  // Clamp limit [1, 200] in place
  if (typeof input.limit === 'number') {
    input.limit = Math.min(200, Math.max(1, input.limit));
  }

  return ok();
}

function validateManageEntity(input: Record<string, unknown>): ValidationResult {
  const action = input.action;
  if (!action) return err("manage_entity requires 'action' (create | update | delete)");

  switch (action) {
    case 'create':
      if (!hasString(input, 'name') || !hasString(input, 'label')) {
        return err("manage_entity:create requires 'name' and 'label'");
      }
      return ok();

    case 'update':
      if (!hasString(input, 'entity_id')) {
        return err("manage_entity:update requires 'entity_id'");
      }
      return ok();

    case 'delete':
      if (!hasNonEmptyArray(input, 'entity_ids')) {
        return err("manage_entity:delete requires 'entity_ids' (non-empty array)");
      }
      return ok();

    default:
      return err(`manage_entity: unknown action '${action}' (expected create | update | delete)`);
  }
}

function validateManageRelationship(input: Record<string, unknown>): ValidationResult {
  const action = input.action;
  if (!action) return err("manage_relationship requires 'action' (create | update | delete)");

  switch (action) {
    case 'create': {
      const missing: string[] = [];
      if (!hasString(input, 'source_id')) missing.push('source_id');
      if (!hasString(input, 'target_id')) missing.push('target_id');
      if (!hasString(input, 'label')) missing.push('label');
      if (missing.length > 0) {
        return err(`manage_relationship:create requires '${missing.join("', '")}'`);
      }
      return ok();
    }

    case 'update':
      if (!hasString(input, 'relationship_id')) {
        return err("manage_relationship:update requires 'relationship_id'");
      }
      return ok();

    case 'delete':
      if (!hasNonEmptyArray(input, 'relationship_ids')) {
        return err("manage_relationship:delete requires 'relationship_ids' (non-empty array)");
      }
      return ok();

    default:
      return err(`manage_relationship: unknown action '${action}' (expected create | update | delete)`);
  }
}

function validateMergeEntities(input: Record<string, unknown>): ValidationResult {
  const missing: string[] = [];
  if (!hasString(input, 'primary_id')) missing.push('primary_id');
  if (!hasString(input, 'secondary_id')) missing.push('secondary_id');
  if (missing.length > 0) {
    return err(`merge_entities requires '${missing.join("', '")}'`);
  }
  return ok();
}

function validateManageNote(input: Record<string, unknown>): ValidationResult {
  const action = input.action;
  if (!action) return err("manage_note requires 'action' (read | create | update)");

  switch (action) {
    case 'read':
      if (!hasString(input, 'note_id')) return err("manage_note:read requires 'note_id'");
      return ok();

    case 'create': {
      const missing: string[] = [];
      if (!hasString(input, 'title')) missing.push('title');
      if (!hasString(input, 'content')) missing.push('content');
      if (missing.length > 0) {
        return err(`manage_note:create requires '${missing.join("', '")}'`);
      }
      return ok();
    }

    case 'update':
      if (!hasString(input, 'note_id')) return err("manage_note:update requires 'note_id'");
      return ok();

    default:
      return err(`manage_note: unknown action '${action}' (expected read | create | update)`);
  }
}

function validateAnalyzeGraph(input: Record<string, unknown>): ValidationResult {
  const analysis = input.analysis;
  if (!analysis || typeof analysis !== 'string') {
    return err("analyze_graph requires 'analysis' (overview | health | centrality | orphans | paths)");
  }
  if (!VALID_ANALYSIS_TYPES.has(analysis)) {
    return err(`analyze_graph: invalid analysis type '${analysis}' (expected overview | health | centrality | orphans | paths)`);
  }

  if (analysis === 'paths') {
    const options = input.options as Record<string, unknown> | undefined;
    const missing: string[] = [];
    if (!options || !has(options, 'source_id')) missing.push('source_id');
    if (!options || !has(options, 'target_id')) missing.push('target_id');
    if (missing.length > 0) {
      return err(`analyze_graph:paths requires 'options.${missing.join("' and 'options.")}'`);
    }
  }

  return ok();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateToolInput(
  name: string,
  input: Record<string, unknown>,
): ValidationResult {
  switch (name as McpToolName) {
    case 'search':
      return validateSearch(input);
    case 'get_entity':
      return validateGetEntity(input);
    case 'get_neighbors':
      return validateGetNeighbors(input);
    case 'manage_entity':
      return validateManageEntity(input);
    case 'manage_relationship':
      return validateManageRelationship(input);
    case 'merge_entities':
      return validateMergeEntities(input);
    case 'manage_note':
      return validateManageNote(input);
    case 'analyze_graph':
      return validateAnalyzeGraph(input);
    default:
      return err(`Unknown tool: '${name}'`);
  }
}
