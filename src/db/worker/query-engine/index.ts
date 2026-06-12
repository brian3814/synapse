import { graphQuerySchema, graphMutationSchema } from './schema';
import { planQuery } from './planner';
import { mapResults } from './result-mapper';
import { executeMutation } from './collision';
import { executeQuery } from '../query-executor';
import type { GraphQuery, GraphMutation, QueryResult, MutationResult } from './types';

export async function executeGraphQuery(input: unknown): Promise<QueryResult> {
  const startTime = performance.now();

  // 1. Validate
  const parsed = graphQuerySchema.parse(input);
  const graphQuery = parsed as GraphQuery;

  // 2. Plan → SQL
  const plan = planQuery(graphQuery);

  // 3. Execute SQL
  const { rows } = await executeQuery<Record<string, unknown>>(plan.sql, plan.params);

  // 4. Map flat rows → nested result tree
  const elapsed = performance.now() - startTime;
  return mapResults(rows, graphQuery, plan.columnMap, elapsed);
}

export async function executeGraphMutation(input: unknown): Promise<MutationResult> {
  // 1. Validate
  const parsed = graphMutationSchema.parse(input);
  const mutation = parsed as GraphMutation;

  // 2. Execute
  return executeMutation(mutation);
}

// Re-export types for consumers
export type { GraphQuery, GraphMutation, QueryResult, MutationResult } from './types';
