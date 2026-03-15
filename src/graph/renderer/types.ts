export interface RenderNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string; // hex
  size: number;
  data?: Record<string, unknown>;
}

export interface RenderEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  color?: string; // hex, defaults to theme edge color
  directed: boolean;
  data?: Record<string, unknown>;
}

export interface RenderTheme {
  canvasBackground: string;
  nodeColor: string;
  nodeActiveColor: string;
  nodeInactiveOpacity: number;
  edgeColor: string;
  edgeActiveColor: string;
  edgeInactiveOpacity: number;
  selectionRingColor: string;
  labelColor: string;
  labelActiveColor: string;
}

export interface GraphRendererOptions {
  theme?: Partial<RenderTheme>;
  antialias?: boolean;
}

export interface GraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fitToView(nodeIds?: string[]): void;
  getRenderer(): GraphRendererInstance | null;
}

export interface GraphRendererInstance {
  setGraphData(nodes: RenderNode[], edges: RenderEdge[]): void;
  addNodes(nodes: RenderNode[]): void;
  removeNodes(ids: string[]): void;
  addEdges(edges: RenderEdge[]): void;
  removeEdges(ids: string[]): void;
  setZoomLevel(level: ZoomLevel): void;
  setSelection(nodeId: string | null, edgeId: string | null): void;
  setHover(nodeId: string | null): void;
  fitToView(nodeIds?: string[]): void;
  zoomIn(): void;
  zoomOut(): void;
  resize(): void;
  dispose(): void;
}

export interface FrustumBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type ZoomLevel = 'far' | 'medium' | 'close';

export type GraphEventType = 'nodeClick' | 'edgeClick' | 'canvasClick' | 'nodeHover' | 'nodeDragEnd';

export interface GraphEventMap {
  nodeClick: { nodeId: string };
  edgeClick: { edgeId: string };
  canvasClick: {};
  nodeHover: { nodeId: string | null };
  nodeDragEnd: { nodeId: string; x: number; y: number };
}
