/**
 * Tests for NoteEditor entity-file branching logic.
 *
 * The core branching decision — whether to route through entityFiles or notes
 * APIs — is extracted into note-editor-io.ts helpers. These tests validate:
 *
 * 1. Entity nodes load from entityFiles.read() and parse the title from frontmatter
 * 2. Note nodes load from notes.read() and do NOT override title
 * 3. Entity saves write via entityFiles.write() and skip search indexing, wiki-links, broadcast, folder sync
 * 4. Note saves write via notes.write() and DO perform search indexing, wiki-links, broadcast, folder sync
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadNodeContent,
  saveNodeContent,
  extractWikiLinks,
  type NotesPlatform,
  type EntityFilesPlatform,
  type NoteSearchClient,
  type GraphStoreClient,
} from '../../src/ui/components/notes/note-editor-io';

// ---- Mock factories ----

function mockNotes(): NotesPlatform {
  return {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  };
}

function mockEntityFiles(): EntityFilesPlatform {
  return {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue({ contentHash: 'abc123' }),
  };
}

function mockNoteSearch(): NoteSearchClient {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
  };
}

function mockGraphStore(): GraphStoreClient {
  return {
    updateNode: vi.fn().mockResolvedValue(undefined),
  };
}

// ---- Tests ----

describe('loadNodeContent', () => {
  it('loads entity content from entityFiles.read()', async () => {
    const ef = mockEntityFiles();
    (ef.read as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/vault/.synapse/entities/machine-learning.md',
      content: '---\ntitle: Machine Learning\n---\nML is a branch of AI.',
      contentHash: 'hash1',
    });
    const n = mockNotes();

    const result = await loadNodeContent('node-1', true, { notes: n, entityFiles: ef });

    expect(ef.read).toHaveBeenCalledWith('node-1');
    expect(n.read).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Machine Learning');
    expect(result!.content).toBe('ML is a branch of AI.');
  });

  it('loads note content from notes.read()', async () => {
    const n = mockNotes();
    (n.read as ReturnType<typeof vi.fn>).mockResolvedValue(
      '---\ntitle: My Note\n---\nSome note content here.'
    );
    const ef = mockEntityFiles();

    const result = await loadNodeContent('node-2', false, { notes: n, entityFiles: ef });

    expect(n.read).toHaveBeenCalledWith('node-2');
    expect(ef.read).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    // Note path does NOT extract title from markdown — it uses node.name instead
    expect(result!.title).toBeNull();
    expect(result!.content).toBe('Some note content here.');
  });

  it('returns null when entity file does not exist', async () => {
    const ef = mockEntityFiles();
    (ef.read as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await loadNodeContent('missing', true, { notes: mockNotes(), entityFiles: ef });

    expect(result).toBeNull();
  });

  it('returns null when note does not exist', async () => {
    const n = mockNotes();
    (n.read as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await loadNodeContent('missing', false, { notes: n, entityFiles: mockEntityFiles() });

    expect(result).toBeNull();
  });

  it('handles entity file without frontmatter title', async () => {
    const ef = mockEntityFiles();
    (ef.read as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/vault/.synapse/entities/raw.md',
      content: 'Just raw content, no frontmatter.',
      contentHash: null,
    });

    const result = await loadNodeContent('node-3', true, { notes: mockNotes(), entityFiles: ef });

    expect(result).not.toBeNull();
    expect(result!.title).toBeNull();
    expect(result!.content).toBe('Just raw content, no frontmatter.');
  });
});

describe('saveNodeContent', () => {
  let deps: {
    notes: NotesPlatform;
    entityFiles: EntityFilesPlatform;
    noteSearch: NoteSearchClient;
    graphStore: GraphStoreClient;
  };

  beforeEach(() => {
    deps = {
      notes: mockNotes(),
      entityFiles: mockEntityFiles(),
      noteSearch: mockNoteSearch(),
      graphStore: mockGraphStore(),
    };
  });

  it('entity save writes via entityFiles and skips note side effects', async () => {
    const actions = await saveNodeContent(
      'entity-1',
      'Machine Learning',
      'ML is a subfield of AI.',
      true, // isEntity
      deps,
    );

    // Should write to entityFiles
    expect(deps.entityFiles.write).toHaveBeenCalledWith(
      'entity-1',
      expect.stringContaining('Machine Learning'),
    );
    // Should NOT write to notes
    expect(deps.notes.write).not.toHaveBeenCalled();
    // Should NOT update search index
    expect(deps.noteSearch.upsert).not.toHaveBeenCalled();
    // Should update node name
    expect(deps.graphStore.updateNode).toHaveBeenCalledWith({
      id: 'entity-1',
      name: 'Machine Learning',
    });
    // Should NOT include wikiLinks in updateNode call
    const updateCall = (deps.graphStore.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateCall).not.toHaveProperty('properties');

    // Action descriptors
    expect(actions.writeTarget).toBe('entityFiles');
    expect(actions.searchIndexed).toBe(false);
    expect(actions.wikiLinksStored).toBe(false);
    expect(actions.shouldBroadcast).toBe(false);
    expect(actions.shouldFolderSync).toBe(false);
  });

  it('note save writes via notes with search index and wikiLinks', async () => {
    const actions = await saveNodeContent(
      'note-1',
      'My Note',
      'Content with [[Link A]] and [[Link B]].',
      false, // isEntity = false
      deps,
    );

    // Should write to notes
    expect(deps.notes.write).toHaveBeenCalledWith(
      'note-1',
      expect.stringContaining('My Note'),
    );
    // Should NOT write to entityFiles
    expect(deps.entityFiles.write).not.toHaveBeenCalled();
    // Should update search index
    expect(deps.noteSearch.upsert).toHaveBeenCalledWith(
      'note-1',
      'My Note',
      expect.any(String),
    );
    // Should update node with wikiLinks in properties
    expect(deps.graphStore.updateNode).toHaveBeenCalledWith({
      id: 'note-1',
      name: 'My Note',
      properties: { wikiLinks: ['Link A', 'Link B'] },
    });

    // Action descriptors
    expect(actions.writeTarget).toBe('notes');
    expect(actions.searchIndexed).toBe(true);
    expect(actions.wikiLinksStored).toBe(true);
    expect(actions.shouldBroadcast).toBe(true);
    expect(actions.shouldFolderSync).toBe(true);
  });

  it('note save with no wikiLinks passes empty array in properties', async () => {
    await saveNodeContent('note-2', 'Plain Note', 'No links here.', false, deps);

    expect(deps.graphStore.updateNode).toHaveBeenCalledWith({
      id: 'note-2',
      name: 'Plain Note',
      properties: { wikiLinks: [] },
    });
  });

  it('entity save with wikiLinks in content does NOT store them', async () => {
    await saveNodeContent(
      'entity-2',
      'Entity With Links',
      'Has [[Link A]] but should not store.',
      true,
      deps,
    );

    // updateNode for entity should not have properties.wikiLinks
    const updateCall = (deps.graphStore.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateCall).not.toHaveProperty('properties');
  });
});

describe('extractWikiLinks', () => {
  it('extracts [[links]] from content', () => {
    expect(extractWikiLinks('Check out [[Machine Learning]] and [[AI]].')).toEqual([
      'Machine Learning',
      'AI',
    ]);
  });

  it('deduplicates links', () => {
    expect(extractWikiLinks('[[A]] then [[A]] again')).toEqual(['A']);
  });

  it('handles pipe aliases: [[label|display]]', () => {
    expect(extractWikiLinks('See [[ML|Machine Learning]]')).toEqual(['ML']);
  });

  it('returns empty array for content without links', () => {
    expect(extractWikiLinks('No links here')).toEqual([]);
  });

  it('trims whitespace in link labels', () => {
    expect(extractWikiLinks('[[ spaced ]]')).toEqual(['spaced']);
  });
});
