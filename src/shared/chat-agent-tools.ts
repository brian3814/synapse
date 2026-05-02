// KG tool definitions for agentic chat (executed in UI context against the local DB)

import type { ToolDefinition } from './agent-tools';
import { toAnthropicTools } from './agent-tools';

export type { ToolDefinition };
export { toAnthropicTools };

export type ChatToolExecutionContext = 'ui';

export interface ChatToolDefinition extends Omit<ToolDefinition, 'executionContext'> {
  executionContext: ChatToolExecutionContext;
}

export const CHAT_AGENT_TOOLS: ChatToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      'Search the knowledge graph comprehensively. Finds entities by name, expands to connected neighbors (1-hop graph traversal), and retrieves stored source content with URLs. This is the recommended FIRST tool for any question about what the user knows. Returns entities with IDs, relationships, and source excerpts with URLs for citation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — use key terms from the user\'s question',
        },
      },
      required: ['query'],
    },
    executionContext: 'ui',
  },
  {
    name: 'search_nodes',
    description:
      'Search the knowledge graph for nodes matching a query. Uses full-text search. Returns matching nodes with their type, properties, and ID.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 10)',
        },
      },
      required: ['query'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_node_details',
    description:
      'Get full details of a specific node by ID, including all properties, type, and source URL.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node to retrieve',
        },
      },
      required: ['nodeId'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_neighbors',
    description:
      'Get nodes connected to a given node within a specified number of hops.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the starting node',
        },
        hops: {
          type: 'number',
          description: 'Number of hops to traverse (default 1, max 3)',
        },
      },
      required: ['nodeId'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_edges_for_node',
    description:
      'Get all edges connected to a node, with their labels, types, and source/target IDs.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node',
        },
      },
      required: ['nodeId'],
    },
    executionContext: 'ui',
  },
  {
    name: 'search_sources',
    description:
      'Search stored source content (web page text) for passages matching a query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 5)',
        },
      },
      required: ['query'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_source_content',
    description:
      'Get the stored source text for a specific node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node whose source content to retrieve',
        },
      },
      required: ['nodeId'],
    },
    executionContext: 'ui',
  },
  {
    name: 'create_node',
    description:
      'Create a new node in the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the node',
        },
        type: {
          type: 'string',
          description: 'Type/category of the node (e.g. person, company, concept)',
        },
        properties: {
          type: 'object',
          description: 'Optional key-value properties for the node',
        },
      },
      required: ['name', 'type'],
    },
    executionContext: 'ui',
  },
  {
    name: 'update_node',
    description:
      'Update an existing node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node to update',
        },
        name: {
          type: 'string',
          description: 'New name for the node',
        },
        type: {
          type: 'string',
          description: 'New type for the node',
        },
        properties: {
          type: 'object',
          description: 'Properties to merge into the node',
        },
      },
      required: ['nodeId'],
    },
    executionContext: 'ui',
  },
  {
    name: 'create_edge',
    description:
      'Create a relationship between two nodes.',
    parameters: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'ID of the source node',
        },
        targetId: {
          type: 'string',
          description: 'ID of the target node',
        },
        label: {
          type: 'string',
          description: 'Relationship label (e.g. works_at, located_in)',
        },
        type: {
          type: 'string',
          description: 'Optional relationship category',
        },
      },
      required: ['sourceId', 'targetId', 'label'],
    },
    executionContext: 'ui',
  },
  {
    name: 'index_notes_folder',
    description:
      'Index or re-index the connected markdown notes folder into the knowledge graph. Creates resource nodes for each .md file and edges for wiki-links. Returns indexing statistics.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'ui',
  },
];

/** Convert chat tool definitions to Anthropic API tool format */
export function toAnthropicChatTools(
  tools: ChatToolDefinition[]
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
