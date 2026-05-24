import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';

export const definitions: ChatToolDefinition[] = [
  {
    name: 'find_similar_entities',
    description:
      'Find entities with similar names using fuzzy matching. Use before creating a node to check for potential duplicates.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name to search for similar matches' },
        threshold: {
          type: 'number',
          description: 'Fuzzy match threshold 0-1 (default 0.3, lower = more permissive)',
        },
      },
      required: ['name'],
    },
    executionContext: 'ui',
  },
  {
    name: 'add_alias',
    description:
      'Add an alternative name (alias) for an existing node. Helps with entity resolution — future extractions matching this alias will link to the node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The node to add the alias to' },
        alias: { type: 'string', description: 'Alternative name for the entity' },
      },
      required: ['node_id', 'alias'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_aliases',
    description:
      'Get all aliases registered for a node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The node ID to get aliases for' },
      },
      required: ['node_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'tag_node',
    description:
      'Set tags on a node for categorization and retrieval. Replaces existing tags.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The node to tag' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of tag strings to set on the node',
        },
      },
      required: ['node_id', 'tags'],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_node_tags',
    description:
      'Get tags for a node, or list all tags used in the graph.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node ID to get tags for. If omitted, returns all tags in the graph.' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
];

async function execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null> {
  switch (name) {
    case 'find_similar_entities': {
      const entityName = input.name as string;
      const threshold = (input.threshold as number) ?? 0.3;
      const matches = await ctx.db.entityResolution.findMatches(entityName, threshold);
      const mapped = matches.map((m) => ({
        id: m.nodeId,
        name: m.name,
        matchType: m.matchType,
        similarity: m.similarity,
      }));
      return {
        result: JSON.stringify({ query: entityName, matches: mapped }),
        collectedNodeIds: mapped.map((m) => m.id),
      };
    }

    case 'add_alias': {
      const nodeId = input.node_id as string;
      const alias = input.alias as string;
      const node = await ctx.db.nodes.getById(nodeId);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }) };

      await ctx.db.entityResolution.addAlias(nodeId, alias);
      return {
        result: JSON.stringify({ node_id: nodeId, alias, added: true }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'get_aliases': {
      const nodeId = input.node_id as string;
      const aliases = await ctx.db.entityResolution.getAliases(nodeId);
      return {
        result: JSON.stringify({ node_id: nodeId, aliases: aliases.map((a) => ({ id: a.id, alias: a.alias })) }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'tag_node': {
      const nodeId = input.node_id as string;
      const tags = input.tags as string[];
      const node = await ctx.db.nodes.getById(nodeId);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }) };

      await ctx.db.tags.setForNode(nodeId, tags);
      return {
        result: JSON.stringify({ node_id: nodeId, tags, updated: true }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'get_node_tags': {
      const nodeId = input.node_id as string | undefined;
      if (nodeId) {
        const tags = await ctx.db.tags.getForNode(nodeId);
        return {
          result: JSON.stringify({ node_id: nodeId, tags }),
          collectedNodeIds: [nodeId],
        };
      }
      const allTags = await ctx.db.tags.getAllTags();
      return { result: JSON.stringify({ tags: allTags, count: allTags.length }) };
    }

    default:
      return null;
  }
}

export const entityTools: ToolModule = { definitions, execute };
