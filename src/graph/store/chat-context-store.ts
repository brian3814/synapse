import { create } from 'zustand';

export interface AttachedNode {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface ChatContextState {
  attachedNodes: AttachedNode[];
  addNodes: (nodes: AttachedNode[]) => void;
  removeNode: (nodeId: string) => void;
  clear: () => void;
}

export const useChatContextStore = create<ChatContextState>((set) => ({
  attachedNodes: [],
  addNodes: (nodes) =>
    set((state) => {
      const existingIds = new Set(state.attachedNodes.map((n) => n.id));
      const newNodes = nodes.filter((n) => !existingIds.has(n.id));
      if (newNodes.length === 0) return state;
      return { attachedNodes: [...state.attachedNodes, ...newNodes] };
    }),
  removeNode: (nodeId) =>
    set((state) => ({
      attachedNodes: state.attachedNodes.filter((n) => n.id !== nodeId),
    })),
  clear: () => set({ attachedNodes: [] }),
}));
