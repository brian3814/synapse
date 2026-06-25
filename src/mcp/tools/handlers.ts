/**
 * MCP tool handler dispatch layer.
 *
 * executeToolHandler validates input, checks policy authorization, dispatches
 * to the KnowledgeService, and returns a ToolHandlerResult with serialized
 * JSON and mutation effects.
 *
 * Flow:
 *   1. validateToolInput — returns early with isError=true on invalid input
 *   2. policy.canExecute — returns auth error if denied
 *   3. Dispatch to KnowledgeService
 *   4. Return ToolHandlerResult
 */

import type { KnowledgeService } from '../knowledge-service';
import type { ProfilePolicy } from '../authorization';
import type { AnalysisType, MutationResult } from '../types';
import { validateToolInput } from './validation';

export interface ToolHandlerResult {
  result: string;                              // JSON string
  isError: boolean;
  effects: { nodeIds: string[]; edgeIds: string[] };
}

const EMPTY_EFFECTS = { nodeIds: [] as string[], edgeIds: [] as string[] };

function errorResult(message: string): ToolHandlerResult {
  return {
    result: JSON.stringify({ error: message }),
    isError: true,
    effects: { nodeIds: [], edgeIds: [] },
  };
}

function okResult(data: unknown, effects = EMPTY_EFFECTS): ToolHandlerResult {
  return {
    result: JSON.stringify(data),
    isError: false,
    effects,
  };
}

function mutationEffects<T>(mr: MutationResult<T>): { nodeIds: string[]; edgeIds: string[] } {
  return mr.effects;
}

// ---------------------------------------------------------------------------
// Tool dispatchers
// ---------------------------------------------------------------------------

async function handleSearch(
  service: KnowledgeService,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const params: Parameters<KnowledgeService['search']>[0] = {
    query: input.query as string,
  };
  if (input.scope !== undefined) params.scope = input.scope as any;
  if (input.limit !== undefined) params.limit = input.limit as number;
  const data = await service.search(params);
  return okResult(data);
}

async function handleGetEntity(
  service: KnowledgeService,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const data = await service.getEntity(input.entity_id as string);
  return okResult(data);
}

async function handleGetNeighbors(
  service: KnowledgeService,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const params: Parameters<KnowledgeService['getNeighbors']>[0] = {
    entity_id: input.entity_id as string,
  };
  if (input.depth !== undefined) params.depth = input.depth as number;
  if (input.limit !== undefined) params.limit = input.limit as number;
  const data = await service.getNeighbors(params);
  return okResult(data);
}

async function handleManageEntity(
  service: KnowledgeService,
  policy: ProfilePolicy,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const action = input.action as string;
  if (!policy.canExecute('manage_entity', action)) {
    return errorResult(`Not authorized: manage_entity:${action}`);
  }

  switch (action) {
    case 'create': {
      const entityInput: Parameters<KnowledgeService['createEntity']>[0] = {
        name: input.name as string,
        label: input.label as string,
      };
      if (input.properties !== undefined) entityInput.properties = input.properties as Record<string, unknown>;
      if (input.aliases !== undefined) entityInput.aliases = input.aliases as string[];
      if (input.tags !== undefined) entityInput.tags = input.tags as string[];
      const mr = await service.createEntity(entityInput);
      return okResult(mr.data, mutationEffects(mr));
    }

    case 'update': {
      const entityInput: Parameters<KnowledgeService['updateEntity']>[0] = {
        entity_id: input.entity_id as string,
      };
      if (input.name !== undefined) entityInput.name = input.name as string;
      if (input.label !== undefined) entityInput.label = input.label as string;
      if (input.properties !== undefined) entityInput.properties = input.properties as Record<string, unknown>;
      if (input.aliases !== undefined) entityInput.aliases = input.aliases as string[];
      if (input.tags !== undefined) entityInput.tags = input.tags as string[];
      const mr = await service.updateEntity(entityInput);
      return okResult(mr.data, mutationEffects(mr));
    }

    case 'delete': {
      const mr = await service.deleteEntities(input.entity_ids as string[]);
      return okResult(mr.data, mutationEffects(mr));
    }

    default:
      return errorResult(`manage_entity: unknown action '${action}'`);
  }
}

async function handleManageRelationship(
  service: KnowledgeService,
  policy: ProfilePolicy,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const action = input.action as string;
  if (!policy.canExecute('manage_relationship', action)) {
    return errorResult(`Not authorized: manage_relationship:${action}`);
  }

  switch (action) {
    case 'create': {
      const relInput: Parameters<KnowledgeService['createRelationship']>[0] = {
        source_id: input.source_id as string,
        target_id: input.target_id as string,
        label: input.label as string,
      };
      if (input.type !== undefined) relInput.type = input.type as string;
      const mr = await service.createRelationship(relInput);
      return okResult(mr.data, mutationEffects(mr));
    }

    case 'update': {
      const relInput: Parameters<KnowledgeService['updateRelationship']>[0] = {
        relationship_id: input.relationship_id as string,
      };
      if (input.label !== undefined) relInput.label = input.label as string;
      if (input.type !== undefined) relInput.type = input.type as string;
      const mr = await service.updateRelationship(relInput);
      return okResult(mr.data, mutationEffects(mr));
    }

    case 'delete': {
      const mr = await service.deleteRelationships(input.relationship_ids as string[]);
      return okResult(mr.data, mutationEffects(mr));
    }

    default:
      return errorResult(`manage_relationship: unknown action '${action}'`);
  }
}

async function handleMergeEntities(
  service: KnowledgeService,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const mr = await service.mergeEntities(
    input.primary_id as string,
    input.secondary_id as string,
  );
  return okResult(mr.data, mutationEffects(mr));
}

async function handleManageNote(
  service: KnowledgeService,
  policy: ProfilePolicy,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const action = input.action as string;
  if (!policy.canExecute('manage_note', action)) {
    return errorResult(`Not authorized: manage_note:${action}`);
  }

  switch (action) {
    case 'read': {
      const data = await service.readNote(input.note_id as string);
      return okResult(data);   // read → empty effects
    }

    case 'create': {
      const mr = await service.createNote(
        input.title as string,
        input.content as string,
      );
      return okResult(mr.data, mutationEffects(mr));
    }

    case 'update': {
      const updates: { title?: string; content?: string } = {};
      if (input.title !== undefined) updates.title = input.title as string;
      if (input.content !== undefined) updates.content = input.content as string;
      const mr = await service.updateNote(input.note_id as string, updates);
      return okResult(mr.data, mutationEffects(mr));
    }

    default:
      return errorResult(`manage_note: unknown action '${action}'`);
  }
}

async function handleAnalyzeGraph(
  service: KnowledgeService,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const analysis = input.analysis as AnalysisType;
  const options = input.options as Record<string, unknown> | undefined;
  const data = await service.analyzeGraph(analysis, options);
  return okResult(data);  // read-only → empty effects
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function executeToolHandler(
  service: KnowledgeService,
  policy: ProfilePolicy,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  // Step 1: validate input (also clamps get_neighbors depth/limit in-place)
  const validation = validateToolInput(name, input);
  if (!validation.valid) {
    return errorResult(validation.error);
  }

  // Step 2: authorization check (action-based tools authorize per-action inside their handler;
  //         non-action tools check here)
  switch (name) {
    case 'manage_entity':
    case 'manage_relationship':
    case 'manage_note':
      // Authorization is checked inside the action-dispatching handlers
      break;

    default: {
      if (!policy.canExecute(name)) {
        return errorResult(`Not authorized: ${name}`);
      }
    }
  }

  // Step 3: dispatch
  switch (name) {
    case 'search':
      return handleSearch(service, input);

    case 'get_entity':
      return handleGetEntity(service, input);

    case 'get_neighbors':
      return handleGetNeighbors(service, input);

    case 'manage_entity':
      return handleManageEntity(service, policy, input);

    case 'manage_relationship':
      return handleManageRelationship(service, policy, input);

    case 'merge_entities':
      return handleMergeEntities(service, input);

    case 'manage_note':
      return handleManageNote(service, policy, input);

    case 'analyze_graph':
      return handleAnalyzeGraph(service, input);

    default:
      return errorResult(`Unknown tool: '${name}'`);
  }
}
