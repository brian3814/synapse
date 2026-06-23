import { ForceLayout } from './force-layout';
import type { LayoutRequest, LayoutResponse } from './layout-protocol';

let layout: ForceLayout | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;

function sendResponse(resp: LayoutResponse, transfer?: Transferable[]) {
  self.postMessage(resp, { transfer: transfer ?? [] });
}

function runTicks() {
  if (!layout) return;

  const result = layout.tick(10);

  if (result.done) {
    sendResponse(
      { type: 'done', positions: result.positions },
      [result.positions.buffer]
    );
    layout = null;
    tickTimer = null;
  } else {
    sendResponse(
      { type: 'tick', positions: result.positions, alpha: result.alpha },
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

      layout = new ForceLayout(msg.nodes, msg.edges, msg.options);
      tickTimer = setTimeout(runTicks, 0);
      break;
    }

    case 'pin': {
      layout?.pin(msg.nodeId, msg.x, msg.y);
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
