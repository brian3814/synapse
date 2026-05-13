import type { CommandContext } from './types';
import { generateNoteMarkdown, stripMarkdownToPlainText } from '../notes/markdown-utils';
import { parseMarkdown } from '../filesystem/markdown-parser';
import { createWikilinkEdgesForNote } from '../shared/wikilink-parser';
import * as graphCommands from './graph-commands';

export async function saveNote(
  ctx: CommandContext,
  params: {
    nodeId: string | null;
    name: string;
    content: string;
    isNew: boolean;
    sourceUrl?: string;
  },
): Promise<{ nodeId: string }> {
  const wikiLinks = parseMarkdown(params.content).wikiLinks;
  const markdown = generateNoteMarkdown(params.name, params.content, wikiLinks);
  const plainText = stripMarkdownToPlainText(params.content);

  let nodeId = params.nodeId;

  if (params.isNew || !nodeId) {
    const result = await graphCommands.createNode(ctx, {
      name: params.name,
      type: 'note',
      properties: { wikiLinks },
      sourceUrl: params.sourceUrl,
    });
    if (!result.data) throw new Error('Failed to create note node');
    nodeId = result.data.id;
  } else {
    await graphCommands.updateNode(ctx, {
      id: nodeId,
      name: params.name,
      properties: { wikiLinks },
    });
  }

  await ctx.notes.write(nodeId, markdown);
  await ctx.db.noteSearch.upsert(nodeId, params.name, plainText);
  await createWikilinkEdgesForNote(ctx, nodeId, params.content);

  return { nodeId };
}
