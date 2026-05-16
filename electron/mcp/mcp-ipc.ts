import { ipcMain, BrowserWindow } from 'electron';
import type { IToolRegistry } from './types';
import type { ToolFilter } from './types';

export function registerToolIpcHandlers(getRegistry: () => IToolRegistry | null): void {
  ipcMain.handle('tools:list', async (_event, filter?: ToolFilter) => {
    const registry = getRegistry();
    if (!registry) return [];
    return registry.getAvailableTools(filter);
  });

  ipcMain.handle('tools:execute', async (_event, payload: { name: string; input: Record<string, unknown> }) => {
    const registry = getRegistry();
    if (!registry) {
      return { result: JSON.stringify({ error: 'Tool registry not initialized' }), isError: true };
    }
    return registry.executeTool(payload.name, payload.input);
  });
}

export function registerMcpClientIpcHandlers(getManager: () => any | null): void {
  ipcMain.handle('mcp:list-servers', async () => {
    const manager = getManager();
    if (!manager) return [];
    return manager.getStatus();
  });

  ipcMain.handle('mcp:connect-server', async (_event, _name: string) => {
    const manager = getManager();
    if (!manager) return { error: 'MCP not initialized' };
    return { success: true };
  });

  ipcMain.handle('mcp:disconnect-server', async (_event, name: string) => {
    const manager = getManager();
    if (!manager) return;
    await manager.disconnectServer(name);
  });
}

export function broadcastToolsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tools:on-changed');
  }
}
