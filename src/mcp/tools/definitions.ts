import type { McpToolDefinition } from './types';

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  // 3.1 search
  {
    name: 'search',
    description: 'Search the knowledge graph for entities, notes, or source content. Returns matching items with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query. Use empty string to list all items in scope.' },
        scope: {
          type: 'string',
          enum: ['all', 'entities', 'notes', 'semantic'],
          description: "Search scope. 'all' searches entities + notes + sources. 'semantic' uses vector embeddings (requires embeddings enabled). Default: 'all'.",
        },
        limit: { type: 'number', description: 'Max results. Default: 10.' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },

  // 3.2 get_entity
  {
    name: 'get_entity',
    description: 'Get complete details for an entity: properties, relationships (with neighbor names), aliases, tags, and source references.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Entity ID.' },
      },
      required: ['entity_id'],
    },
    annotations: { readOnlyHint: true },
  },

  // 3.3 get_neighbors
  {
    name: 'get_neighbors',
    description: 'Traverse the graph from a starting entity. Returns directly connected entities with relationship labels.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Starting entity ID.' },
        depth: { type: 'number', description: 'Traversal depth (1–3). Default: 1.' },
        limit: { type: 'number', description: 'Max nodes to return. Default: 50.' },
      },
      required: ['entity_id'],
    },
    annotations: { readOnlyHint: true },
  },

  // 3.4 manage_entity
  {
    name: 'manage_entity',
    description: 'Create, update, or delete entities. For create: requires name + label (semantic type like person, concept, technology). For update: requires entity_id, only specified fields change. For delete: requires entity_ids array. Aliases and tags use replace semantics.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Operation to perform.' },
        entity_id: { type: 'string', description: 'Required for update.' },
        entity_ids: { type: 'array', items: { type: 'string' }, description: 'Required for delete.' },
        name: { type: 'string', description: 'Entity name (required for create).' },
        label: { type: 'string', description: 'Semantic type e.g. person, concept, technology (required for create).' },
        properties: { type: 'object', description: 'Key-value properties.' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Full replacement list of alternate names. Omit to leave unchanged.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Full replacement list of tags. Omit to leave unchanged.' },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: true },
  },

  // 3.5 manage_relationship
  {
    name: 'manage_relationship',
    description: 'Create, update, or delete relationships between entities. For create: requires source_id, target_id, label. For update: requires relationship_id. For delete: requires relationship_ids array.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Operation to perform.' },
        relationship_id: { type: 'string', description: 'Required for update/delete single.' },
        relationship_ids: { type: 'array', items: { type: 'string' }, description: 'Required for delete.' },
        source_id: { type: 'string', description: 'Source entity ID (required for create).' },
        target_id: { type: 'string', description: 'Target entity ID (required for create).' },
        label: { type: 'string', description: 'Relationship label e.g. works_at, related_to (required for create).' },
        type: { type: 'string', description: 'Relationship category.' },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: true },
  },

  // 3.6 merge_entities
  {
    name: 'merge_entities',
    description: 'Merge two duplicate entities. Keeps the primary, transfers all relationships from the secondary, adds the secondary\'s name as an alias, then deletes the secondary. Runs in a transaction.',
    inputSchema: {
      type: 'object',
      properties: {
        primary_id: { type: 'string', description: 'Entity to KEEP.' },
        secondary_id: { type: 'string', description: 'Entity to merge into primary and DELETE.' },
      },
      required: ['primary_id', 'secondary_id'],
    },
    annotations: { destructiveHint: true },
  },

  // 3.7 manage_note
  {
    name: 'manage_note',
    description: 'Read, create, or update markdown notes. For read: requires note_id. For create: requires title + content. For update: requires note_id, plus title and/or content to change.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'create', 'update'], description: 'Operation to perform.' },
        note_id: { type: 'string', description: 'Required for read/update.' },
        title: { type: 'string', description: 'Note title (required for create).' },
        content: { type: 'string', description: 'Markdown content (required for create).' },
      },
      required: ['action'],
    },
  },

  // 3.8 analyze_graph
  {
    name: 'analyze_graph',
    description: 'Run graph intelligence analyses. Phase 1 supports: overview (counts + types), health (density, orphan rate), centrality (most-connected nodes), orphans (unconnected nodes), paths (shortest path between two entities).',
    inputSchema: {
      type: 'object',
      properties: {
        analysis: {
          type: 'string',
          enum: ['overview', 'health', 'centrality', 'orphans', 'paths'],
          description: 'Type of analysis.',
        },
        options: {
          type: 'object',
          description: 'Analysis-specific options. centrality: { limit, node_type }. orphans: { limit, node_type }. paths: { source_id, target_id, max_hops }.',
        },
      },
      required: ['analysis'],
    },
    annotations: { readOnlyHint: true },
  },
];
