export interface LayoutNodeInput {
  id: string;
  x: number;
  y: number;
}

export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export interface LayoutOptions {
  iterations?: number;
  alphaDecay?: number;
  repulsionStrength?: number;
  attractionStrength?: number;
  centerStrength?: number;
}

export type LayoutRequest =
  | {
      type: 'start';
      nodes: LayoutNodeInput[];
      edges: LayoutEdgeInput[];
      options?: LayoutOptions;
    }
  | { type: 'pin'; nodeId: string; x: number; y: number }
  | { type: 'unpin'; nodeId: string }
  | { type: 'stop' };

export type LayoutResponse =
  | { type: 'tick'; positions: Float32Array; alpha: number }
  | { type: 'done'; positions: Float32Array };
