import { create } from 'zustand';
import type { SyncNotification } from '../../shared/entity-sync-types';

interface EntitySyncState {
  notifications: SyncNotification[];
  setNotifications: (ns: SyncNotification[]) => void;
  addNotification: (n: SyncNotification) => void;
  addNotifications: (ns: SyncNotification[]) => void;
  dismissNotification: (id: string) => void;
  dismissAllForFile: (filePath: string) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  pendingCount: () => number;
}

export const useEntitySyncStore = create<EntitySyncState>((set, get) => ({
  notifications: [],

  setNotifications: (ns) => set({ notifications: ns }),

  addNotification: (n) => set((s) => ({
    notifications: [...s.notifications, n],
  })),

  addNotifications: (ns) => set((s) => ({
    notifications: [...s.notifications, ...ns],
  })),

  dismissNotification: (id) => set((s) => ({
    notifications: s.notifications.map((n) =>
      n.id === id ? { ...n, dismissed: true } : n
    ),
  })),

  dismissAllForFile: (filePath) => set((s) => ({
    notifications: s.notifications.map((n) =>
      n.filePath === filePath ? { ...n, dismissed: true } : n
    ),
  })),

  removeNotification: (id) => set((s) => ({
    notifications: s.notifications.filter((n) => n.id !== id),
  })),

  clearAll: () => set({ notifications: [] }),

  pendingCount: () => get().notifications.filter((n) => !n.dismissed).length,
}));
