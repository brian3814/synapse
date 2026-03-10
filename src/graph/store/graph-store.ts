import { create } from 'zustand';
import { nodes as dbNodes, edges as dbEdges, clearAll as dbClearAll, loadGraph } from '../../db/client/db-client';
import type { GraphNode, GraphEdge, CreateNodeInput, UpdateNodeInput, CreateEdgeInput, UpdateEdgeInput, DbNode, DbEdge, DbNodeSlim, DbEdgeSlim } from '../../shared/types';
import { SYNC_CHANNEL, type SyncEvent } from '../../shared/sync-events';
import { buildAdjacencyMap, type AdjacencyMap } from '../algorithms/adjacency';

function dbNodeToGraphNode(row: DbNode): GraphNode {
  return {
    id: row.id,
    identifier: row.identifier,
    label: row.label,
    type: row.type,
    properties: JSON.parse(row.properties || '{}'),
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    z: row.z ?? undefined,
    color: row.color ?? undefined,
    size: row.size,
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dbEdgeToGraphEdge(row: DbEdge): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    type: row.type,
    properties: JSON.parse(row.properties || '{}'),
    weight: row.weight,
    directed: row.directed === 1,
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fast transform for bulk load — slim rows have no properties/timestamps */
function slimNodeToGraphNode(row: DbNodeSlim): GraphNode {
  return {
    id: row.id,
    identifier: row.identifier,
    label: row.label,
    type: row.type,
    properties: {},
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    color: row.color ?? undefined,
    size: row.size,
    sourceUrl: row.source_url ?? undefined,
    createdAt: '',
    updatedAt: '',
  };
}

function slimEdgeToGraphEdge(row: DbEdgeSlim): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    type: row.type,
    properties: {},
    weight: row.weight,
    directed: row.directed === 1,
    createdAt: '',
    updatedAt: '',
  };
}

interface GraphStore {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adjacency: AdjacencyMap;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  loadAll: () => Promise<void>;
  createNode: (input: CreateNodeInput) => Promise<GraphNode | null>;
  updateNode: (input: UpdateNodeInput) => Promise<GraphNode | null>;
  deleteNode: (id: string) => Promise<boolean>;
  createEdge: (input: CreateEdgeInput) => Promise<GraphEdge | null>;
  updateEdge: (input: UpdateEdgeInput) => Promise<GraphEdge | null>;
  deleteEdge: (id: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  clearSelection: () => void;
  startSyncListener: () => () => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  adjacency: new Map(),
  selectedNodeId: null,
  selectedEdgeId: null,
  loading: false,
  error: null,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const { nodes: nodeRows, edges: edgeRows } = await loadGraph();
      const edges = edgeRows.map(slimEdgeToGraphEdge);
      set({
        nodes: nodeRows.map(slimNodeToGraphNode),
        edges,
        adjacency: buildAdjacencyMap(edges),
        loading: false,
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  createNode: async (input) => {
    try {
      const row = await dbNodes.create({
        label: input.label,
        type: input.type,
        properties: JSON.stringify(input.properties ?? {}),
        color: input.color,
        size: input.size,
        sourceUrl: input.sourceUrl,
      });
      if (!row) return null;
      const node = dbNodeToGraphNode(row);
      set((state) => ({ nodes: [...state.nodes, node] }));
      return node;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },

  updateNode: async (input) => {
    try {
      const row = await dbNodes.update({
        id: input.id,
        label: input.label,
        type: input.type,
        properties: input.properties ? JSON.stringify(input.properties) : undefined,
        x: input.x,
        y: input.y,
        z: input.z,
        color: input.color,
        size: input.size,
      });
      if (!row) return null;
      const node = dbNodeToGraphNode(row);
      set((state) => ({
        nodes: state.nodes.map((n) => (n.id === node.id ? node : n)),
      }));
      return node;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },

  deleteNode: async (id) => {
    try {
      const success = await dbNodes.delete(id);
      if (success) {
        set((state) => {
          const edges = state.edges.filter(
            (e) => e.sourceId !== id && e.targetId !== id
          );
          return {
            nodes: state.nodes.filter((n) => n.id !== id),
            edges,
            adjacency: buildAdjacencyMap(edges),
            selectedNodeId:
              state.selectedNodeId === id ? null : state.selectedNodeId,
          };
        });
      }
      return success;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  createEdge: async (input) => {
    try {
      const row = await dbEdges.create({
        sourceId: input.sourceId,
        targetId: input.targetId,
        label: input.label,
        type: input.type,
        properties: JSON.stringify(input.properties ?? {}),
        weight: input.weight,
        directed: input.directed,
        sourceUrl: input.sourceUrl,
      });
      if (!row) return null;
      const edge = dbEdgeToGraphEdge(row);
      set((state) => {
        const edges = [...state.edges, edge];
        return { edges, adjacency: buildAdjacencyMap(edges) };
      });
      return edge;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },

  updateEdge: async (input) => {
    try {
      const row = await dbEdges.update({
        id: input.id,
        label: input.label,
        type: input.type,
        properties: input.properties ? JSON.stringify(input.properties) : undefined,
        weight: input.weight,
      });
      if (!row) return null;
      const edge = dbEdgeToGraphEdge(row);
      set((state) => {
        const edges = state.edges.map((e) => (e.id === edge.id ? edge : e));
        return { edges, adjacency: buildAdjacencyMap(edges) };
      });
      return edge;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },

  deleteEdge: async (id) => {
    try {
      const success = await dbEdges.delete(id);
      if (success) {
        set((state) => {
          const edges = state.edges.filter((e) => e.id !== id);
          return {
            edges,
            adjacency: buildAdjacencyMap(edges),
            selectedEdgeId:
              state.selectedEdgeId === id ? null : state.selectedEdgeId,
          };
        });
      }
      return success;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  clearAll: async () => {
    try {
      await dbClearAll();
      set({
        nodes: [],
        edges: [],
        adjacency: new Map(),
        selectedNodeId: null,
        selectedEdgeId: null,
      });
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
  clearSelection: () => set({ selectedNodeId: null, selectedEdgeId: null }),

  startSyncListener: () => {
    const channel = new BroadcastChannel(SYNC_CHANNEL);

    channel.onmessage = (event: MessageEvent<SyncEvent>) => {
      const syncEvent = event.data;

      switch (syncEvent.type) {
        case 'node_created': {
          const node = dbNodeToGraphNode(syncEvent.node);
          set((state) => {
            // Idempotent: skip if already present
            if (state.nodes.some((n) => n.id === node.id)) return state;
            return { nodes: [...state.nodes, node] };
          });
          break;
        }

        case 'node_updated': {
          const node = dbNodeToGraphNode(syncEvent.node);
          set((state) => ({
            nodes: state.nodes.map((n) => (n.id === node.id ? node : n)),
          }));
          break;
        }

        case 'node_deleted': {
          const { id } = syncEvent;
          set((state) => {
            const edges = state.edges.filter(
              (e) => e.sourceId !== id && e.targetId !== id
            );
            return {
              nodes: state.nodes.filter((n) => n.id !== id),
              edges,
              adjacency: buildAdjacencyMap(edges),
              selectedNodeId:
                state.selectedNodeId === id ? null : state.selectedNodeId,
            };
          });
          break;
        }

        case 'edge_created': {
          const edge = dbEdgeToGraphEdge(syncEvent.edge);
          set((state) => {
            if (state.edges.some((e) => e.id === edge.id)) return state;
            const edges = [...state.edges, edge];
            return { edges, adjacency: buildAdjacencyMap(edges) };
          });
          break;
        }

        case 'edge_updated': {
          const edge = dbEdgeToGraphEdge(syncEvent.edge);
          set((state) => {
            const edges = state.edges.map((e) => (e.id === edge.id ? edge : e));
            return { edges, adjacency: buildAdjacencyMap(edges) };
          });
          break;
        }

        case 'edge_deleted': {
          const { id } = syncEvent;
          set((state) => {
            const edges = state.edges.filter((e) => e.id !== id);
            return {
              edges,
              adjacency: buildAdjacencyMap(edges),
              selectedEdgeId:
                state.selectedEdgeId === id ? null : state.selectedEdgeId,
            };
          });
          break;
        }

        case 'reset': {
          // Full reload on reset
          get().loadAll();
          break;
        }

        // node_type_created and node_type_deleted are handled by node-type-store
      }
    };

    return () => {
      channel.close();
    };
  },
}));
