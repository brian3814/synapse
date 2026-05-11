import { app, BrowserWindow, dialog, protocol, net, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { StorageBackend } from './storage-backend';
import { handleAction as dbHandleAction } from './db-backend';
import * as notesBackend from './notes-backend';
import * as filesBackend from './files-backend';
import { handleRuntimeMessage, setStorage as setLLMStorage, handleStreamExtraction, handleRunAgent, handleStreamChat } from './llm-backend';
import { startCompanionServer } from './companion-server';
import { getDb } from './better-sqlite3-engine';
import { EmbeddingService } from './embeddings/embedding-service';
import { registerEmbeddingHandlers, setupProgressBroadcast } from './embeddings/ipc-handlers';
import { readNote } from './notes-backend';
import { VaultManager } from './vault/vault-manager';
import { scaffoldVault } from './vault/vault-context';
import { NoteFileHandler } from './vault/handlers/note-file-handler';
import { SyncBroadcastHandler } from './vault/handlers/sync-broadcast-handler';
import { ResourceDetectionHandler } from './vault/handlers/resource-detection-handler';
import { VaultFileWatcher } from './vault/file-watcher';
import { reconcileVault } from './vault/reconciliation';

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

// Register custom protocol before app is ready.
// "standard" gives it a proper origin for SharedWorker same-origin checks.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // SharedWorker needs this off in Electron
    },
  });

  win.loadURL('app://kg/index.html');

  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }

  return win;
}

app.whenReady().then(() => {
  // Serve renderer files from dist-electron/renderer/ via app:// protocol
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(RENDERER_DIR, url.pathname);

    // Default to index.html for root
    if (url.pathname === '/' || url.pathname === '') {
      filePath = path.join(RENDERER_DIR, 'index.html');
    }

    return net.fetch('file://' + filePath);
  });

  const storage = new StorageBackend();
  setLLMStorage(storage);
  notesBackend.setStorage(storage);

  let embeddingService: EmbeddingService | null = null;

  registerEmbeddingHandlers(() => embeddingService);

  ipcMain.handle('storage:get', (_event, keys) => {
    return storage.get(keys);
  });

  ipcMain.handle('storage:set', (_event, items) => {
    const changes = storage.set(items);
    if (Object.keys(changes).length > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('storage:changed', changes, 'local');
      }
    }
  });

  ipcMain.handle('storage:remove', (_event, keys) => {
    const changes = storage.remove(keys);
    if (Object.keys(changes).length > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('storage:changed', changes, 'local');
      }
    }
  });

  let embeddingInitStarted = false;

  ipcMain.handle('db:request', async (_event, action: string, params: unknown) => {
    // Pre-lookup vault_path before deletion (node is gone after action)
    let deletedFilePath: string | undefined;
    if (action === 'nodes.delete' && vaultManager.getContext()) {
      try {
        const row = getDb().prepare(
          'SELECT vault_path FROM nodes WHERE id = ?'
        ).get(params as string) as { vault_path: string | null } | undefined;
        deletedFilePath = row?.vault_path ?? undefined;
      } catch { /* DB may not be ready */ }
    }

    const outcome = await dbHandleAction(action, params);
    if (outcome.syncEvent) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('db:sync', outcome.syncEvent);
      }
    }

    // Initialize embedding service after first successful DB init
    if (action === 'init' && !embeddingInitStarted) {
      embeddingInitStarted = true;
      try {
        const db = getDb();
        embeddingService = new EmbeddingService(db, readNote);
        const storedConfig = storage.get('embeddingConfig');
        await embeddingService.initialize(storedConfig?.embeddingConfig ?? undefined);
        setupProgressBroadcast(embeddingService);
        console.log('[main] Embedding service initialized');
      } catch (e) {
        console.error('[main] Failed to init embedding service:', e);
      }
    }

    // Notify embedding service of node mutations
    if (outcome.syncEvent && embeddingService) {
      const eventType = (outcome.syncEvent as any).type;
      if (eventType === 'node_created' || eventType === 'node_updated') {
        const nodeId = (outcome.syncEvent as any).node?.id;
        if (nodeId) embeddingService.handleNodeMutation(nodeId).catch(() => {});
      } else if (eventType === 'node_deleted') {
        const nodeId = (outcome.syncEvent as any).id;
        if (nodeId) embeddingService.handleNodeDeleted(nodeId);
      }
    }

    // Emit vault events for handlers (NoteFileHandler, etc.)
    const ctx = vaultManager.getContext();
    if (outcome.syncEvent && ctx) {
      const syncType = (outcome.syncEvent as any).type;
      if (syncType === 'node_created') {
        ctx.eventBus.emit({ type: 'node:created', node: (outcome.syncEvent as any).node });
      } else if (syncType === 'node_updated') {
        ctx.eventBus.emit({
          type: 'node:updated',
          node: (outcome.syncEvent as any).node,
          changes: ['name', 'properties', 'label', 'summary'],
        });
      } else if (syncType === 'node_deleted') {
        ctx.eventBus.emit({
          type: 'node:deleted',
          nodeId: (outcome.syncEvent as any).id,
          filePath: deletedFilePath,
        });
      } else if (syncType === 'edge_created') {
        ctx.eventBus.emit({ type: 'edge:created', edge: (outcome.syncEvent as any).edge });
      } else if (syncType === 'edge_deleted') {
        ctx.eventBus.emit({ type: 'edge:deleted', edgeId: (outcome.syncEvent as any).id });
      }
    }

    return { success: true, data: outcome.result };
  });

  ipcMain.handle('notes:init', () => {
    notesBackend.initNotesDir();
  });

  ipcMain.handle('notes:read', (_event, nodeId: string) => {
    return notesBackend.readNote(nodeId);
  });

  ipcMain.handle('notes:write', (_event, nodeId: string, markdown: string) => {
    notesBackend.writeNote(nodeId, markdown);
  });

  ipcMain.handle('notes:remove', (_event, nodeId: string) => {
    notesBackend.removeNote(nodeId);
  });

  ipcMain.handle('notes:list', () => {
    return notesBackend.listNotes();
  });

  ipcMain.handle('notes:exists', (_event, nodeId: string) => {
    return notesBackend.noteExists(nodeId);
  });

  ipcMain.handle('notes:getPath', () => {
    return notesBackend.getNotesPath();
  });

  ipcMain.handle('notes:pickFolder', async () => {
    return notesBackend.pickNotesFolder();
  });

  ipcMain.handle('notes:move', (_event, newPath: string) => {
    return notesBackend.moveNotes(newPath);
  });

  // Vault handlers — binary file storage at ~/Documents/KnowledgeGraph/vault/
  function getVaultDir(): string {
    return path.join(app.getPath('documents'), 'KnowledgeGraph', 'vault');
  }

  ipcMain.handle('vault:init', () => {
    fs.mkdirSync(getVaultDir(), { recursive: true });
  });

  ipcMain.handle('vault:store', (_event, dataArr: number[], filename: string, nodeId: string) => {
    const nodeDir = path.join(getVaultDir(), nodeId);
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(path.join(nodeDir, filename), Buffer.from(dataArr));
    return { vaultPath: `vault/${nodeId}/${filename}` };
  });

  ipcMain.handle('vault:read', (_event, vaultPath: string) => {
    const fullPath = path.join(getVaultDir(), vaultPath.replace(/^vault\//, ''));
    return Array.from(fs.readFileSync(fullPath));
  });

  ipcMain.handle('vault:remove', (_event, vaultPath: string) => {
    const fullPath = path.join(getVaultDir(), vaultPath.replace(/^vault\//, ''));
    try { fs.unlinkSync(fullPath); } catch { /* not found */ }
    try {
      const dir = path.dirname(fullPath);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch { /* non-empty or not found */ }
  });

  ipcMain.handle('vault:usage', () => {
    const vaultDir = getVaultDir();
    let bytes = 0, fileCount = 0;
    try {
      for (const nodeId of fs.readdirSync(vaultDir)) {
        const nodeDir = path.join(vaultDir, nodeId);
        if (!fs.statSync(nodeDir).isDirectory()) continue;
        for (const file of fs.readdirSync(nodeDir)) {
          const stat = fs.statSync(path.join(nodeDir, file));
          if (stat.isFile()) { bytes += stat.size; fileCount++; }
        }
      }
    } catch { /* vault dir may not exist */ }
    return { bytes, fileCount };
  });

  ipcMain.handle('files:read', (_event, filePath: string) => {
    return filesBackend.readFile(filePath);
  });
  ipcMain.handle('files:write', (_event, filePath: string, content: string) => {
    filesBackend.writeFile(filePath, content);
  });
  ipcMain.handle('files:remove', (_event, filePath: string) => {
    filesBackend.removeFile(filePath);
  });
  ipcMain.handle('files:list', (_event, prefix: string) => {
    return filesBackend.listFiles(prefix);
  });

  ipcMain.handle('runtime:sendMessage', async (_event, message) => {
    const result = await handleRuntimeMessage(message, (broadcastMsg) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('runtime:broadcast', broadcastMsg);
      }
    });
    return result;
  });

  // Dedicated LLM IPC handlers — send directly to requesting renderer
  ipcMain.handle('llm:stream-extraction', async (event, payload) => {
    handleStreamExtraction(payload, (channel, ...args) => event.sender.send(channel, ...args));
  });

  ipcMain.handle('llm:run-agent', async (event, payload) => {
    handleRunAgent(payload, (channel, ...args) => event.sender.send(channel, ...args));
  });

  ipcMain.handle('llm:stream-chat', async (event, payload) => {
    handleStreamChat(payload, (channel, ...args) => event.sender.send(channel, ...args));
  });

  startCompanionServer();

  // ── Vault Workspace Management ──────────────────────────────────────
  const vaultManager = new VaultManager(storage);

  // Auto-open vault from --vault CLI arg (used by relaunch for multi-vault)
  const vaultArgIdx = process.argv.indexOf('--vault');
  if (vaultArgIdx !== -1 && process.argv[vaultArgIdx + 1]) {
    const vaultPath = process.argv[vaultArgIdx + 1];
    vaultManager.open(vaultPath)
      .then(() => registerVaultHandlers())
      .catch((e) => console.error('[Vault] Failed to auto-open from --vault arg:', e));
  }
  let noteFileHandler: NoteFileHandler | null = null;
  let syncBroadcastHandler: SyncBroadcastHandler | null = null;
  let resourceDetectionHandler: ResourceDetectionHandler | null = null;
  let fileWatcher: VaultFileWatcher | null = null;

  function registerVaultHandlers() {
    const ctx = vaultManager.getContext();
    if (!ctx) return;

    // Run reconciliation to catch offline changes
    reconcileVault(ctx);

    // Register event handlers
    noteFileHandler = new NoteFileHandler(ctx);
    noteFileHandler.register(ctx.eventBus);

    syncBroadcastHandler = new SyncBroadcastHandler();
    syncBroadcastHandler.register(ctx.eventBus);

    resourceDetectionHandler = new ResourceDetectionHandler(ctx);
    resourceDetectionHandler.register(ctx.eventBus);

    // Start file watcher for live changes
    fileWatcher = new VaultFileWatcher(ctx.path, ctx.eventBus);
    fileWatcher.start();
  }

  function unregisterVaultHandlers() {
    fileWatcher?.stop();
    fileWatcher = null;
    noteFileHandler?.unregister();
    noteFileHandler = null;
    syncBroadcastHandler?.unregister();
    syncBroadcastHandler = null;
    resourceDetectionHandler?.unregister();
    resourceDetectionHandler = null;
  }

  ipcMain.handle('vault-workspace:get-status', () => {
    const ctx = vaultManager.getContext();
    if (!ctx) return { open: false };
    return { open: true, path: ctx.path, name: ctx.name, id: ctx.id };
  });

  ipcMain.handle('vault-workspace:get-recent', () => {
    return vaultManager.getRecentVaults();
  });

  ipcMain.handle('vault-workspace:create', async (_event, vaultPath: string, name: string) => {
    unregisterVaultHandlers();
    const ctx = await vaultManager.create(vaultPath, name);
    registerVaultHandlers();
    return { path: ctx.path, name: ctx.name, id: ctx.id };
  });

  ipcMain.handle('vault-workspace:open', async (_event, vaultPath: string) => {
    unregisterVaultHandlers();
    const ctx = await vaultManager.open(vaultPath);
    registerVaultHandlers();
    return { path: ctx.path, name: ctx.name, id: ctx.id };
  });

  ipcMain.handle('vault-workspace:pick-create', async () => {
    unregisterVaultHandlers();
    const ctx = await vaultManager.pickAndCreate();
    if (!ctx) return null;
    registerVaultHandlers();
    return { path: ctx.path, name: ctx.name, id: ctx.id };
  });

  ipcMain.handle('vault-workspace:pick-open', async () => {
    unregisterVaultHandlers();
    const ctx = await vaultManager.pickAndOpen();
    if (!ctx) return null;
    registerVaultHandlers();
    return { path: ctx.path, name: ctx.name, id: ctx.id };
  });

  ipcMain.handle('vault-workspace:close', async () => {
    unregisterVaultHandlers();
    await vaultManager.close();
  });

  // Open a vault in a new OS process (like Obsidian)
  ipcMain.handle('vault-workspace:open-new-window', async (_event, vaultPath: string) => {
    app.relaunch({ args: ['--vault', vaultPath] });
  });

  ipcMain.handle('vault-workspace:pick-create-new-window', async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      title: 'Choose location for new vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const vaultPath = result.filePaths[0];
    const name = vaultPath.split('/').pop() ?? 'My Vault';
    scaffoldVault(vaultPath, name);
    app.relaunch({ args: ['--vault', vaultPath] });
  });

  ipcMain.handle('vault-workspace:pick-open-new-window', async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      title: 'Open vault',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    app.relaunch({ args: ['--vault', result.filePaths[0]] });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
