import type { LayoutRequest, LayoutResponse, LayoutNodeInput, LayoutEdgeInput, LayoutOptions } from './layout-protocol';

export class LayoutRunner {
  private worker: Worker | null = null;
  private onTick?: (positions: Float32Array, alpha: number, dimensions: number) => void;
  private onDone?: (positions: Float32Array, dimensions: number) => void;

  constructor() {}

  start(
    nodes: LayoutNodeInput[],
    edges: LayoutEdgeInput[],
    callbacks: {
      onTick: (positions: Float32Array, alpha: number, dimensions: number) => void;
      onDone: (positions: Float32Array, dimensions: number) => void;
    },
    options?: LayoutOptions
  ) {
    this.onTick = callbacks.onTick;
    this.onDone = callbacks.onDone;

    // Create worker if not exists
    if (!this.worker) {
      const workerUrl = new URL('/layout-worker.js', location.origin);
      this.worker = new Worker(workerUrl, { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
        this.handleMessage(e.data);
      };
    }

    const msg: LayoutRequest = {
      type: 'start',
      nodes,
      edges,
      options,
    };
    this.worker.postMessage(msg);
  }

  pin(nodeId: string, x: number, y: number) {
    this.worker?.postMessage({ type: 'pin', nodeId, x, y } satisfies LayoutRequest);
  }

  unpin(nodeId: string) {
    this.worker?.postMessage({ type: 'unpin', nodeId } satisfies LayoutRequest);
  }

  stop() {
    this.worker?.postMessage({ type: 'stop' } satisfies LayoutRequest);
  }

  private handleMessage(msg: LayoutResponse) {
    switch (msg.type) {
      case 'tick':
        this.onTick?.(msg.positions, msg.alpha, msg.dimensions);
        break;
      case 'done':
        this.onDone?.(msg.positions, msg.dimensions);
        break;
    }
  }

  dispose() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
