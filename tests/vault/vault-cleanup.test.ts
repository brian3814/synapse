import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  type CleanupCategory,
  type CategoryCounts,
  type CategoryStatus,
  ALL_CATEGORIES,
  buildSelectedSet,
  pathMatches,
  categoriesToDelete,
  executeCleanup,
  formatFileSize,
} from '../../src/ui/components/settings/vault-cleanup-logic';

describe('Vault cleanup logic', () => {
  describe('ALL_CATEGORIES', () => {
    it('contains 6 categories in order', () => {
      expect(ALL_CATEGORIES).toEqual([
        'graph', 'chat', 'artifacts', 'memories', 'notes', 'vaultFiles',
      ]);
    });
  });

  describe('pathMatches', () => {
    it('returns true for exact match', () => {
      expect(pathMatches('/Users/brian/vault', '/Users/brian/vault')).toBe(true);
    });

    it('returns false for partial match', () => {
      expect(pathMatches('/Users/brian/vaul', '/Users/brian/vault')).toBe(false);
    });

    it('returns false for empty input', () => {
      expect(pathMatches('', '/Users/brian/vault')).toBe(false);
    });

    it('returns false for extra characters', () => {
      expect(pathMatches('/Users/brian/vault/', '/Users/brian/vault')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(pathMatches('/users/brian/vault', '/Users/brian/vault')).toBe(false);
    });

    it('handles Windows-style paths', () => {
      expect(pathMatches('C:\\Users\\brian\\vault', 'C:\\Users\\brian\\vault')).toBe(true);
    });
  });

  describe('buildSelectedSet', () => {
    const counts: CategoryCounts = {
      nodes: 10, edges: 5, chatSessions: 3,
      artifacts: 2, memories: 4, notes: 1,
      vaultFiles: { fileCount: 6, bytes: 1024 },
    };

    it('returns all categories when all have data', () => {
      const selected = buildSelectedSet(counts);
      expect(selected).toEqual(new Set(ALL_CATEGORIES));
    });

    it('excludes graph when nodes and edges are both 0', () => {
      const zeroCounts = { ...counts, nodes: 0, edges: 0 };
      const selected = buildSelectedSet(zeroCounts);
      expect(selected.has('graph')).toBe(false);
      expect(selected.has('chat')).toBe(true);
    });

    it('includes graph when only nodes > 0', () => {
      const nodeOnly = { ...counts, nodes: 5, edges: 0 };
      const selected = buildSelectedSet(nodeOnly);
      expect(selected.has('graph')).toBe(true);
    });

    it('excludes chat when sessions are 0', () => {
      const zeroChat = { ...counts, chatSessions: 0 };
      const selected = buildSelectedSet(zeroChat);
      expect(selected.has('chat')).toBe(false);
    });

    it('excludes vaultFiles when fileCount is 0', () => {
      const zeroFiles = { ...counts, vaultFiles: { fileCount: 0, bytes: 0 } };
      const selected = buildSelectedSet(zeroFiles);
      expect(selected.has('vaultFiles')).toBe(false);
    });

    it('returns empty set when everything is 0', () => {
      const allZero: CategoryCounts = {
        nodes: 0, edges: 0, chatSessions: 0,
        artifacts: 0, memories: 0, notes: 0,
        vaultFiles: { fileCount: 0, bytes: 0 },
      };
      const selected = buildSelectedSet(allZero);
      expect(selected.size).toBe(0);
    });
  });

  describe('categoriesToDelete', () => {
    it('returns only selected categories', () => {
      const selected = new Set<CleanupCategory>(['graph', 'artifacts']);
      expect(categoriesToDelete(selected)).toEqual(['graph', 'artifacts']);
    });

    it('preserves ALL_CATEGORIES ordering', () => {
      const selected = new Set<CleanupCategory>(['notes', 'graph', 'chat']);
      expect(categoriesToDelete(selected)).toEqual(['graph', 'chat', 'notes']);
    });

    it('returns empty for empty selection', () => {
      expect(categoriesToDelete(new Set())).toEqual([]);
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(2_621_440)).toBe('2.5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatFileSize(1_073_741_824)).toBe('1.0 GB');
    });

    it('formats 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });
  });

  describe('executeCleanup', () => {
    let deleters: Record<CleanupCategory, ReturnType<typeof vi.fn>>;
    let onProgress: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      deleters = {
        graph: vi.fn().mockResolvedValue(undefined),
        chat: vi.fn().mockResolvedValue(undefined),
        artifacts: vi.fn().mockResolvedValue(undefined),
        memories: vi.fn().mockResolvedValue(undefined),
        notes: vi.fn().mockResolvedValue(undefined),
        vaultFiles: vi.fn().mockResolvedValue(undefined),
      };
      onProgress = vi.fn();
    });

    it('calls only selected category deleters', async () => {
      const selected = new Set<CleanupCategory>(['artifacts', 'memories']);
      await executeCleanup(selected, deleters, onProgress);

      expect(deleters.artifacts).toHaveBeenCalledOnce();
      expect(deleters.memories).toHaveBeenCalledOnce();
      expect(deleters.graph).not.toHaveBeenCalled();
      expect(deleters.chat).not.toHaveBeenCalled();
      expect(deleters.notes).not.toHaveBeenCalled();
      expect(deleters.vaultFiles).not.toHaveBeenCalled();
    });

    it('reports in-progress then done for each category', async () => {
      const selected = new Set<CleanupCategory>(['chat']);
      await executeCleanup(selected, deleters, onProgress);

      expect(onProgress).toHaveBeenCalledWith('chat', 'in-progress');
      expect(onProgress).toHaveBeenCalledWith('chat', 'done');
    });

    it('processes categories in ALL_CATEGORIES order', async () => {
      const callOrder: string[] = [];
      deleters.notes = vi.fn().mockImplementation(() => { callOrder.push('notes'); return Promise.resolve(); });
      deleters.graph = vi.fn().mockImplementation(() => { callOrder.push('graph'); return Promise.resolve(); });
      deleters.chat = vi.fn().mockImplementation(() => { callOrder.push('chat'); return Promise.resolve(); });

      const selected = new Set<CleanupCategory>(['notes', 'graph', 'chat']);
      await executeCleanup(selected, deleters, onProgress);

      expect(callOrder).toEqual(['graph', 'chat', 'notes']);
    });

    it('continues after a category fails', async () => {
      deleters.artifacts = vi.fn().mockRejectedValue(new Error('delete failed'));
      const selected = new Set<CleanupCategory>(['artifacts', 'memories']);

      const result = await executeCleanup(selected, deleters, onProgress);

      expect(deleters.memories).toHaveBeenCalledOnce();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].category).toBe('artifacts');
      expect(result.errors[0].message).toBe('delete failed');
    });

    it('reports error status for failed category', async () => {
      deleters.graph = vi.fn().mockRejectedValue(new Error('db error'));
      const selected = new Set<CleanupCategory>(['graph']);
      await executeCleanup(selected, deleters, onProgress);

      expect(onProgress).toHaveBeenCalledWith('graph', 'in-progress');
      expect(onProgress).toHaveBeenCalledWith('graph', 'error');
    });

    it('returns no errors when all succeed', async () => {
      const selected = new Set<CleanupCategory>(['graph', 'chat', 'artifacts']);
      const result = await executeCleanup(selected, deleters, onProgress);
      expect(result.errors).toHaveLength(0);
    });

    it('handles empty selection gracefully', async () => {
      const result = await executeCleanup(new Set(), deleters, onProgress);
      expect(result.errors).toHaveLength(0);
      expect(onProgress).not.toHaveBeenCalled();
      for (const fn of Object.values(deleters)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it('all categories fail independently', async () => {
      for (const key of ALL_CATEGORIES) {
        deleters[key] = vi.fn().mockRejectedValue(new Error(`${key} failed`));
      }
      const selected = new Set<CleanupCategory>(ALL_CATEGORIES);
      const result = await executeCleanup(selected, deleters, onProgress);
      expect(result.errors).toHaveLength(ALL_CATEGORIES.length);
    });
  });
});
