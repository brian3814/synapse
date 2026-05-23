import { create } from 'zustand';
import { tags as dbTags } from '../../db/client/db-client';

interface TagStore {
  allTags: string[];
  nodeTagsCache: Map<string, string[]>;
  loading: boolean;

  loadAllTags: () => Promise<void>;
  getTagsForNode: (nodeId: string) => Promise<string[]>;
  setTagsForNode: (nodeId: string, tags: string[]) => Promise<void>;
  invalidateNode: (nodeId: string) => void;
}

export const useTagStore = create<TagStore>((set, get) => ({
  allTags: [],
  nodeTagsCache: new Map(),
  loading: false,

  loadAllTags: async () => {
    set({ loading: true });
    try {
      const allTags = await dbTags.getAllTags();
      set({ allTags, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  getTagsForNode: async (nodeId: string) => {
    const cached = get().nodeTagsCache.get(nodeId);
    if (cached) return cached;

    const tags = await dbTags.getForNode(nodeId);
    set((state) => {
      const newCache = new Map(state.nodeTagsCache);
      newCache.set(nodeId, tags);
      return { nodeTagsCache: newCache };
    });
    return tags;
  },

  setTagsForNode: async (nodeId: string, tags: string[]) => {
    await dbTags.setForNode(nodeId, tags);
    set((state) => {
      const newCache = new Map(state.nodeTagsCache);
      newCache.set(nodeId, tags);
      // Refresh all tags list if new tags were introduced
      const allTagsSet = new Set(state.allTags);
      let changed = false;
      for (const tag of tags) {
        if (!allTagsSet.has(tag)) {
          allTagsSet.add(tag);
          changed = true;
        }
      }
      return {
        nodeTagsCache: newCache,
        ...(changed ? { allTags: [...allTagsSet].sort() } : {}),
      };
    });
  },

  invalidateNode: (nodeId: string) => {
    set((state) => {
      const newCache = new Map(state.nodeTagsCache);
      newCache.delete(nodeId);
      return { nodeTagsCache: newCache };
    });
  },
}));
