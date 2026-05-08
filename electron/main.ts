import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
import path from 'path';
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
