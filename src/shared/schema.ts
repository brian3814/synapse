import { z } from 'zod';

// LLM extraction output schema
export const extractedNodeSchema = z.object({
  label: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const extractedEdgeSchema = z.object({
  sourceLabel: z.string().min(1),
  targetLabel: z.string().min(1),
  label: z.string().min(1),
  type: z.string().optional(),
});

export const extractionResultSchema = z.object({
  nodes: z.array(extractedNodeSchema),
  edges: z.array(extractedEdgeSchema),
});

export const readingListExtractionSchema = z.object({
  summary: z.string().min(1),
  keyTopics: z.array(z.string()).min(1),
  nodes: z.array(extractedNodeSchema),
  edges: z.array(extractedEdgeSchema),
});

export type ReadingListExtractionResult = z.infer<typeof readingListExtractionSchema>;

// Node input validation
export const createNodeInputSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  type: z.string().min(1).default('concept'),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
  color: z.string().optional(),
  size: z.number().positive().optional().default(1.0),
  sourceUrl: z.string().url().optional(),
});

export const updateNodeInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  color: z.string().optional(),
  size: z.number().positive().optional(),
});

// Edge input validation
export const createEdgeInputSchema = z.object({
  sourceId: z.string().min(1, 'Source node is required'),
  targetId: z.string().min(1, 'Target node is required'),
  label: z.string().min(1, 'Label is required'),
  type: z.string().min(1).default('related'),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
  weight: z.number().positive().optional().default(1.0),
  directed: z.boolean().optional().default(true),
  sourceUrl: z.string().url().optional(),
});

export const updateEdgeInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  weight: z.number().positive().optional(),
});

// LLM config validation
export const llmConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  model: z.string().min(1),
  apiKey: z.string().min(1),
});

// Search query
export const searchQuerySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().optional().default(50),
});

export type ExtractedNode = z.infer<typeof extractedNodeSchema>;
export type ExtractedEdge = z.infer<typeof extractedEdgeSchema>;
export type ExtractionResultParsed = z.infer<typeof extractionResultSchema>;
