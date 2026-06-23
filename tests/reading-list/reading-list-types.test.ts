import { describe, it, expect } from 'vitest';
import {
  isUrlSource,
  isFileSource,
  isImageFile,
  SUPPORTED_FILE_EXTENSIONS,
  migrateReadingListItem,
  type ResourceSource,
  type ReadingListResource,
} from '../../src/shared/reading-list-types';
import type { ReadingListItem } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOldItem(overrides: Partial<ReadingListItem> = {}): ReadingListItem {
  return {
    url: 'https://example.com/article',
    title: 'Test Article',
    addedAt: 1_000_000,
    status: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isUrlSource', () => {
  it('returns true for url source', () => {
    const src: ResourceSource = { kind: 'url', url: 'https://example.com' };
    expect(isUrlSource(src)).toBe(true);
  });

  it('returns false for file source', () => {
    const src: ResourceSource = { kind: 'file', filePath: '/tmp/doc.pdf', imported: false };
    expect(isUrlSource(src)).toBe(false);
  });
});

describe('isFileSource', () => {
  it('returns true for file source', () => {
    const src: ResourceSource = { kind: 'file', filePath: '/tmp/doc.pdf', imported: false };
    expect(isFileSource(src)).toBe(true);
  });

  it('returns false for url source', () => {
    const src: ResourceSource = { kind: 'url', url: 'https://example.com' };
    expect(isFileSource(src)).toBe(false);
  });

  it('narrows type — optional fields accessible', () => {
    const src: ResourceSource = {
      kind: 'file',
      filePath: '/tmp/doc.pdf',
      imported: true,
      vaultPath: 'notes/doc.pdf',
      keepOriginal: false,
    };
    if (isFileSource(src)) {
      expect(src.vaultPath).toBe('notes/doc.pdf');
      expect(src.keepOriginal).toBe(false);
    } else {
      throw new Error('Expected file source');
    }
  });
});

describe('isImageFile', () => {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  const nonImageExtensions = ['.pdf', '.txt', '.md', '.html', '.docx', '.csv'];

  for (const ext of imageExtensions) {
    it(`returns true for ${ext}`, () => {
      const src: ResourceSource = { kind: 'file', filePath: `/tmp/image${ext}`, imported: false };
      expect(isImageFile(src)).toBe(true);
    });
  }

  for (const ext of nonImageExtensions) {
    it(`returns false for ${ext}`, () => {
      const src: ResourceSource = { kind: 'file', filePath: `/tmp/file${ext}`, imported: false };
      expect(isImageFile(src)).toBe(false);
    });
  }

  it('returns false for url source', () => {
    const src: ResourceSource = { kind: 'url', url: 'https://example.com/image.png' };
    expect(isImageFile(src)).toBe(false);
  });

  it('is case-insensitive for extensions', () => {
    const src: ResourceSource = { kind: 'file', filePath: '/tmp/PHOTO.PNG', imported: false };
    expect(isImageFile(src)).toBe(true);
  });
});

describe('SUPPORTED_FILE_EXTENSIONS', () => {
  it('includes common document types', () => {
    expect(SUPPORTED_FILE_EXTENSIONS.has('.pdf')).toBe(true);
    expect(SUPPORTED_FILE_EXTENSIONS.has('.md')).toBe(true);
    expect(SUPPORTED_FILE_EXTENSIONS.has('.txt')).toBe(true);
    expect(SUPPORTED_FILE_EXTENSIONS.has('.html')).toBe(true);
  });

  it('includes image types', () => {
    expect(SUPPORTED_FILE_EXTENSIONS.has('.png')).toBe(true);
    expect(SUPPORTED_FILE_EXTENSIONS.has('.jpg')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// migrateReadingListItem
// ---------------------------------------------------------------------------

describe('migrateReadingListItem', () => {
  it('sets id and source from URL key', () => {
    const key = 'https://example.com/article';
    const old = makeOldItem({ url: key });
    const result = migrateReadingListItem(key, old);

    expect(result.id).toBe(key);
    expect(result.source).toEqual({ kind: 'url', url: key });
  });

  it('preserves title and addedAt', () => {
    const old = makeOldItem({ title: 'My Title', addedAt: 999 });
    const result = migrateReadingListItem(old.url, old);

    expect(result.title).toBe('My Title');
    expect(result.addedAt).toBe(999);
  });

  it('preserves targetVaultPath and targetVaultName', () => {
    const old = makeOldItem({ targetVaultPath: '/vaults/main', targetVaultName: 'Main Vault' });
    const result = migrateReadingListItem(old.url, old);

    expect(result.targetVaultPath).toBe('/vaults/main');
    expect(result.targetVaultName).toBe('Main Vault');
  });

  // -- status mappings --

  it('maps pending → pending with no error', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'pending' }));
    expect(result.status).toBe('pending');
    expect(result.error).toBeUndefined();
  });

  it('maps failed → pending with error populated', () => {
    const result = migrateReadingListItem(
      'url',
      makeOldItem({ status: 'failed', error: 'Network timeout' }),
    );
    expect(result.status).toBe('pending');
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe('Network timeout');
    expect(result.error!.attempts).toBe(1);
  });

  it('maps failed with no error message to a default message', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'failed' }));
    expect(result.status).toBe('pending');
    expect(result.error!.message).toBe('Unknown error');
  });

  it('maps fetching → processing', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'fetching' }));
    expect(result.status).toBe('processing');
    expect(result.error).toBeUndefined();
  });

  it('maps extracting → processing', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'extracting' }));
    expect(result.status).toBe('processing');
  });

  it('maps processing → processing', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'processing' }));
    expect(result.status).toBe('processing');
  });

  it('maps extracted → ready', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'extracted' }));
    expect(result.status).toBe('ready');
  });

  it('maps ready → ready', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'ready' }));
    expect(result.status).toBe('ready');
  });

  it('maps complete → complete', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'complete' }));
    expect(result.status).toBe('complete');
  });

  // -- extraction data grouping --

  it('groups extraction data when summary present', () => {
    const old = makeOldItem({
      status: 'ready',
      summary: 'A great article',
      keyTopics: ['AI', 'graphs'],
      extractedNodes: [{ name: 'Claude', type: 'Person', properties: { role: 'AI' } }],
      extractedEdges: [{ sourceName: 'Claude', targetName: 'Anthropic', label: 'created by' }],
      pageContent: '<p>content</p>',
      extractedAt: 2_000_000,
    });

    const result = migrateReadingListItem(old.url, old);
    expect(result.extraction).toBeDefined();
    expect(result.extraction!.summary).toBe('A great article');
    expect(result.extraction!.keyTopics).toEqual(['AI', 'graphs']);
    expect(result.extraction!.nodes).toHaveLength(1);
    expect(result.extraction!.nodes[0]).toMatchObject({ name: 'Claude', type: 'Person' });
    expect(result.extraction!.edges).toHaveLength(1);
    expect(result.extraction!.edges[0]).toMatchObject({
      sourceName: 'Claude',
      targetName: 'Anthropic',
      label: 'created by',
    });
    expect(result.extraction!.pageContent).toBe('<p>content</p>');
    expect(result.extraction!.extractedAt).toBe(2_000_000);
  });

  it('falls back extractedAt to addedAt when missing', () => {
    const old = makeOldItem({
      status: 'ready',
      summary: 'Summary',
      addedAt: 1_500_000,
    });
    const result = migrateReadingListItem(old.url, old);
    expect(result.extraction!.extractedAt).toBe(1_500_000);
  });

  it('leaves extraction undefined for pending items with no data', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'pending' }));
    expect(result.extraction).toBeUndefined();
  });

  it('leaves extraction undefined for processing items with no data', () => {
    const result = migrateReadingListItem('url', makeOldItem({ status: 'fetching' }));
    expect(result.extraction).toBeUndefined();
  });

  it('populates extraction for complete status with data', () => {
    const old = makeOldItem({
      status: 'complete',
      summary: 'Done',
      extractedAt: 3_000_000,
    });
    const result = migrateReadingListItem(old.url, old);
    expect(result.status).toBe('complete');
    expect(result.extraction).toBeDefined();
    expect(result.extraction!.summary).toBe('Done');
  });

  it('uses pageTitle as title fallback when title is missing', () => {
    const old = makeOldItem({ title: '', pageTitle: 'Page Title From Meta' });
    const result = migrateReadingListItem(old.url, old);
    // Empty string is falsy, so it falls through to pageTitle
    expect(result.title).toBe('Page Title From Meta');
  });

  it('falls back to URL as title when both title and pageTitle are absent', () => {
    // Build item without title
    const old: ReadingListItem = {
      url: 'https://example.com',
      title: '',
      addedAt: 1_000_000,
      status: 'pending',
    };
    const result = migrateReadingListItem(old.url, old);
    expect(result.title).toBe('https://example.com');
  });
});
