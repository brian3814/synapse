/**
 * Pure IO helpers for NoteEditor — extracted so branching logic
 * (entity-file vs. note) can be unit-tested without DOM/React.
 */

import { parseMarkdown, generateNoteMarkdown } from '../../../filesystem/markdown-parser';
import { stripMarkdownToPlainText } from '../../../notes/markdown-utils';

// ---- Types for injected dependencies ----

export interface NotesPlatform {
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, markdown: string): Promise<void>;
}

export interface EntityFilesPlatform {
  read(nodeId: string): Promise<{ path: string; content: string; contentHash: string | null } | null>;
  write(nodeId: string, markdown: string): Promise<{ contentHash: string }>;
}

export interface NoteSearchClient {
  upsert(nodeId: string, title: string, plainText: string): Promise<void>;
}

export interface GraphStoreClient {
  updateNode(patch: { id: string; name: string; properties?: Record<string, unknown> }): Promise<void>;
}

// ---- Load result ----

export interface LoadResult {
  title: string | null;
  content: string;
}

/**
 * Load content for a node.
 * Entity nodes read from `entityFiles.read()`, notes from `notes.read()`.
 */
export async function loadNodeContent(
  nodeId: string,
  isEntity: boolean,
  deps: { notes: NotesPlatform; entityFiles: EntityFilesPlatform },
): Promise<LoadResult | null> {
  if (isEntity) {
    const result = await deps.entityFiles.read(nodeId);
    if (!result) return null;
    const parsed = parseMarkdown(result.content);
    return { title: parsed.title, content: parsed.content };
  } else {
    const md = await deps.notes.read(nodeId);
    if (!md) return null;
    const parsed = parseMarkdown(md);
    return { title: null, content: parsed.content };
  }
}

// ---- Save result ----

export interface SaveActions {
  /** Which write API was used */
  writeTarget: 'entityFiles' | 'notes';
  /** Whether search index was updated */
  searchIndexed: boolean;
  /** Whether wikiLinks were passed to updateNode */
  wikiLinksStored: boolean;
  /** Whether BroadcastChannel sync should fire */
  shouldBroadcast: boolean;
  /** Whether filesystem folder sync should fire */
  shouldFolderSync: boolean;
}

/**
 * Save an existing node's content.
 * Entity nodes write via `entityFiles.write()` and skip note-specific side effects.
 * Note nodes use the original `notes.write()` + search index + wikiLinks path.
 *
 * Returns a descriptor of what actions were taken.
 */
export async function saveNodeContent(
  nodeId: string,
  title: string,
  content: string,
  isEntity: boolean,
  deps: {
    notes: NotesPlatform;
    entityFiles: EntityFilesPlatform;
    noteSearch: NoteSearchClient;
    graphStore: GraphStoreClient;
  },
): Promise<SaveActions> {
  const wikiLinks = extractWikiLinks(content);
  const markdown = generateNoteMarkdown(title, content, wikiLinks);

  if (isEntity) {
    await deps.entityFiles.write(nodeId, markdown);
    await deps.graphStore.updateNode({ id: nodeId, name: title });
    return {
      writeTarget: 'entityFiles',
      searchIndexed: false,
      wikiLinksStored: false,
      shouldBroadcast: false,
      shouldFolderSync: false,
    };
  } else {
    await deps.notes.write(nodeId, markdown);
    await deps.noteSearch.upsert(nodeId, title, stripMarkdownToPlainText(content));
    await deps.graphStore.updateNode({
      id: nodeId,
      name: title,
      properties: { wikiLinks },
    });
    return {
      writeTarget: 'notes',
      searchIndexed: true,
      wikiLinksStored: true,
      shouldBroadcast: true,
      shouldFolderSync: true,
    };
  }
}

/** Re-export extractWikiLinks so the component can use the same function */
export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const label = match[1].split('|')[0].trim();
    if (label && !links.includes(label)) links.push(label);
  }
  return links;
}
