import { ipcMain, BrowserWindow } from 'electron';
import type { EmbeddingService } from './embedding-service';
import type { EmbeddingConfig } from '../../src/embeddings/types';

export function registerEmbeddingHandlers(getService: () => EmbeddingService | null): void {
  ipcMain.handle('embedding:is-available', () => {
    return getService() !== null;
  });

  ipcMain.handle('embedding:get-status', () => {
    const service = getService();
    if (!service) return { enabled: false, providerId: null, totalNodes: 0, embeddedNodes: 0, processing: false };
    return service.getStatus();
  });

  ipcMain.handle('embedding:configure', async (_event, config: Partial<EmbeddingConfig>) => {
    const service = getService();
    if (!service) throw new Error('Embedding service not available');
    await service.configure(config);
  });

  ipcMain.handle('embedding:search-similar', async (_event, query: string, topK: number) => {
    const service = getService();
    if (!service) return [];
    return service.searchSimilar(query, topK);
  });

  ipcMain.handle('embedding:search-similar-by-node', async (_event, nodeId: string, topK: number) => {
    const service = getService();
    if (!service) return [];
    return service.searchSimilarByNodeId(nodeId, topK);
  });

  ipcMain.handle('embedding:find-duplicate-pairs', (_event, threshold?: number, limit?: number) => {
    const service = getService();
    if (!service) return [];
    return service.findDuplicatePairs(threshold, limit);
  });

  ipcMain.handle('embedding:dismiss-pair', (_event, nodeIdA: string, nodeIdB: string) => {
    const service = getService();
    if (!service) return;
    service.dismissPair(nodeIdA, nodeIdB);
  });
}

export function setupProgressBroadcast(service: EmbeddingService): () => void {
  return service.onProgress((progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('embedding:progress', progress);
    }
  });
}
