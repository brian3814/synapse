import { BrowserWindow } from 'electron';
import type { VaultEventBus } from '../event-bus';

export class SyncBroadcastHandler {
  private unsubscribers: (() => void)[] = [];

  register(eventBus: VaultEventBus): void {
    const nodeTypes = ['node:created', 'node:updated', 'node:deleted'] as const;
    const edgeTypes = ['edge:created', 'edge:deleted'] as const;

    for (const type of nodeTypes) {
      this.unsubscribers.push(
        eventBus.on(type, (event) => {
          this.broadcast('vault:sync', event);
        }),
      );
    }

    for (const type of edgeTypes) {
      this.unsubscribers.push(
        eventBus.on(type, (event) => {
          this.broadcast('vault:sync', event);
        }),
      );
    }
  }

  unregister(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  private broadcast(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data);
    }
  }
}
