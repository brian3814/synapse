import { create } from 'zustand';
import type { FrustumBounds, ZoomLevel, RenderNode, RenderEdge } from '../renderer/types';
import {
  ZOOM_THRESHOLD_FAR,
  ZOOM_THRESHOLD_CLOSE,
  SMALL_GRAPH_THRESHOLD,
} from '../../shared/constants';

function zoomToLevel(zoom: number): ZoomLevel {
  if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
  if (zoom >= ZOOM_THRESHOLD_CLOSE) return 'close';
  return 'medium';
}

interface ViewportState {
  zoomLevel: ZoomLevel;
  frustumBounds: FrustumBounds | null;
  rawZoom: number;
  visibleNodes: RenderNode[];
  visibleEdges: RenderEdge[];
  clusterNodes: RenderNode[];
  clusterEdges: RenderEdge[];
  totalNodeCount: number;
  windowed: boolean;
  queryInFlight: boolean;
}

interface ViewportActions {
  setFrustumBounds: (bounds: FrustumBounds, zoom: number) => void;
  setTotalNodeCount: (count: number) => void;
  invalidateClusterCache: () => void;
  _setVisibleData: (nodes: RenderNode[], edges: RenderEdge[]) => void;
  _setClusterData: (nodes: RenderNode[], edges: RenderEdge[]) => void;
  _setQueryInFlight: (inFlight: boolean) => void;
}

export const useViewportStore = create<ViewportState & ViewportActions>((set) => ({
  zoomLevel: 'medium',
  frustumBounds: null,
  rawZoom: 1,
  visibleNodes: [],
  visibleEdges: [],
  clusterNodes: [],
  clusterEdges: [],
  totalNodeCount: 0,
  windowed: false,
  queryInFlight: false,

  setFrustumBounds: (bounds, zoom) =>
    set({
      frustumBounds: bounds,
      rawZoom: zoom,
      zoomLevel: zoomToLevel(zoom),
    }),

  setTotalNodeCount: (count) =>
    set({
      totalNodeCount: count,
      windowed: count > SMALL_GRAPH_THRESHOLD,
    }),

  invalidateClusterCache: () =>
    set({ clusterNodes: [], clusterEdges: [] }),

  _setVisibleData: (nodes, edges) =>
    set({ visibleNodes: nodes, visibleEdges: edges }),

  _setClusterData: (nodes, edges) =>
    set({ clusterNodes: nodes, clusterEdges: edges }),

  _setQueryInFlight: (inFlight) =>
    set({ queryInFlight: inFlight }),
}));
