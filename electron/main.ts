import { app, BrowserWindow, dialog, protocol, net, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { StorageBackend } from './storage-backend';
import { handleAction as dbHandleAction, dataStore } from './db-backend';
import * as notesBackend from './notes-backend';
import * as filesBackend from './files-backend';
import { handleRuntimeMessage, setStorage as setLLMStorage, handleStreamExtraction, handleRunAgent, handleStreamChat } from './llm-backend';
import { startCompanionServer } from './companion-server';
import { getDb } from './better-sqlite3-engine';
import { EmbeddingService } from './embeddings/embedding-service';
import { registerEmbeddingHandlers, setupProgressBroadcast } from './embeddings/ipc-handlers';
import { readNote } from './notes-backend';
import { VaultManager } from './vault/vault-manager';
import { parseAgentFile } from '../src/shared/agent-definition-types';
import { scaffoldVault } from './vault/vault-context';
import type { VaultSandboxConfig } from '../src/shared/agent-settings-types';
import { NoteFileHandler } from './vault/handlers/note-file-handler';
import { SyncBroadcastHandler } from './vault/handlers/sync-broadcast-handler';
import { ResourceDetectionHandler } from './vault/handlers/resource-detection-handler';
import { VaultFileWatcher } from './vault/file-watcher';
import { reconcileVault } from './vault/reconciliation';
import { computeFileHash } from './vault/content-hash';
import { registerToolIpcHandlers, registerMcpClientIpcHandlers, broadcastToolsChanged } from './mcp/mcp-ipc';
import { ToolRegistry } from './mcp/tool-registry';
import { BuiltinToolProvider } from './mcp/builtin-tool-provider';
import { createMainProcessContext } from './mcp/main-process-context';
import { McpClientManager } from './mcp/mcp-client-manager';
import { loadMcpClientConfig, loadMcpServerConfig } from './mcp/mcp-config';
import { McpServerBridge } from './mcp/mcp-server-bridge';

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
  // Ensure model cache dir is set for both Electron and standalone contexts
  process.env.SYNAPSE_MODELS_DIR = process.env.SYNAPSE_MODELS_DIR
    || path.join(app.getPath('userData'), 'models');

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

    // Pre-lookup edge endpoints before deletion (edge is gone after action)
    let deletedEdgeEndpoints: { source_id: string; target_id: string } | undefined;
    if (action === 'edges.delete') {
      try {
        deletedEdgeEndpoints = getDb().prepare(
          'SELECT source_id, target_id FROM edges WHERE id = ?'
        ).get(params as string) as { source_id: string; target_id: string } | undefined;
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
        embeddingService = new EmbeddingService(getDb, (nodeId: string) => {
          const ctx = vaultManager.getContext();
          if (ctx) {
            const row = getDb().prepare('SELECT vault_path FROM nodes WHERE id = ?')
              .get(nodeId) as { vault_path: string | null } | undefined;
            if (row?.vault_path) {
              const absPath = path.join(ctx.path, row.vault_path);
              if (fs.existsSync(absPath)) return fs.readFileSync(absPath, 'utf-8');
              return null;
            }
          }
          return readNote(nodeId);
        });
        const storedConfig = storage.get('embeddingConfig');
        await embeddingService.initialize(storedConfig?.embeddingConfig ?? undefined);
        setupProgressBroadcast(embeddingService);
        console.log('[main] Embedding service initialized');
      } catch (e) {
        console.error('[main] Failed to init embedding service:', e);
      }
    }

    // Notify embedding service of node and edge mutations
    if (outcome.syncEvent && embeddingService) {
      const eventType = (outcome.syncEvent as any).type;
      if (eventType === 'node_created' || eventType === 'node_updated') {
        const nodeId = (outcome.syncEvent as any).node?.id;
        if (nodeId) embeddingService.handleNodeMutation(nodeId).catch(() => {});
      } else if (eventType === 'node_deleted') {
        const nodeId = (outcome.syncEvent as any).id;
        if (nodeId) embeddingService.handleNodeDeleted(nodeId);
      } else if (eventType === 'edge_created' || eventType === 'edge_updated') {
        const edge = (outcome.syncEvent as any).edge;
        if (edge) embeddingService.handleEdgeMutation(edge.source_id, edge.target_id).catch(() => {});
      } else if (eventType === 'edge_deleted' && deletedEdgeEndpoints) {
        embeddingService.handleEdgeMutation(deletedEdgeEndpoints.source_id, deletedEdgeEndpoints.target_id).catch(() => {});
      }
    }

    // Handle batch mutations (mutation.execute doesn't emit syncEvents)
    if (action === 'mutation.execute' && embeddingService && outcome.result) {
      const mutResult = outcome.result as { results?: Array<{ action: string; node?: { id?: string } }> };
      const nodeIds = (mutResult.results ?? [])
        .filter((r) => (r.action === 'created' || r.action === 'merged') && r.node?.id)
        .map((r) => r.node!.id as string);
      if (nodeIds.length > 0) embeddingService.handleNodeMutationBatch(nodeIds).catch(() => {});
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
    if (vaultManager.getContext()) return;
    notesBackend.initNotesDir();
  });

  ipcMain.handle('notes:read', (_event, nodeId: string) => {
    const ctx = vaultManager.getContext();
    if (ctx) {
      const row = getDb().prepare('SELECT vault_path FROM nodes WHERE id = ?')
        .get(nodeId) as { vault_path: string | null } | undefined;
      if (row?.vault_path) {
        const absPath = path.join(ctx.path, row.vault_path);
        if (fs.existsSync(absPath)) return fs.readFileSync(absPath, 'utf-8');
        return null;
      }
    }
    return notesBackend.readNote(nodeId);
  });

  ipcMain.handle('notes:write', (_event, nodeId: string, markdown: string) => {
    const ctx = vaultManager.getContext();
    if (ctx) {
      const row = getDb().prepare('SELECT vault_path FROM nodes WHERE id = ?')
        .get(nodeId) as { vault_path: string | null } | undefined;
      if (row?.vault_path) {
        const absPath = path.join(ctx.path, row.vault_path);
        fileWatcher?.markAsAppWritten(row.vault_path);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, markdown, 'utf-8');
        const stat = fs.statSync(absPath);
        const hash = computeFileHash(absPath);
        getDb().prepare('UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?')
          .run(Math.floor(stat.mtimeMs), stat.size, hash, nodeId);
        if (embeddingService) embeddingService.handleNodeMutation(nodeId).catch(() => {});
        return;
      }
    }
    notesBackend.writeNote(nodeId, markdown);
    if (embeddingService) embeddingService.handleNodeMutation(nodeId).catch(() => {});
  });

  ipcMain.handle('notes:remove', (_event, nodeId: string) => {
    const ctx = vaultManager.getContext();
    if (ctx) {
      const row = getDb().prepare('SELECT vault_path FROM nodes WHERE id = ?')
        .get(nodeId) as { vault_path: string | null } | undefined;
      if (row?.vault_path) {
        const absPath = path.join(ctx.path, row.vault_path);
        try { fs.unlinkSync(absPath); } catch { /* not found */ }
        return;
      }
    }
    notesBackend.removeNote(nodeId);
  });

  ipcMain.handle('notes:list', () => {
    const ctx = vaultManager.getContext();
    if (ctx) {
      const rows = getDb().prepare('SELECT id FROM nodes WHERE type = ? AND vault_path IS NOT NULL')
        .all('note') as { id: string }[];
      return rows.map((r: { id: string }) => r.id);
    }
    return notesBackend.listNotes();
  });

  ipcMain.handle('notes:exists', (_event, nodeId: string) => {
    const ctx = vaultManager.getContext();
    if (ctx) {
      const row = getDb().prepare('SELECT vault_path FROM nodes WHERE id = ?')
        .get(nodeId) as { vault_path: string | null } | undefined;
      return row?.vault_path ? fs.existsSync(path.join(ctx.path, row.vault_path)) : false;
    }
    return notesBackend.noteExists(nodeId);
  });

  ipcMain.handle('notes:getPath', () => {
    const ctx = vaultManager.getContext();
    if (ctx) return path.join(ctx.path, 'notes');
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

  ipcMain.handle('fetch-url-content', async (_event, url: string) => {
    try {
      const response = await net.fetch(url);
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const html = await response.text();
      return { html };
    } catch (e: any) {
      return { error: e.message };
    }
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

  // ── Vault Explorer — filesystem operations ──────────────────────────────
  function readDirTree(dirPath: string, depth: number): any[] {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db')
      .map(e => ({
        id: path.join(dirPath, e.name),
        name: e.name,
        isFolder: e.isDirectory(),
        children: e.isDirectory() && depth < 10 ? readDirTree(path.join(dirPath, e.name), depth + 1) : e.isDirectory() ? [] : undefined,
      }))
      .sort((a: any, b: any) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  ipcMain.handle('vault-explorer:read-tree', async (_event, rootDir: string) => {
    return readDirTree(rootDir, 0);
  });

  ipcMain.handle('vault-explorer:create-file', async (_event, dirPath: string, name: string) => {
    const fullPath = path.join(dirPath, name);
    fs.writeFileSync(fullPath, '', { flag: 'wx' });
  });

  ipcMain.handle('vault-explorer:create-folder', async (_event, dirPath: string, name: string) => {
    fs.mkdirSync(path.join(dirPath, name));
  });

  ipcMain.handle('vault-explorer:rename', async (_event, oldPath: string, newPath: string) => {
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle('vault-explorer:delete', async (_event, targetPath: string) => {
    await shell.trashItem(targetPath);
  });

  ipcMain.handle('vault-explorer:move', async (_event, sourcePath: string, destDir: string) => {
    const name = path.basename(sourcePath);
    let destPath = path.join(destDir, name);
    let counter = 1;
    while (fs.existsSync(destPath)) {
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      destPath = path.join(destDir, `${base} (${counter})${ext}`);
      counter++;
    }
    fs.renameSync(sourcePath, destPath);
  });

  ipcMain.handle('vault-explorer:import-files', async (_event, filePaths: string[], destDir: string) => {
    for (const srcPath of filePaths) {
      const name = path.basename(srcPath);
      let destPath = path.join(destDir, name);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        const ext = path.extname(name);
        const base = name.slice(0, name.length - ext.length);
        destPath = path.join(destDir, `${base} (${counter})${ext}`);
        counter++;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  });

  ipcMain.handle('vault-explorer:read-file', async (_event, filePath: string) => {
    return Array.from(fs.readFileSync(filePath));
  });

  ipcMain.handle('vault-explorer:delete-files', async (_event, filePaths: string[]) => {
    for (const p of filePaths) {
      await shell.trashItem(p);
    }
  });

  ipcMain.handle('vault-explorer:open-external', async (_event, filePath: string) => {
    await shell.openPath(filePath);
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
    try {
      return filesBackend.listFiles(prefix);
    } catch (e: any) {
      console.warn('[files:list] Error listing files:', e.message);
      return [];
    }
  });

  ipcMain.handle('runtime:sendMessage', async (_event, message) => {
    const result = await handleRuntimeMessage(message, (broadcastMsg) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('runtime:broadcast', broadcastMsg);
      }
    });
    return result;
  });

  ipcMain.handle('agents:list-vault', async () => {
    const ctx = vaultManager.getContext();
    if (!ctx) return [];
    const agentsDir = path.join(ctx.kgPath, 'agents');
    if (!fs.existsSync(agentsDir)) return [];
    try {
      const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      return files.map(file => {
        const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
        return parseAgentFile(content, file, 'vault');
      });
    } catch {
      return [];
    }
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

  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  startCompanionServer({
    storage,
    getMcpHandler: () => mcpServerBridge
      ? (req, res) => mcpServerBridge!.handleRequest(req, res)
      : null,
  });

  // ── MCP / Tool Registry ──────────────────────────────────────────
  let toolRegistry: ToolRegistry | null = null;
  let mcpClientManager: McpClientManager | null = null;
  let mcpServerBridge: McpServerBridge | null = null;

  registerToolIpcHandlers(() => toolRegistry);
  registerMcpClientIpcHandlers(() => mcpClientManager);

  // ── Vault Workspace Management ──────────────────────────────────────
  const vaultManager = new VaultManager(storage);

  // Auto-open vault from --vault CLI arg (used by relaunch for multi-vault)
  const vaultArgIdx = process.argv.indexOf('--vault');
  const vaultReadyPromise = (vaultArgIdx !== -1 && process.argv[vaultArgIdx + 1])
    ? vaultManager.open(process.argv[vaultArgIdx + 1])
        .then(() => registerVaultHandlers())
        .catch((e) => console.error('[Vault] Failed to auto-open from --vault arg:', e))
    : Promise.resolve();
  let noteFileHandler: NoteFileHandler | null = null;
  let syncBroadcastHandler: SyncBroadcastHandler | null = null;
  let resourceDetectionHandler: ResourceDetectionHandler | null = null;
  let fileWatcher: VaultFileWatcher | null = null;

  function registerVaultHandlers() {
    const ctx = vaultManager.getContext();
    if (!ctx) return;

    // Point files backend at the active vault's agent directory
    filesBackend.setRoot(path.join(ctx.kgPath, 'agent'));

    // Run reconciliation to catch offline changes
    reconcileVault(ctx);

    // Register event handlers
    noteFileHandler = new NoteFileHandler(ctx);
    noteFileHandler.register(ctx.eventBus);

    syncBroadcastHandler = new SyncBroadcastHandler();
    syncBroadcastHandler.register(ctx.eventBus);

    const getSandboxConfig = () => vaultManager.getContext()!.sandboxConfig;

    resourceDetectionHandler = new ResourceDetectionHandler(ctx, getSandboxConfig);
    resourceDetectionHandler.register(ctx.eventBus);

    // Start file watcher for live changes
    fileWatcher = new VaultFileWatcher(ctx.path, ctx.eventBus, getSandboxConfig);
    fileWatcher.start();

    // Forward file-watcher events to renderer for vault explorer
    ctx.eventBus.on('file:added', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('vault-explorer:fs-changed', { type: 'added' });
      }
    });
    ctx.eventBus.on('file:removed', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('vault-explorer:fs-changed', { type: 'removed' });
      }
    });
    ctx.eventBus.on('file:changed', (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('vault-explorer:fs-changed', { type: 'changed' });
      }
      if (embeddingService) {
        const row = ctx.db.prepare('SELECT id FROM nodes WHERE vault_path = ?')
          .get(event.relativePath) as { id: string } | undefined;
        if (row) embeddingService.handleNodeMutation(row.id).catch(() => {});
      }
      if (event.relativePath.startsWith('notes/')) {
        const row = ctx.db.prepare('SELECT id FROM nodes WHERE vault_path = ?')
          .get(event.relativePath) as { id: string } | undefined;
        if (row) {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('note:external-change', { nodeId: row.id });
          }
        }
      }
    });

    // Initialize tool registry with BuiltinToolProvider
    const mainCtx = createMainProcessContext({
      dataStore,
      storage: storage as any,
      readNote: async (nodeId) => readNote(nodeId),
      writeNote: async (nodeId, content) => {
        notesBackend.writeNote(nodeId, content);
      },
      embedding: embeddingService ? {
        searchSimilar: (query: string, topK?: number) => embeddingService!.searchSimilar(query, topK ?? 5),
      } : undefined,
    });
    toolRegistry = new ToolRegistry();
    toolRegistry.registerProvider(new BuiltinToolProvider(mainCtx));
    toolRegistry.onToolsChanged(() => broadcastToolsChanged());

    // MCP Client — connect to configured external servers
    const globalConfigPath = path.join(app.getPath('userData'), 'mcp-config.json');
    const vaultConfigPath = path.join(ctx.path, '.kg', 'mcp.json');
    const globalSecretsPath = path.join(app.getPath('userData'), 'mcp-secrets.json');
    const vaultSecretsPath = path.join(ctx.path, '.kg', 'secrets.json');

    const mcpConfig = loadMcpClientConfig({ globalConfigPath, vaultConfigPath });

    if (Object.keys(mcpConfig.mcpServers).length > 0) {
      mcpClientManager = new McpClientManager({
        registry: toolRegistry!,
        globalSecretsPath,
        vaultSecretsPath,
        onStatusChanged: (name, state, error) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('mcp:server-status-changed', { name, state, error });
          }
        },
      });
      mcpClientManager.connectAll(mcpConfig).catch((e: any) =>
        console.error('[MCP] Failed to connect servers:', e)
      );
    }

    // MCP Server — expose graph tools to external agents
    // Always enabled when vault is open; config only controls access profiles
    const serverConfig = loadMcpServerConfig(ctx.path);
    if (toolRegistry) {
      mcpServerBridge = new McpServerBridge({
        registry: toolRegistry,
        config: { ...serverConfig, enabled: true },
        onGraphMutated: (nodeIds?: string[], edgeIds?: string[]) => {
          const windows = BrowserWindow.getAllWindows();
          console.log(`[MCP] Graph mutated, broadcasting reset to ${windows.length} window(s)`);
          for (const win of windows) {
            win.webContents.send('db:sync', { type: 'reset' });
          }
          if (embeddingService && nodeIds?.length) {
            embeddingService.handleNodeMutationBatch(nodeIds).catch(() => {});
          }
          if (embeddingService && edgeIds?.length) {
            for (const edgeId of edgeIds) {
              try {
                const edge = getDb().prepare('SELECT source_id, target_id FROM edges WHERE id = ?')
                  .get(edgeId) as { source_id: string; target_id: string } | undefined;
                if (edge) embeddingService.handleEdgeMutation(edge.source_id, edge.target_id).catch(() => {});
              } catch { /* edge may already be deleted */ }
            }
          }
        },
      });
      console.log('[MCP] Server bridge started');
    }
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
    // Reset so embedding service re-initializes with the new vault's DB
    embeddingInitStarted = false;
    embeddingService?.dispose();
    embeddingService = null;
    mcpClientManager?.dispose?.();
    mcpClientManager = null;
    toolRegistry?.dispose();
    toolRegistry = null;
    mcpServerBridge?.dispose();
    mcpServerBridge = null;
    filesBackend.clearRoot();
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

  ipcMain.handle('vault-workspace:get-sandbox-config', () => {
    const ctx = vaultManager.getContext();
    if (!ctx) return null;
    return ctx.sandboxConfig;
  });

  ipcMain.handle('vault-workspace:set-sandbox-config', (_event, config: VaultSandboxConfig) => {
    const ctx = vaultManager.getContext();
    if (!ctx) return;
    ctx.sandboxConfig = config;
    const agentConfigPath = path.join(ctx.kgPath, 'agent-config.json');
    fs.writeFileSync(agentConfigPath, JSON.stringify(config, null, 2), 'utf-8');
  });

  // Open a vault in a new OS process — keeps current instance running
  function spawnVaultProcess(vaultPath: string): void {
    const baseArgs = process.argv.slice(1).filter((a: string) => a !== '--vault' && !a.startsWith('--vault='));
    const child = spawn(process.execPath, [...baseArgs, '--vault', vaultPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  ipcMain.handle('vault-workspace:open-new-window', async (_event, vaultPath: string) => {
    spawnVaultProcess(vaultPath);
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
    spawnVaultProcess(vaultPath);
  });

  ipcMain.handle('vault-workspace:pick-open-new-window', async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      title: 'Open vault',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    spawnVaultProcess(result.filePaths[0]);
  });

  vaultReadyPromise.then(() => createWindow());

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
