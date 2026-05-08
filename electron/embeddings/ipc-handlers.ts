import { ipcMain, BrowserWindow, app } from 'electron';
import type { EmbeddingService } from './embedding-service';
import type { EmbeddingConfig } from '../../src/embeddings/types';

function debugLog(...args: unknown[]) {
  if (!app.isPackaged) console.log('[embedding:ipc]', ...args);
}

export function registerEmbeddingHandlers(getService: () => EmbeddingService | null): void {
  ipcMain.handle('embedding:is-available', () => {
    const available = getService() !== null;
    debugLog('is-available →', available);
    return available;
  });

  ipcMain.handle('embedding:get-status', () => {
    const service = getService();
    if (!service) return { enabled: false, providerId: null, totalNodes: 0, embeddedNodes: 0, processing: false };
    return service.getStatus();
  });

  ipcMain.handle('embedding:configure', async (_event, config: Partial<EmbeddingConfig>) => {
    debugLog('configure', config);
    const service = getService();
    if (!service) throw new Error('Embedding service not available');
    await service.configure(config);
  });

  ipcMain.handle('embedding:search-similar', async (_event, query: string, topK: number) => {
    const service = getService();
    if (!service) return [];
    try {
      return await service.searchSimilar(query, topK);
    } catch (e) {
      console.error('[embedding:search-similar] Error:', e);
      return [];
    }
  });

  ipcMain.handle('embedding:search-similar-by-node', async (_event, nodeId: string, topK: number) => {
    const service = getService();
    if (!service) return [];
    try {
      return await service.searchSimilarByNodeId(nodeId, topK);
    } catch (e) {
      console.error('[embedding:search-similar-by-node] Error:', e);
      return [];
    }
  });
}

export function setupProgressBroadcast(service: EmbeddingService): () => void {
  return service.onProgress((progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('embedding:progress', progress);
    }
  });
}
