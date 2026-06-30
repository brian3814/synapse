import { create } from 'zustand';
import type { DisplayMode, StructuralNodeType } from '../../shared/types';

type ActivePanel = 'none' | 'nodeDetail' | 'edgeDetail' | 'create' | 'query' | 'notes' | 'intelligence' | 'readingList';
export type LeftPanel = 'none' | 'explorer' | 'chats';
type GraphOverlay = 'none' | 'nodeDetail' | 'edgeDetail' | 'create';
type LayoutType = string;
type ChatDisplayMode = 'float' | 'sidebar';

export type ContentTabType =
  | { kind: 'graph' }
  | { kind: 'noteEditor'; noteId: string }
  | { kind: 'extractionReview' }
  | { kind: 'extractionProgress'; resourceId: string }
  | { kind: 'viewer'; filePath: string }
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'readingList' }
  | { kind: 'notesBrowser' }
  | { kind: 'intelligence' }
  | { kind: 'query' }
  | { kind: 'agents' }
  | { kind: 'artifactBrowser' };

export interface ContentTab {
  id: string;
  type: ContentTabType;
  title: string;
}

export interface ContentColumn {
  id: string;
  tabs: ContentTab[];
  activeTabId: string;
  flex: number;
}

function contentTabId(type: ContentTabType): string {
  if (type.kind === 'graph') return 'graph';
  if (type.kind === 'extractionReview') return 'extraction-review';
  if (type.kind === 'extractionProgress') return `extraction-progress-${type.resourceId}`;
  if (type.kind === 'noteEditor') return `note-${type.noteId}`;
  if (type.kind === 'viewer') return `viewer-${type.filePath}`;
  if (type.kind === 'artifact') return `artifact-${type.artifactId}`;
  if (type.kind === 'readingList') return 'reading-list';
  if (type.kind === 'notesBrowser') return 'notes-browser';
  if (type.kind === 'intelligence') return 'intelligence';
  if (type.kind === 'query') return 'query';
  if (type.kind === 'agents') return 'agents';
  if (type.kind === 'artifactBrowser') return 'artifact-browser';
  return 'unknown';
}

let columnCounter = 0;
function nextColumnId(): string {
  return `col-${++columnCounter}`;
}

function findTabInColumns(columns: ContentColumn[], tabId: string): { colIdx: number; tabIdx: number } | null {
  for (let ci = 0; ci < columns.length; ci++) {
    const ti = columns[ci].tabs.findIndex(t => t.id === tabId);
    if (ti !== -1) return { colIdx: ci, tabIdx: ti };
  }
  return null;
}

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
  graphKey: number; // increment to force graph re-render
  chatOpen: boolean;
  chatDisplayMode: ChatDisplayMode;
  panelWidth: number;
  chatSidebarWidth: number;
  focusNodeCallback: ((nodeIds: string | string[]) => void) | null;
  settingsOpen: boolean;
  llmModalOpen: boolean;
  /**
   * Which of the three structural layers are visible in the main graph.
   * Default is entity-only — the "what do I know" view. Notes and
   * resources can be layered on top via the layer toggles.
   */
  visibleLayers: LayerVisibility;

  setDisplayMode: (mode: DisplayMode) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setSettingsOpen: (open: boolean) => void;
  setLLMModalOpen: (open: boolean) => void;
  forceActivePanel: (panel: ActivePanel) => void;
  setLayoutType: (layout: LayoutType) => void;
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

  leftPanel: LeftPanel;
  leftPanelWidth: number;
  vaultDrawerExpandedPaths: string[];
  setLeftPanel: (panel: LeftPanel) => void;
  setLeftPanelWidth: (width: number) => void;
  setVaultDrawerExpandedPaths: (paths: string[]) => void;

  contentColumns: ContentColumn[];
  activeColumnId: string;
  openContentTab: (type: ContentTabType, title: string) => void;
  closeContentTab: (id: string) => void;
  focusContentTab: (id: string) => void;
  setContentTabTitle: (id: string, title: string) => void;
  splitContentTab: (tabId: string) => void;
  moveTabToColumn: (tabId: string, targetColumnId: string) => void;
  reorderContentTabs: (fromColId: string, toColId: string, fromIndex: number, toIndex: number) => void;
  insertColumnAt: (tabId: string, columnIndex: number) => void;
  setColumnFlex: (columnId: string, flex: number) => void;

  graphOverlay: GraphOverlay;
  setGraphOverlay: (overlay: GraphOverlay) => void;
  agentViewMode: 'grid' | 'list';
  setAgentViewMode: (mode: 'grid' | 'list') => void;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  agentSubTab: 'agents' | 'connections' | 'mcp';
  setAgentSubTab: (tab: 'agents' | 'connections' | 'mcp') => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  pendingChatSessionId: string | null;
  chatSessionVersion: number;
  bumpChatSessionVersion: () => void;
  setPendingChatSessionId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  displayMode: 'sidePanel',
  activePanel: 'none',
  layoutType: 'forceDirected2d',
  graphKey: 0,
  chatOpen: false,
  chatDisplayMode: 'sidebar',
  panelWidth: 400,
  chatSidebarWidth: 400,
  focusNodeCallback: null,
  settingsOpen: false,
  llmModalOpen: false,
  visibleLayers: { entity: true, note: false, resource: false },
  pendingEditNoteId: null,

  leftPanel: (localStorage.getItem('vault-drawer-open') === 'true' ? 'explorer' : 'none') as LeftPanel,
  leftPanelWidth: JSON.parse(localStorage.getItem('vault-drawer-width') ?? '240'),
  vaultDrawerExpandedPaths: JSON.parse(localStorage.getItem('vault-drawer-expanded') ?? '[]'),

  setLeftPanel: (panel) => set((state) => {
    const next = state.leftPanel === panel ? 'none' : panel;
    localStorage.setItem('vault-drawer-open', JSON.stringify(next !== 'none'));
    localStorage.setItem('left-panel', next);
    return { leftPanel: next };
  }),
  setLeftPanelWidth: (width) => set(() => {
    const clamped = Math.min(400, Math.max(180, width));
    localStorage.setItem('vault-drawer-width', JSON.stringify(clamped));
    return { leftPanelWidth: clamped };
  }),
  setVaultDrawerExpandedPaths: (paths) => set(() => {
    localStorage.setItem('vault-drawer-expanded', JSON.stringify(paths));
    return { vaultDrawerExpandedPaths: paths };
  }),


  setDisplayMode: (mode) => set({ displayMode: mode }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setLLMModalOpen: (open) => set({ llmModalOpen: open }),
  setActivePanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? 'none' : panel,
    })),
  forceActivePanel: (panel) => set({ activePanel: panel }),
  setLayoutType: (layout) => set({ layoutType: layout }),
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

  graphOverlay: 'none' as GraphOverlay,
  setGraphOverlay: (overlay) => set({ graphOverlay: overlay }),
  agentViewMode: (localStorage.getItem('agent-view-mode') as 'grid' | 'list') || 'grid',
  setAgentViewMode: (mode) => set(() => { localStorage.setItem('agent-view-mode', mode); return { agentViewMode: mode }; }),
  selectedAgentId: null as string | null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  agentSubTab: 'agents' as const,
  setAgentSubTab: (tab) => set({ agentSubTab: tab }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  pendingChatSessionId: null as string | null,
  setPendingChatSessionId: (id) => set({ pendingChatSessionId: id }),
  chatSessionVersion: 0,
  bumpChatSessionVersion: () => set((s) => ({ chatSessionVersion: s.chatSessionVersion + 1 })),

  contentColumns: [{
    id: 'col-0',
    tabs: [{ id: 'graph', type: { kind: 'graph' } as ContentTabType, title: 'Graph' }],
    activeTabId: 'graph',
    flex: 1,
  }],
  activeColumnId: 'col-0',

  openContentTab: (type, title) => set((state) => {
    const id = contentTabId(type);
    const found = findTabInColumns(state.contentColumns, id);
    if (found) {
      const col = state.contentColumns[found.colIdx];
      return {
        activeColumnId: col.id,
        contentColumns: col.activeTabId === id && col.tabs[found.tabIdx].title === title
          ? state.contentColumns
          : state.contentColumns.map(c => c.id === col.id
            ? { ...c, activeTabId: id, tabs: c.tabs.map(t => t.id === id ? { ...t, title } : t) }
            : c),
      };
    }
    const activeCol = state.contentColumns.find(c => c.id === state.activeColumnId) ?? state.contentColumns[0];
    return {
      contentColumns: state.contentColumns.map(c => c.id === activeCol.id
        ? { ...c, tabs: [...c.tabs, { id, type, title }], activeTabId: id }
        : c),
    };
  }),

  closeContentTab: (id) => set((state) => {
    if (id === 'graph') return {};
    const found = findTabInColumns(state.contentColumns, id);
    if (!found) return {};
    const col = state.contentColumns[found.colIdx];
    const nextTabs = col.tabs.filter(t => t.id !== id);
    if (nextTabs.length === 0) {
      const nextCols = state.contentColumns.filter(c => c.id !== col.id);
      if (nextCols.length === 0) return {};
      return {
        contentColumns: nextCols,
        activeColumnId: state.activeColumnId === col.id
          ? nextCols[Math.max(0, found.colIdx - 1)].id
          : state.activeColumnId,
      };
    }
    let nextActive = col.activeTabId;
    if (col.activeTabId === id) {
      nextActive = found.tabIdx > 0 ? nextTabs[found.tabIdx - 1].id : nextTabs[0].id;
    }
    return {
      contentColumns: state.contentColumns.map(c => c.id === col.id
        ? { ...c, tabs: nextTabs, activeTabId: nextActive }
        : c),
    };
  }),

  focusContentTab: (id) => set((state) => {
    const found = findTabInColumns(state.contentColumns, id);
    if (!found) return {};
    const col = state.contentColumns[found.colIdx];
    return {
      activeColumnId: col.id,
      contentColumns: col.activeTabId === id
        ? state.contentColumns
        : state.contentColumns.map(c => c.id === col.id ? { ...c, activeTabId: id } : c),
    };
  }),

  setContentTabTitle: (id, title) => set((state) => ({
    contentColumns: state.contentColumns.map(c => ({
      ...c,
      tabs: c.tabs.map(t => t.id === id ? { ...t, title } : t),
    })),
  })),

  splitContentTab: (tabId) => set((state) => {
    const found = findTabInColumns(state.contentColumns, tabId);
    if (!found) return {};
    const srcCol = state.contentColumns[found.colIdx];
    if (srcCol.tabs.length <= 1) return {};
    const tab = srcCol.tabs[found.tabIdx];
    const remainingTabs = srcCol.tabs.filter(t => t.id !== tabId);
    const newColId = nextColumnId();
    const updatedCols = state.contentColumns.map(c => c.id === srcCol.id
      ? { ...c, tabs: remainingTabs, activeTabId: remainingTabs[Math.min(found.tabIdx, remainingTabs.length - 1)].id }
      : c);
    updatedCols.splice(found.colIdx + 1, 0, {
      id: newColId,
      tabs: [tab],
      activeTabId: tab.id,
      flex: 1,
    });
    return { contentColumns: updatedCols, activeColumnId: newColId };
  }),

  moveTabToColumn: (tabId, targetColumnId) => set((state) => {
    const found = findTabInColumns(state.contentColumns, tabId);
    if (!found) return {};
    const srcCol = state.contentColumns[found.colIdx];
    if (srcCol.id === targetColumnId) return {};
    const tab = srcCol.tabs[found.tabIdx];
    const remainingTabs = srcCol.tabs.filter(t => t.id !== tabId);
    let cols = state.contentColumns.map(c => {
      if (c.id === srcCol.id) {
        if (remainingTabs.length === 0) return null;
        return { ...c, tabs: remainingTabs, activeTabId: c.activeTabId === tabId ? remainingTabs[0].id : c.activeTabId };
      }
      if (c.id === targetColumnId) {
        return { ...c, tabs: [...c.tabs, tab], activeTabId: tab.id };
      }
      return c;
    }).filter(Boolean) as ContentColumn[];
    return {
      contentColumns: cols,
      activeColumnId: targetColumnId,
    };
  }),

  reorderContentTabs: (fromColId, toColId, fromIndex, toIndex) => set((state) => {
    if (fromColId === toColId) {
      return {
        contentColumns: state.contentColumns.map(c => {
          if (c.id !== fromColId) return c;
          const tabs = [...c.tabs];
          const [moved] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, moved);
          return { ...c, tabs };
        }),
      };
    }
    const srcCol = state.contentColumns.find(c => c.id === fromColId);
    const dstCol = state.contentColumns.find(c => c.id === toColId);
    if (!srcCol || !dstCol) return {};
    const srcTabs = [...srcCol.tabs];
    const [moved] = srcTabs.splice(fromIndex, 1);
    const dstTabs = [...dstCol.tabs];
    dstTabs.splice(toIndex, 0, moved);
    let cols = state.contentColumns.map(c => {
      if (c.id === fromColId) {
        if (srcTabs.length === 0) return null;
        return { ...c, tabs: srcTabs, activeTabId: c.activeTabId === moved.id ? srcTabs[0].id : c.activeTabId };
      }
      if (c.id === toColId) return { ...c, tabs: dstTabs, activeTabId: moved.id };
      return c;
    }).filter(Boolean) as ContentColumn[];
    return {
      contentColumns: cols,
      activeColumnId: toColId,
    };
  }),

  insertColumnAt: (tabId, columnIndex) => set((state) => {
    const found = findTabInColumns(state.contentColumns, tabId);
    if (!found) return {};
    const srcCol = state.contentColumns[found.colIdx];
    const tab = srcCol.tabs[found.tabIdx];
    const remainingTabs = srcCol.tabs.filter(t => t.id !== tabId);
    const newColId = nextColumnId();
    const newCol: ContentColumn = { id: newColId, tabs: [tab], activeTabId: tab.id, flex: 1 };
    let cols = state.contentColumns.map(c => {
      if (c.id !== srcCol.id) return c;
      if (remainingTabs.length === 0) return null;
      return { ...c, tabs: remainingTabs, activeTabId: c.activeTabId === tabId ? remainingTabs[0].id : c.activeTabId };
    }).filter(Boolean) as ContentColumn[];
    const insertIdx = Math.min(columnIndex, cols.length);
    cols.splice(insertIdx, 0, newCol);
    return { contentColumns: cols, activeColumnId: newColId };
  }),

  setColumnFlex: (columnId, flex) => set((state) => ({
    contentColumns: state.contentColumns.map(c =>
      c.id === columnId ? { ...c, flex: Math.max(0.2, flex) } : c
    ),
  })),

  toggleLayer: (layer) =>
    set((state) => {
      const next = { ...state.visibleLayers, [layer]: !state.visibleLayers[layer] };
      if (!next.entity && !next.note && !next.resource) next.entity = true;
      return { visibleLayers: next, graphKey: state.graphKey + 1 };
    }),
}));
