import { z } from 'zod';

export const sourceLocationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), page: z.number(), section: z.string().optional() }),
  z.object({ type: z.literal('region'), description: z.string() }),
  z.object({ type: z.literal('time'), timestamp: z.string(), speaker: z.string().optional() }),
  z.object({ type: z.literal('selector'), selector: z.string() }),
]);

export type SourceLocationZod = z.infer<typeof sourceLocationSchema>;

// LLM extraction output schema.
//
// In the three-layer model, the LLM outputs entities and edges. Resources are
// system-created (never emitted by the LLM). The `type` field is optional and
// is narrowed to 'entity' at merge time; what the LLM actually picks is a
// semantic `label` (concept/person/organization/...).
export const extractedNodeSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(), // legacy; defaults to 'entity' during normalization
  label: z.string().optional(), // semantic entity label: concept, person, technology, ...
  properties: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  sourceLocation: sourceLocationSchema.optional(),
});

export const extractedEdgeSchema = z.object({
  sourceName: z.string().min(1),
  targetName: z.string().min(1),
  label: z.string().min(1),
  type: z.string().optional(),
  sourceLocation: sourceLocationSchema.optional(),
});

/**
 * LLM-generated prose note. Emitted only when the extraction notes toggle
 * is enabled. `about` names are resolved to ReviewNode temp IDs at review
 * time; `mentions` likewise.
 */
export const extractedNoteSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  about: z.array(z.string()).optional().default([]),
  mentions: z.array(z.string()).optional().default([]),
});

export const extractionResultSchema = z.object({
  nodes: z.array(extractedNodeSchema),
  edges: z.array(extractedEdgeSchema),
  notes: z.array(extractedNoteSchema).optional().default([]),
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
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1).default('entity'),
  label: z.string().min(1).optional(),
  folderPath: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
  color: z.string().optional(),
  size: z.number().positive().optional().default(1.0),
  sourceUrl: z.string().url().optional(),
});

export const updateNodeInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  summary: z.string().optional(),
  folderPath: z.string().optional(),
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
  provider: z.enum(['anthropic']),
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
export type ExtractedNote = z.infer<typeof extractedNoteSchema>;
export type ExtractionResultParsed = z.infer<typeof extractionResultSchema>;
