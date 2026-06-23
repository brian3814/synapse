import { z } from 'zod';

const filterValueSchema: z.ZodType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const filterOperatorSchema = z
  .object({
    $eq: filterValueSchema.optional(),
    $ne: filterValueSchema.optional(),
    $gt: z.number().optional(),
    $gte: z.number().optional(),
    $lt: z.number().optional(),
    $lte: z.number().optional(),
    $like: z.string().optional(),
    $in: z.array(filterValueSchema).optional(),
    $notIn: z.array(filterValueSchema).optional(),
    $isNull: z.boolean().optional(),
  })
  .strict();

const whereClauseSchema = z.record(
  z.string(),
  z.union([filterValueSchema, filterOperatorSchema])
);

const contextDirectiveSchema = z.object({
  _context: z.literal(true),
  for: z.array(z.string()),
  repeat: z.object({
    maxDepth: z.number().int().positive().max(20),
    endType: z.string().nullable().optional(),
    endNodePattern: z.string().nullable().optional(),
  }),
});

const nodeDescriptorSchema: z.ZodType = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    var: z.string().optional(),
    nodePattern: z.string().nullable().optional(),
    where: whereClauseSchema.optional(),
    relationship: z
      .record(z.string(), z.union([nodeDescriptorSchema, contextDirectiveSchema]))
      .optional(),
    direction: z.enum(['out', 'in', 'any']).optional(),
    edgeVar: z.string().optional(),
    edgeWhere: whereClauseSchema.optional(),
  })
);

const orderByItemSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']).optional(),
});

export const graphQuerySchema = z.object({
  query: z.array(nodeDescriptorSchema).min(1),
  return: z.array(z.string()).min(1),
  orderBy: z.array(orderByItemSchema).optional(),
  skip: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

// Mutation schemas

const createNodeDescriptorSchema = z.object({
  type: z.string().min(1),
  identifier: z.string().optional(),
  label: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
  color: z.string().optional(),
  size: z.number().positive().optional(),
  sourceUrl: z.string().optional(),
});

const createEdgeDescriptorSchema = z.object({
  type: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  weight: z.number().positive().optional(),
  directed: z.boolean().optional(),
});

export const graphMutationSchema = z.object({
  create: z
    .object({
      nodes: z.array(createNodeDescriptorSchema).optional(),
      edges: z.array(createEdgeDescriptorSchema).optional(),
      onCollision: z.enum(['fail', 'skip', 'merge', 'create_new']).optional(),
      mergeMode: z.enum(['overwrite', 'keep_existing', 'deep_merge']).optional(),
    })
    .optional(),
  update: z
    .array(
      z.object({
        var: z.string().min(1),
        properties: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
  delete: z
    .object({
      vars: z.array(z.string().min(1)),
    })
    .optional(),
});
