import { ForceLayout } from './force-layout';
import { ForceLayout3D } from './force-layout-3d';
import type { LayoutRequest, LayoutResponse } from './layout-protocol';

let layout: ForceLayout | ForceLayout3D | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let currentDimensions = 2;

function sendResponse(resp: LayoutResponse, transfer?: Transferable[]) {
  self.postMessage(resp, { transfer: transfer ?? [] });
}

function runTicks() {
  if (!layout) return;

  const result = layout.tick(10);

  if (result.done) {
    sendResponse(
      { type: 'done', positions: result.positions, dimensions: currentDimensions },
      [result.positions.buffer]
    );
    layout = null;
    tickTimer = null;
  } else {
    sendResponse(
      { type: 'tick', positions: result.positions, alpha: result.alpha, dimensions: currentDimensions },
      [result.positions.buffer]
    );
    // Schedule next batch
    tickTimer = setTimeout(runTicks, 0);
  }
}

self.addEventListener('message', (e: MessageEvent<LayoutRequest>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'start': {
      // Stop any running layout
      if (layout) layout.stop();
      if (tickTimer) clearTimeout(tickTimer);

      currentDimensions = msg.options?.dimensions ?? 2;
      if (currentDimensions === 3) {
        layout = new ForceLayout3D(msg.nodes, msg.edges, msg.options);
      } else {
        layout = new ForceLayout(msg.nodes, msg.edges, msg.options);
      }
      tickTimer = setTimeout(runTicks, 0);
      break;
    }

    case 'pin': {
      if (layout instanceof ForceLayout3D) {
        layout.pin(msg.nodeId, msg.x, msg.y, msg.z);
      } else {
        layout?.pin(msg.nodeId, msg.x, msg.y);
      }
      break;
    }

    case 'unpin': {
      layout?.unpin(msg.nodeId);
      break;
    }

    case 'stop': {
      if (layout) layout.stop();
      if (tickTimer) clearTimeout(tickTimer);
      layout = null;
      tickTimer = null;
      break;
    }
  }
});
