import { create } from 'zustand';
import type { DisplayMode } from '../../shared/types';

type ActivePanel = 'none' | 'nodeDetail' | 'edgeDetail' | 'create' | 'search' | 'query' | 'llm' | 'notes' | 'intelligence' | 'settings' | 'readingList';
type LayoutType = string;
type ChatDisplayMode = 'float' | 'sidebar';

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
  focusNodeCallback: ((nodeId: string) => void) | null;

  setDisplayMode: (mode: DisplayMode) => void;
  setActivePanel: (panel: ActivePanel) => void;
  forceActivePanel: (panel: ActivePanel) => void;
  setLayoutType: (layout: LayoutType) => void;
  toggleClustering: () => void;
  incrementGraphKey: () => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setChatDisplayMode: (mode: ChatDisplayMode) => void;
  setPanelWidth: (width: number) => void;
  setChatSidebarWidth: (width: number) => void;
  setFocusNodeCallback: (cb: ((nodeId: string) => void) | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  displayMode: 'sidePanel',
  activePanel: 'none',
  layoutType: 'forceDirected2d',
  clusteringEnabled: true,
  graphKey: 0,
  chatOpen: true,
  chatDisplayMode: 'sidebar',
  panelWidth: 400,
  chatSidebarWidth: 400,
  focusNodeCallback: null,

  setDisplayMode: (mode) => set({ displayMode: mode }),
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
}));
