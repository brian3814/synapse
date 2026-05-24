import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import { saveNote } from '../note-commands';
import { parseMarkdown } from '../../notes/markdown-utils';

export const definitions: ChatToolDefinition[] = [
  {
    name: 'read_note',
    description:
      'Read the full markdown content of a note by node ID. Returns the raw markdown text, title, and word count.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The ID of the note node' },
      },
      required: ['node_id'],
    },
    executionContext: 'ui',
  },
  {
    name: 'create_note',
    description:
      'Create a new note in the knowledge graph with markdown content. Creates both the graph node and the note file. Returns the new node ID.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the note' },
        content: { type: 'string', description: 'Markdown content for the note body' },
      },
      required: ['title', 'content'],
    },
    executionContext: 'ui',
  },
  {
    name: 'update_note',
    description:
      'Update an existing note\'s content. Can append to or replace the current content.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The ID of the note node to update' },
        content: { type: 'string', description: 'New markdown content' },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'Whether to replace or append to existing content (default: replace)',
        },
      },
      required: ['node_id', 'content'],
    },
    executionContext: 'ui',
  },
  {
    name: 'list_notes',
    description:
      'List all notes in the knowledge graph. Returns note ID, title, and creation date.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of notes to return (default 50)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'search_notes',
    description:
      'Full-text search within note content. Searches note bodies and titles, not just entity names.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to find in note content' },
        limit: { type: 'number', description: 'Maximum results (default 10)' },
      },
      required: ['query'],
    },
    executionContext: 'ui',
  },
];

async function execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null> {
  switch (name) {
    case 'read_note': {
      const nodeId = input.node_id as string;
      const node = await ctx.db.nodes.getById(nodeId);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }) };
      if (node.type !== 'note') return { result: JSON.stringify({ error: 'Node is not a note' }) };

      const markdown = await ctx.notes.read(nodeId);
      if (!markdown) return { result: JSON.stringify({ error: 'Note content not found' }) };

      const parsed = parseMarkdown(markdown);
      const wordCount = parsed.content.split(/\s+/).filter(Boolean).length;

      return {
        result: JSON.stringify({ id: nodeId, title: node.name, content: parsed.content, wordCount }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'create_note': {
      const title = input.title as string;
      const content = input.content as string;

      const { nodeId } = await saveNote(ctx, {
        nodeId: null,
        name: title,
        content,
        isNew: true,
      });

      return {
        result: JSON.stringify({ id: nodeId, title, created: true }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'update_note': {
      const nodeId = input.node_id as string;
      const content = input.content as string;
      const mode = (input.mode as string) ?? 'replace';

      const node = await ctx.db.nodes.getById(nodeId);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }) };
      if (node.type !== 'note') return { result: JSON.stringify({ error: 'Node is not a note' }) };

      let finalContent = content;
      if (mode === 'append') {
        const existing = await ctx.notes.read(nodeId);
        if (existing) {
          const parsed = parseMarkdown(existing);
          finalContent = parsed.content + '\n\n' + content;
        }
      }

      await saveNote(ctx, {
        nodeId,
        name: node.name,
        content: finalContent,
        isNew: false,
      });

      return {
        result: JSON.stringify({ id: nodeId, title: node.name, updated: true, mode }),
        collectedNodeIds: [nodeId],
      };
    }

    case 'list_notes': {
      const limit = (input.limit as number) ?? 50;
      const allNotes = await ctx.db.noteSearch.getAll();
      const notes = allNotes.slice(0, limit).map((n) => ({
        id: n.node_id,
        title: n.title,
      }));
      return {
        result: JSON.stringify({ notes, total: allNotes.length }),
        collectedNodeIds: notes.map((n) => n.id),
      };
    }

    case 'search_notes': {
      const query = input.query as string;
      const limit = (input.limit as number) ?? 10;
      const results = await ctx.db.noteSearch.search(query, limit);
      const mapped = results.map((r) => ({
        id: r.node_id,
        title: r.title,
        snippet: r.snippet,
      }));
      return {
        result: JSON.stringify(mapped),
        collectedNodeIds: mapped.map((r) => r.id),
      };
    }

    default:
      return null;
  }
}

export const noteTools: ToolModule = { definitions, execute };
