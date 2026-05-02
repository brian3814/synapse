import { create } from 'zustand';
import type { DisplayMode, StructuralNodeType } from '../../shared/types';

type ActivePanel = 'none' | 'nodeDetail' | 'edgeDetail' | 'create' | 'query' | 'llm' | 'notes' | 'intelligence' | 'readingList';
type LayoutType = string;
type ChatDisplayMode = 'float' | 'sidebar';

/**
 * Plain-object replacement for Set<StructuralNodeType>.
 * Using a record instead of a Set because Zustand + React 19's
 * useSyncExternalStore doesn't handle mutable reference types (Set, Map)
 * well — the snapshot equality check triggers infinite re-render loops
 * (React error #185).
 */
export type LayerVisibility = Record<StructuralNodeType, boolean>;

interface UIStore {
  displayMode: DisplayMode;
  activePanel: ActivePanel;
  layoutType: LayoutType;
  clusteringEnabled: boolean;
  graphKey: number; // increment to force graph re-render
  chatOpen: boolean;
  chatDisplayMode: ChatDisplayMode;
  panelWidth: number;
  chatSidebarWidth: number;
  focusNodeCallback: ((nodeIds: string | string[]) => void) | null;
  settingsOpen: boolean;
  /**
   * Which of the three structural layers are visible in the main graph.
   * Default is entity-only — the "what do I know" view. Notes and
   * resources can be layered on top via the layer toggles.
   */
  visibleLayers: LayerVisibility;

  setDisplayMode: (mode: DisplayMode) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setSettingsOpen: (open: boolean) => void;
  forceActivePanel: (panel: ActivePanel) => void;
  setLayoutType: (layout: LayoutType) => void;
  toggleClustering: () => void;
  incrementGraphKey: () => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setChatDisplayMode: (mode: ChatDisplayMode) => void;
  setPanelWidth: (width: number) => void;
  setChatSidebarWidth: (width: number) => void;
  setFocusNodeCallback: (cb: ((nodeIds: string | string[]) => void) | null) => void;
  toggleLayer: (layer: StructuralNodeType) => void;
  /** Note ID to auto-open in NoteEditor when the notes panel activates. */
  pendingEditNoteId: string | null;
  setPendingEditNoteId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  displayMode: 'sidePanel',
  activePanel: 'none',
  layoutType: 'forceDirected2d',
  clusteringEnabled: true,
  graphKey: 0,
  chatOpen: false,
  chatDisplayMode: 'sidebar',
  panelWidth: 400,
  chatSidebarWidth: 400,
  focusNodeCallback: null,
  settingsOpen: false,
  visibleLayers: { entity: true, note: false, resource: false },
  pendingEditNoteId: null,

  setDisplayMode: (mode) => set({ displayMode: mode }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setActivePanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? 'none' : panel,
    })),
  forceActivePanel: (panel) => set({ activePanel: panel }),
  setLayoutType: (layout) => set({ layoutType: layout }),
  toggleClustering: () =>
    set((state) => ({ clusteringEnabled: !state.clusteringEnabled })),
  incrementGraphKey: () =>
    set((state) => ({ graphKey: state.graphKey + 1 })),
  toggleChat: () =>
    set((state) => ({ chatOpen: !state.chatOpen })),
  setChatOpen: (open) => set({ chatOpen: open }),
  setChatDisplayMode: (mode) => set({ chatDisplayMode: mode }),
  setPanelWidth: (width) => set({ panelWidth: Math.min(800, Math.max(200, width)) }),
  setChatSidebarWidth: (width) => set({ chatSidebarWidth: Math.min(800, Math.max(200, width)) }),
  setFocusNodeCallback: (cb) => set({ focusNodeCallback: cb }),
  setPendingEditNoteId: (id) => set({ pendingEditNoteId: id }),
  toggleLayer: (layer) =>
    set((state) => {
      const next = { ...state.visibleLayers, [layer]: !state.visibleLayers[layer] };
      // Always keep at least one layer visible so the graph isn't empty.
      if (!next.entity && !next.note && !next.resource) next.entity = true;
      return { visibleLayers: next, graphKey: state.graphKey + 1 };
    }),
}));
