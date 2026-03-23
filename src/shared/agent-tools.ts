// Agent tool definitions for LLM-driven page extraction

export type ToolExecutionContext = 'content-script' | 'offscreen';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  executionContext: ToolExecutionContext;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_page_content',
    description:
      'Get the cleaned content of the current page. Returns markdown by default (preserving headings, links, tables, lists) or plain text. Navigation, scripts, and styling are removed.',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['markdown', 'text'],
          description: 'Output format. "markdown" (default) preserves document structure; "text" returns plain text.',
        },
      },
      required: [],
    },
    executionContext: 'content-script',
  },
  {
    name: 'get_page_metadata',
    description:
      'Get metadata about the current page: title, URL, meta description, Open Graph tags, JSON-LD structured data, and heading outline (h1-h3).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'content-script',
  },
  {
    name: 'query_selector',
    description:
      'Get the text content of the first element matching a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to match',
        },
      },
      required: ['selector'],
    },
    executionContext: 'content-script',
  },
  {
    name: 'query_selector_all',
    description:
      'Get the text content of all elements matching a CSS selector (max 50 results).',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to match',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 50)',
        },
      },
      required: ['selector'],
    },
    executionContext: 'content-script',
  },
  {
    name: 'get_links',
    description:
      'Get all links on the page with their text and href. Optionally scope to a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Optional CSS selector to scope link extraction',
        },
      },
      required: [],
    },
    executionContext: 'content-script',
  },
  {
    name: 'get_tables',
    description:
      'Extract HTML tables as arrays of row objects (header-keyed). Returns up to 5 tables with max 100 rows each.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector to target specific tables',
        },
      },
      required: [],
    },
    executionContext: 'content-script',
  },
  {
    name: 'get_structured_data',
    description:
      'Extract JSON-LD and microdata structured data from the page.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'content-script',
  },
  {
    name: 'fetch_url',
    description:
      'Fetch an external URL and return its content as markdown (max 20KB). Preserves headings, links, tables, and lists. Useful for reading linked pages referenced on the current page.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
      },
      required: ['url'],
    },
    executionContext: 'offscreen',
  },
  {
    name: 'save_entities',
    description:
      'Save extracted entities and relationships to the knowledge graph. This is the terminal tool — call it when extraction is complete. Nodes must have label and type. Edges reference nodes by sourceLabel and targetLabel.',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Entity name' },
              type: { type: 'string', description: 'Entity type (e.g. person, company, concept)' },
              properties: {
                type: 'object',
                description: 'Optional key-value properties',
              },
            },
            required: ['label', 'type'],
          },
          description: 'Entities to save',
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceLabel: { type: 'string', description: 'Source entity label' },
              targetLabel: { type: 'string', description: 'Target entity label' },
              label: { type: 'string', description: 'Relationship label (e.g. works_at, located_in)' },
              type: { type: 'string', description: 'Relationship category' },
            },
            required: ['sourceLabel', 'targetLabel', 'label'],
          },
          description: 'Relationships between entities',
        },
      },
      required: ['nodes', 'edges'],
    },
    executionContext: 'offscreen',
  },
];

/** Convert tool definitions to Anthropic API tool format */
export function toAnthropicTools(
  tools: ToolDefinition[]
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
