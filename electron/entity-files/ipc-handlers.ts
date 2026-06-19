import { ipcMain } from 'electron';
import type { EntityFileService } from './entity-file-service';

export function registerEntityFileIpc(getService: () => EntityFileService | null): void {
  ipcMain.handle('entity-files:generate-all', async () => {
    const service = getService();
    if (!service) return { generated: 0 };
    return service.generateAll();
  });

  ipcMain.handle('entity-files:list-sync-issues', async () => {
    const service = getService();
    if (!service) return [];
    return service.listSyncIssues();
  });

  ipcMain.handle('entity-files:dismiss-sync-issue', async (_e, notificationId: string) => {
    const service = getService();
    if (!service) return;
    return service.dismissSyncIssue(notificationId);
  });

  ipcMain.handle('entity-files:resolve-notification', async (_e, notificationId: string, action: string) => {
    const service = getService();
    if (!service) return;
    return service.resolveNotification(notificationId, action);
  });

  ipcMain.handle('entity-files:read', async (_e, nodeId: string) => {
    const service = getService();
    if (!service) return null;
    return service.readEntityFile(nodeId);
  });

  ipcMain.handle('entity-files:append', async (_e, nodeId: string, text: string, expectedHash?: string) => {
    const service = getService();
    if (!service) throw new Error('EntityFileService not initialized');
    return service.appendEntityFile(nodeId, text, expectedHash);
  });

  ipcMain.handle('entity-files:patch', async (_e, nodeId: string, patch: { old_text: string; new_text: string }, expectedHash?: string) => {
    const service = getService();
    if (!service) throw new Error('EntityFileService not initialized');
    return service.patchEntityFile(nodeId, patch, expectedHash);
  });
}

export function unregisterEntityFileIpc(): void {
  ipcMain.removeHandler('entity-files:generate-all');
  ipcMain.removeHandler('entity-files:list-sync-issues');
  ipcMain.removeHandler('entity-files:dismiss-sync-issue');
  ipcMain.removeHandler('entity-files:resolve-notification');
  ipcMain.removeHandler('entity-files:read');
  ipcMain.removeHandler('entity-files:append');
  ipcMain.removeHandler('entity-files:patch');
}
