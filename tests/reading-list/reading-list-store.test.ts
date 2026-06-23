import { describe, it, expect } from 'vitest';
import {
  migrateReadingListItem,
  type ReadingListResource,
  type ResourceSource,
  type ResourceStatus,
  type SimilarityMatch,
} from '../../src/shared/reading-list-types';

// The store's migrateItems function wraps migrateReadingListItem and detects
// already-migrated items (those with 'source' and 'id' fields). We replicate
// that logic here to test it without instantiating the Zustand store.
function migrateItems(raw: Record<string, any>): Record<string, ReadingListResource> {
  const result: Record<string, ReadingListResource> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && 'source' in value && 'id' in value) {
      result[key] = value as ReadingListResource;
    } else {
      const migrated = migrateReadingListItem(key, value);
      result[migrated.id] = migrated;
    }
  }
  return result;
}

describe('migrateItems (store-level migration wrapper)', () => {
  it('passes through already-migrated items unchanged', () => {
    const resource: ReadingListResource = {
      id: 'https://example.com',
      source: { kind: 'url', url: 'https://example.com' },
      title: 'Example',
      addedAt: 1000,
      status: 'pending',
    };
    const result = migrateItems({ 'https://example.com': resource });
    expect(result['https://example.com']).toEqual(resource);
  });

  it('migrates old-format items and re-keys by id', () => {
    const old = {
      url: 'https://old.com',
      title: 'Old',
      addedAt: 2000,
      status: 'pending',
    };
    const result = migrateItems({ 'https://old.com': old });
    expect(result['https://old.com']).toBeDefined();
    expect(result['https://old.com'].source).toEqual({ kind: 'url', url: 'https://old.com' });
  });

  it('handles mixed old and new items', () => {
    const newItem: ReadingListResource = {
      id: 'new-id',
      source: { kind: 'file', filePath: '/tmp/doc.pdf', imported: false },
      title: 'New Doc',
      addedAt: 3000,
      status: 'ready',
    };
    const oldItem = {
      url: 'https://legacy.com',
      title: 'Legacy',
      addedAt: 1000,
      status: 'failed',
      error: 'timeout',
    };
    const result = migrateItems({ 'new-id': newItem, 'https://legacy.com': oldItem });

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['new-id'].source.kind).toBe('file');
    expect(result['https://legacy.com'].status).toBe('pending');
    expect(result['https://legacy.com'].error).toBeDefined();
  });

  it('handles empty input', () => {
    expect(migrateItems({})).toEqual({});
  });
});

describe('ReadingListResource state machine invariants', () => {
  function makeResource(overrides: Partial<ReadingListResource> = {}): ReadingListResource {
    return {
      id: 'test-1',
      source: { kind: 'url', url: 'https://test.com' },
      title: 'Test',
      addedAt: Date.now(),
      status: 'pending',
      ...overrides,
    };
  }

  it('pending items may have an error property', () => {
    const item = makeResource({
      status: 'pending',
      error: { message: 'Failed', stage: 'fetch', failedAt: Date.now(), attempts: 1 },
    });
    expect(item.status).toBe('pending');
    expect(item.error).toBeDefined();
  });

  it('pending items without error have no error property', () => {
    const item = makeResource({ status: 'pending' });
    expect(item.error).toBeUndefined();
  });

  it('processing items never have an error', () => {
    const item = makeResource({ status: 'processing', error: undefined });
    expect(item.error).toBeUndefined();
  });

  it('ready items have extraction data', () => {
    const item = makeResource({
      status: 'ready',
      extraction: {
        summary: 'A summary',
        keyTopics: ['topic'],
        nodes: [{ name: 'Node1', type: 'entity' }],
        edges: [{ sourceName: 'A', targetName: 'B', label: 'rel' }],
        pageContent: 'content',
        extractedAt: Date.now(),
      },
    });
    expect(item.extraction).toBeDefined();
    expect(item.extraction!.nodes).toHaveLength(1);
  });

  it('ready items may have similarity matches', () => {
    const matches: SimilarityMatch[] = [{
      extractedNodeName: 'Node1',
      existingNodeId: 'existing-1',
      existingNodeName: 'Node One',
      matchType: 'fuzzy',
      score: 0.9,
    }];
    const item = makeResource({
      status: 'ready',
      similarityMatches: matches,
      extraction: {
        summary: 's', keyTopics: ['t'], nodes: [{ name: 'Node1' }],
        edges: [], pageContent: '', extractedAt: 0,
      },
    });
    expect(item.similarityMatches).toHaveLength(1);
    expect(item.similarityMatches![0].matchType).toBe('fuzzy');
  });

  it('complete items keep extraction data for history', () => {
    const item = makeResource({
      status: 'complete',
      extraction: {
        summary: 'Done', keyTopics: ['done'], nodes: [], edges: [],
        pageContent: '', extractedAt: Date.now(),
      },
    });
    expect(item.status).toBe('complete');
    expect(item.extraction).toBeDefined();
  });

  it('url source has kind url with url field', () => {
    const source: ResourceSource = { kind: 'url', url: 'https://test.com' };
    expect(source.kind).toBe('url');
    expect(source.url).toBe('https://test.com');
  });

  it('file source has kind file with filePath and imported flag', () => {
    const source: ResourceSource = { kind: 'file', filePath: '/tmp/doc.pdf', imported: true, vaultPath: 'raw/doc.pdf', keepOriginal: true };
    expect(source.kind).toBe('file');
    expect(source.filePath).toBe('/tmp/doc.pdf');
    expect(source.imported).toBe(true);
    expect(source.vaultPath).toBe('raw/doc.pdf');
  });

  it('error tracks stage, attempts, and timestamp', () => {
    const item = makeResource({
      status: 'pending',
      error: { message: 'Schema validation failed', stage: 'validate', failedAt: 1700000000000, attempts: 3 },
    });
    expect(item.error!.stage).toBe('validate');
    expect(item.error!.attempts).toBe(3);
    expect(item.error!.failedAt).toBeGreaterThan(0);
  });
});

describe('status transition rules', () => {
  const VALID_TRANSITIONS: Record<ResourceStatus, ResourceStatus[]> = {
    pending: ['processing'],
    processing: ['ready', 'pending'],
    ready: ['complete'],
    complete: [],
  };

  for (const [from, toList] of Object.entries(VALID_TRANSITIONS)) {
    for (const to of toList) {
      it(`allows transition: ${from} → ${to}`, () => {
        expect(VALID_TRANSITIONS[from as ResourceStatus]).toContain(to);
      });
    }
  }

  it('processing → pending is the error path (not failed status)', () => {
    expect(VALID_TRANSITIONS.processing).toContain('pending');
  });

  it('there is no failed status', () => {
    expect(Object.keys(VALID_TRANSITIONS)).not.toContain('failed');
  });

  it('complete is a terminal state', () => {
    expect(VALID_TRANSITIONS.complete).toHaveLength(0);
  });
});
