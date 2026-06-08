import { create } from 'zustand';
import type { ArtifactRecord, ArtifactType } from '../../shared/artifact-types';

interface ArtifactStore {
  artifacts: ArtifactRecord[];
  loading: boolean;

  loadArtifacts: () => Promise<void>;
  searchArtifacts: (query: string) => Promise<ArtifactRecord[]>;
  getArtifactContent: (id: string) => Promise<string>;
  createArtifact: (params: {
    type: ArtifactType;
    title: string;
    content: string;
    sessionId: string;
    sessionTitle: string;
    sessionCreatedAt: string;
  }) => Promise<ArtifactRecord>;
  updateArtifact: (id: string, content: string, title?: string) => Promise<ArtifactRecord>;
  deleteArtifact: (id: string) => Promise<void>;
}

export const useArtifactStore = create<ArtifactStore>((set, get) => ({
  artifacts: [],
  loading: false,

  loadArtifacts: async () => {
    set({ loading: true });
    try {
      const { artifacts } = await import('@platform');
      const list = await artifacts.list();
      set({ artifacts: list, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  searchArtifacts: async (query: string) => {
    const { artifacts } = await import('@platform');
    return artifacts.search(query);
  },

  getArtifactContent: async (id: string) => {
    const { artifacts } = await import('@platform');
    return artifacts.getContent(id);
  },

  createArtifact: async (params) => {
    const { artifacts } = await import('@platform');
    const record = await artifacts.create(params);
    set((state) => ({ artifacts: [record, ...state.artifacts] }));
    return record;
  },

  updateArtifact: async (id, content, title) => {
    const { artifacts } = await import('@platform');
    const record = await artifacts.update(id, content, title);
    set((state) => ({
      artifacts: state.artifacts.map((a) => (a.id === id ? record : a)),
    }));
    return record;
  },

  deleteArtifact: async (id) => {
    const { artifacts } = await import('@platform');
    await artifacts.delete(id);
    set((state) => ({
      artifacts: state.artifacts.filter((a) => a.id !== id),
    }));
  },
}));

export function initArtifactStoreListener(): () => void {
  let unsub: (() => void) | undefined;

  import('@platform').then(({ artifacts }) => {
    unsub = artifacts.onChanged((artifact: ArtifactRecord) => {
      useArtifactStore.setState((state) => {
        const exists = state.artifacts.find((a) => a.id === artifact.id);
        if (exists) {
          return { artifacts: state.artifacts.map((a) => (a.id === artifact.id ? artifact : a)) };
        }
        return { artifacts: [artifact, ...state.artifacts] };
      });
    });
  });

  return () => unsub?.();
}
