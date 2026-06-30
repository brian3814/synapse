import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow } from 'electron';
import { StorageBackend } from './storage-backend';

const DEFAULT_PORT = 19876;
const MAX_PORT_ATTEMPTS = 10;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, data: any): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

interface CompanionServerOptions {
  storage?: StorageBackend;
  getMcpHandler?: () => ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null;
}

function tryListen(server: ReturnType<typeof createServer>, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startCompanionServer(options: CompanionServerOptions | StorageBackend = {}): Promise<number | null> {
  // Support legacy call signature: startCompanionServer(storage)
  const opts: CompanionServerOptions = options instanceof StorageBackend
    ? { storage: options }
    : options;
  const storageBackend = opts.storage;

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/api/identify' && req.method === 'GET') {
      json(res, 200, { app: 'kg-desktop', version: '1.0.0' });
      return;
    }

    if (req.url === '/api/vaults' && req.method === 'GET') {
      const vaults: Array<{ path: string; name: string; lastOpened: string }> = [];
      if (storageBackend) {
        const data = storageBackend.get('recentVaults');
        if (Array.isArray(data.recentVaults)) {
          for (const v of data.recentVaults) {
            if (v.path && v.name) vaults.push(v);
          }
        }
      }
      json(res, 200, { vaults });
      return;
    }

    if (req.url === '/api/capture' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { title, url, content, targetVaultPath, targetVaultName } = JSON.parse(body);

        if (!content) {
          json(res, 400, { error: 'No content provided' });
          return;
        }

        const windows = BrowserWindow.getAllWindows();
        console.log(`[Companion Server] Received capture: "${title}" (${url}), ${content.length} chars, broadcasting to ${windows.length} windows`);
        for (const win of windows) {
          win.webContents.send('companion:capture', { title, url, content, targetVaultPath, targetVaultName });
        }

        json(res, 200, { success: true });
      } catch (e: any) {
        json(res, 400, { error: e.message });
      }
      return;
    }

    if (req.url === '/api/reading-queue' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { url, title, targetVaultPath, targetVaultName } = JSON.parse(body);

        if (!url) {
          json(res, 400, { error: 'No URL provided' });
          return;
        }

        const windows = BrowserWindow.getAllWindows();
        console.log(`[Companion Server] Reading queue: "${title}" (${url}), broadcasting to ${windows.length} windows`);
        for (const win of windows) {
          win.webContents.send('companion:reading-queue', { url, title: title ?? url, targetVaultPath, targetVaultName });
        }

        json(res, 200, { success: true });
      } catch (e: any) {
        json(res, 400, { error: e.message });
      }
      return;
    }

    if (req.url === '/api/graph-changed' && req.method === 'POST') {
      console.log('[Companion] Graph change notification received');
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('db:sync', { type: 'reset' });
      }
      json(res, 200, { reloaded: true, windows: windows.length });
      return;
    }

    if (req.url?.startsWith('/mcp') && opts.getMcpHandler) {
      const handler = opts.getMcpHandler();
      if (handler) {
        console.log(`[Companion] MCP request: ${req.method} ${req.url}`);
        try {
          await handler(req, res);
        } catch (e: any) {
          console.error('[Companion] MCP handler error:', e.message);
          json(res, 500, { error: e.message });
        }
        return;
      }
      console.warn('[Companion] MCP request but handler not ready');
      json(res, 503, { error: 'MCP server not ready (vault not open)' });
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = DEFAULT_PORT + attempt;
    try {
      await tryListen(server, port, '127.0.0.1');
      console.log(`[Companion Server] Listening on http://127.0.0.1:${port}`);
      if (storageBackend) {
        storageBackend.set({ companionPort: port });
      }
      server.on('error', (e) => {
        console.error('[Companion Server] Runtime error:', e);
      });
      return port;
    } catch (e: any) {
      if (e.code === 'EADDRINUSE') {
        console.warn(`[Companion Server] Port ${port} in use, trying next...`);
        continue;
      }
      console.error('[Companion Server] Error:', e);
      return null;
    }
  }

  console.error(`[Companion Server] All ports ${DEFAULT_PORT}-${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1} in use`);
  return null;
}
