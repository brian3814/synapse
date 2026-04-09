export const DB_NAME = 'kg_extension.db';

export const TYPE_COLOR_PALETTE = [
  '#059669', // emerald
  '#7C3AED', // violet
  '#4F46E5', // indigo
  '#D97706', // amber
  '#DC2626', // red
  '#0891B2', // cyan
  '#65A30D', // lime
  '#DB2777', // pink
  '#EA580C', // orange
  '#0D9488', // teal
];

/** Default structural node type for newly created nodes */
export const DEFAULT_NODE_TYPE = 'entity';

/** Default entity label when the LLM omits one */
export const DEFAULT_ENTITY_LABEL = 'concept';

/** The three fixed structural layer types in the three-layer model */
export const STRUCTURAL_NODE_TYPES = ['resource', 'entity', 'note'] as const;

export const FALLBACK_TYPE_COLOR = '#6B7280'; // gray

export const DEFAULT_NODE_SIZE = 1.0;
export const DEFAULT_EDGE_WEIGHT = 1.0;

export const SUBGRAPH_DEFAULT_HOPS = 2;
export const SUBGRAPH_MAX_HOPS = 5;

export const SEARCH_RESULT_LIMIT = 50;

export const DB_REQUEST_TIMEOUT_MS = 10_000;

export const LLM_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-20250414', label: 'Claude Haiku 4' },
  ],
} as const;

// Pricing per 1M tokens in USD
export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-haiku-4-20250414':  { inputPer1M: 0.80, outputPer1M: 4.00  },
};

/** Compute cost in cents from token counts and model ID */
export function computeCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude-sonnet-4-20250514'];
  return ((inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000) * 100;
}

export const OFFSCREEN_KEEPALIVE_INTERVAL_MS = 20_000;

export const DISPLAY_MODE_STORAGE_KEY = 'displayMode';
export const LLM_CONFIG_STORAGE_KEY = 'llmConfig';

// Viewport windowing constants
export const ZOOM_THRESHOLD_FAR = 0.15;
export const ZOOM_THRESHOLD_CLOSE = 1.5;
export const VIEWPORT_QUERY_DEBOUNCE_MS = 100;
export const VIEWPORT_PADDING = 0.3;
export const MAX_VIEWPORT_NODES = 5000;
export const SMALL_GRAPH_THRESHOLD = 10000;

export const LAYOUT_OPTIONS = [
  { id: 'forceDirected2d', label: 'Force Directed 2D' },
] as const;
