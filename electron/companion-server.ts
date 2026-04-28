import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow } from 'electron';

const PORT = 19876;

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

export function startCompanionServer(): void {
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

    if (req.url === '/api/capture' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { title, url, content } = JSON.parse(body);

        if (!content) {
          json(res, 400, { error: 'No content provided' });
          return;
        }

        const windows = BrowserWindow.getAllWindows();
        console.log(`[Companion Server] Received capture: "${title}" (${url}), ${content.length} chars, broadcasting to ${windows.length} windows`);
        for (const win of windows) {
          win.webContents.send('companion:capture', { title, url, content });
        }

        json(res, 200, { success: true });
      } catch (e: any) {
        json(res, 400, { error: e.message });
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Companion Server] Listening on http://127.0.0.1:${PORT}`);
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[Companion Server] Port ${PORT} in use, skipping`);
    } else {
      console.error('[Companion Server] Error:', e);
    }
  });
}
