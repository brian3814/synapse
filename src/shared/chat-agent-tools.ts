// KG tool definitions for agentic chat (executed in UI context against the local DB)

import type { ToolDefinition } from './agent-tools';
import { toAnthropicTools } from './agent-tools';
import { EXTENDED_TOOL_DEFINITIONS } from '../commands/tools';

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
    name: 'semantic_search',
    description:
      'Find nodes semantically similar to a query, even without keyword overlap. Use when keyword search returns few results or you need conceptually related nodes. Returns empty results if embeddings are not enabled.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
    executionContext: 'ui',
  },
  {
    name: 'manage_memory',
    description:
      'Create, update, or delete memories about the user. Use when you learn something worth remembering (preferences, facts, instructions) or when the user asks you to remember/forget something.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'list'],
          description: 'The operation to perform',
        },
        filename: {
          type: 'string',
          description: 'e.g. preference_concise.md (required for update/delete)',
        },
        type: {
          type: 'string',
          enum: ['preference', 'fact', 'instruction'],
          description: 'Memory category',
        },
        name: {
          type: 'string',
          description: 'Kebab-case identifier (e.g. prefers-typescript)',
        },
        description: {
          type: 'string',
          description: 'One-line summary for the memory index',
        },
        content: {
          type: 'string',
          description: 'Memory content (markdown)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords for retrieval (3-5 tags)',
        },
        supersedes: {
          type: 'string',
          description: 'Filename of the memory this one replaces (marks old one invalid)',
        },
      },
      required: ['action'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_nodes_batch',
    description:
      'Get full details of multiple nodes by their IDs in a single call. Use this instead of calling get_node_details repeatedly when you have multiple node IDs to look up.',
    parameters: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of node IDs to retrieve (max 50)',
        },
      },
      required: ['node_ids'],
    },
    executionContext: 'ui',
  },
  {
    name: 'delete_node',
    description:
      'Delete a single node from the knowledge graph by ID. Also removes all edges connected to it. For deleting multiple nodes, use delete_nodes_batch instead.',
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The ID of the node to delete',
        },
      },
      required: ['node_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'delete_nodes_batch',
    description:
      'Delete multiple nodes from the knowledge graph in a single call. Also removes all edges connected to them. Use this instead of calling delete_node repeatedly. Irreversible.',
    parameters: {
      type: 'object',
      properties: {
        node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of node IDs to delete (max 50)',
        },
      },
      required: ['node_ids'],
    },
    executionContext: 'ui',
  },
  {
    name: 'merge_nodes',
    description:
      'Merge two duplicate nodes into one. Keeps the primary node, transfers all edges from the secondary node to the primary, adds the secondary name as an alias for future recognition, then deletes the secondary node. Use this when you identify two nodes that refer to the same entity (e.g. "LLM" and "Large Language Model").',
    parameters: {
      type: 'object',
      properties: {
        primary_node_id: {
          type: 'string',
          description: 'ID of the node to KEEP (usually the one with more connections or the canonical name)',
        },
        secondary_node_id: {
          type: 'string',
          description: 'ID of the node to MERGE INTO the primary and then DELETE',
        },
      },
      required: ['primary_node_id', 'secondary_node_id'],
    },
    executionContext: 'ui',
  },
];

export const READ_ENTITY_FILE_TOOL: ChatToolDefinition = {
  name: 'read_entity_file',
  description:
    "Read the full content of an entity's working memory file. Returns markdown body and content_hash for optimistic locking on subsequent writes.",
  parameters: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'The entity node ID' },
    },
    required: ['node_id'],
  },
  executionContext: 'ui',
};

export const APPEND_ENTITY_FILE_TOOL: ChatToolDefinition = {
  name: 'append_entity_file',
  description:
    "Append text to an entity's working memory file. Pass expected_hash from a prior read_entity_file call for conflict detection.",
  parameters: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'The entity node ID' },
      text: { type: 'string', description: 'Markdown text to append to the entity file body' },
      expected_hash: { type: 'string', description: 'content_hash from read_entity_file for conflict detection' },
    },
    required: ['node_id', 'text'],
  },
  executionContext: 'ui',
};

export const PATCH_ENTITY_FILE_TOOL: ChatToolDefinition = {
  name: 'patch_entity_file',
  description:
    "Replace a section in an entity's working memory file. Pass expected_hash from a prior read_entity_file call for conflict detection.",
  parameters: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'The entity node ID' },
      old_text: { type: 'string', description: 'Exact text to find and replace' },
      new_text: { type: 'string', description: 'Replacement text' },
      expected_hash: { type: 'string', description: 'content_hash from read_entity_file' },
    },
    required: ['node_id', 'old_text', 'new_text'],
  },
  executionContext: 'ui',
};

export const ENTITY_FILE_TOOLS: ChatToolDefinition[] = [
  READ_ENTITY_FILE_TOOL,
  APPEND_ENTITY_FILE_TOOL,
  PATCH_ENTITY_FILE_TOOL,
];

export const ALL_CHAT_AGENT_TOOLS: ChatToolDefinition[] = [
  ...CHAT_AGENT_TOOLS,
  ...EXTENDED_TOOL_DEFINITIONS,
  ...ENTITY_FILE_TOOLS,
];

/** Tool names that only read data */
export const READ_TOOLS = new Set([
  'search_knowledge',
  'search_nodes',
  'get_node_details',
  'get_neighbors',
  'get_edges_for_node',
  'search_sources',
  'get_source_content',
  'semantic_search',
  'get_nodes_batch',
  'get_node_tags',
  'get_aliases',
  'find_similar_entities',
  'read_entity_file',
]);

/** Tool names that modify data */
export const WRITE_TOOLS = new Set([
  'create_node',
  'update_node',
  'create_edge',
  'delete_node',
  'delete_nodes_batch',
  'merge_nodes',
  'manage_memory',
  'tag_node',
  'add_alias',
  'append_entity_file',
  'patch_entity_file',
]);

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
