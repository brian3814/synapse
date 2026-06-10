# Headless MCP Runtime — Phase 1: Standalone Embeddings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the standalone `synapse-mcp` CLI full semantic search capabilities — ONNX and OpenAI embeddings — without requiring the Electron desktop app to be running.

**Architecture:** Make the `EmbeddingService` (currently in `electron/embeddings/`) portable by removing one Electron dependency (`app.getPath()`), then import it directly into the standalone CLI. Each vault gets its own `EmbeddingService` instance; ONNX worker threads and OpenAI provider are shared. The CLI reads embedding config from the desktop app's `storage.json` (already auto-discovered for vault paths). Console output redirected to stderr so stdout stays clean for MCP protocol.

**Tech Stack:** better-sqlite3, sqlite-vec, @huggingface/transformers (optional), @modelcontextprotocol/sdk, esbuild

**Spec:** `docs/superpowers/specs/2026-05-27-headless-mcp-runtime-design.md` (Phase 1 section)

---

## File Map

```
Modified:
  electron/embeddings/onnx-provider.ts          — remove Electron dep, make cacheDir/workerPath configurable
  packages/synapse-mcp/src/standalone-provider.ts — add EmbeddingService integration
  packages/synapse-mcp/src/index.ts              — load embedding config, init per vault, console→stderr
  packages/synapse-mcp/package.json              — add optional deps, update build script

New:
  (none — all embedding modules imported from electron/embeddings/ via relative paths, bundled by esbuild)
```

---

### Task 1: Make OnnxProvider Electron-Free

**Files:**
- Modify: `electron/embeddings/onnx-provider.ts`

The only Electron dependency in the entire embedding stack is `import { app } from 'electron'` on line 2, used on line 39 for `app.getPath('userData')`. Replace it with configurable parameters.

- [ ] **Step 1: Update the constructor to accept cacheDir and workerPath**

```typescript
import { Worker } from 'worker_threads';
import { join } from 'path';
import { homedir } from 'os';
import type { EmbeddingProvider } from '../../src/embeddings/types';

const DEFAULT_CACHE_DIR = process.env.SYNAPSE_MODELS_DIR
  || join(homedir(), '.synapse', 'models');

export class OnnxProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Local (MiniLM)';
  readonly dimensions = 384;
  readonly maxTokens = 256;

  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  private modelQuality: 'quantized' | 'full';
  private cacheDir: string;
  private workerPath: string;

  constructor(
    modelQuality: 'quantized' | 'full' = 'quantized',
    cacheDir?: string,
    workerPath?: string,
  ) {
    this.modelQuality = modelQuality;
    this.id = modelQuality === 'full' ? 'onnx-minilm-full' : 'onnx-minilm';
    this.cacheDir = cacheDir || DEFAULT_CACHE_DIR;
    this.workerPath = workerPath || join(__dirname, 'embeddings', 'onnx-worker.cjs');
  }
```

- [ ] **Step 2: Update initialize() to use the instance fields**

Replace lines 21-52. The only changes are line 22 (`this.workerPath` instead of hardcoded path) and line 39 (`this.cacheDir` instead of `app.getPath()`):

```typescript
  async initialize(): Promise<void> {
    this.worker = new Worker(this.workerPath);

    this.worker.on('error', (e) => {
      console.error('[onnx-worker] Thread error:', e);
    });

    this.worker.on('message', (msg: { type: string; requestId?: string; vectors?: Float32Array[]; error?: string }) => {
      if (msg.type === 'result' && msg.requestId && msg.vectors) {
        this.pendingRequests.get(msg.requestId)?.resolve(msg.vectors);
        this.pendingRequests.delete(msg.requestId);
      } else if (msg.type === 'error' && msg.requestId) {
        this.pendingRequests.get(msg.requestId)?.reject(new Error(msg.error ?? 'ONNX worker error'));
        this.pendingRequests.delete(msg.requestId);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onMsg = (msg: { type: string; error?: string }) => {
        if (msg.type === 'ready') {
          this.worker?.off('message', onMsg);
          resolve();
        } else if (msg.type === 'error') {
          this.worker?.off('message', onMsg);
          reject(new Error(msg.error ?? 'Model load failed'));
        }
      };
      this.worker!.on('message', onMsg);
      this.worker!.postMessage({ type: 'load', modelQuality: this.modelQuality, cacheDir: this.cacheDir });
    });
  }
```

- [ ] **Step 3: Update the Electron app to pass its own cacheDir**

In `electron/embeddings/embedding-service.ts`, the `createProvider()` method (around line 68) creates the OnnxProvider. Update it to pass the Electron-specific cache dir:

```typescript
  private createProvider(): EmbeddingProvider | null {
    const { providerId, onnxModelQuality, openaiApiKey, openaiModel } = this.config;

    if (providerId.startsWith('onnx')) {
      // Electron app: use app's userData path for model cache
      const { app } = require('electron');
      const cacheDir = require('path').join(app.getPath('userData'), 'models');
      return new OnnxProvider(onnxModelQuality, cacheDir);
    }
    if (providerId.startsWith('openai') && openaiApiKey) {
      return new OpenAIProvider(openaiApiKey, openaiModel ?? 'text-embedding-3-small');
    }
    return null;
  }
```

Note: `require('electron')` instead of top-level import — this keeps the module importable from non-Electron contexts. The `electron` module is only resolved at runtime when this code path executes.

Also, in `electron/main.ts` near the top of `app.whenReady()`, set the env var so the OnnxProvider's default matches the Electron app's storage:

```typescript
process.env.SYNAPSE_MODELS_DIR = process.env.SYNAPSE_MODELS_DIR
  || path.join(app.getPath('userData'), 'models');
```

This ensures both Electron and standalone resolve to the same model cache directory.

- [ ] **Step 4: Verify Electron build**

Run: `npm run build:electron-main`
Expected: Builds successfully with no errors.

- [ ] **Step 5: Commit**

```bash
git add electron/embeddings/onnx-provider.ts electron/embeddings/embedding-service.ts
git commit -m "refactor: make OnnxProvider Electron-free with configurable cacheDir/workerPath"
```

---

### Task 2: Redirect Console to stderr in Standalone CLI

**Files:**
- Modify: `packages/synapse-mcp/src/index.ts`

MCP protocol uses stdout exclusively. Any `console.log` from the embedding service, ONNX worker, or other code would corrupt the MCP stream. Override at the very top of the entry point, before any imports with side effects.

See: `docs/pitfalls/mcp-stdio-stdout-corruption.md`

- [ ] **Step 1: Add console override as the first lines of index.ts**

At the very top of `packages/synapse-mcp/src/index.ts`, before all other imports:

```typescript
// MCP protocol uses stdout — redirect all logging to stderr
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;
console.log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');
console.warn = (...args: unknown[]) => process.stderr.write('[WARN] ' + args.join(' ') + '\n');
console.error = (...args: unknown[]) => process.stderr.write('[ERROR] ' + args.join(' ') + '\n');
console.debug = (...args: unknown[]) => process.stderr.write('[DEBUG] ' + args.join(' ') + '\n');
```

This must be above all `import` statements that could trigger side effects. Since this is ESM with esbuild bundling, the override runs before any bundled module's top-level code executes.

- [ ] **Step 2: Remove existing stderr writes that duplicate the override**

Search for `process.stderr.write` calls in `index.ts` that log startup info. These can now use `console.log` (which goes to stderr via the override). Keep them as-is for now — they already target stderr correctly.

- [ ] **Step 3: Verify build**

Run: `cd packages/synapse-mcp && npm run build`
Expected: Builds successfully.

- [ ] **Step 4: Commit**

```bash
git add packages/synapse-mcp/src/index.ts
git commit -m "fix: redirect console output to stderr for MCP stdio protocol safety"
```

---

### Task 3: Load Embedding Config from App Storage

**Files:**
- Modify: `packages/synapse-mcp/src/index.ts`

The desktop app stores embedding config (including the OpenAI API key in plaintext) in `~/Library/Application Support/kg-extension/storage.json`. The `discoverVaultPaths()` function already reads this file for vault paths. Extend it to also extract the embedding config.

- [ ] **Step 1: Add loadEmbeddingConfig function**

Add this function near the existing `discoverVaultPaths()` in `index.ts`:

```typescript
import type { EmbeddingConfig } from '../../src/embeddings/types';
import { DEFAULT_EMBEDDING_CONFIG } from '../../src/embeddings/types';

function loadEmbeddingConfig(): Partial<EmbeddingConfig> | null {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'kg-extension', 'storage.json'),
    path.join(os.homedir(), '.config', 'kg-extension', 'storage.json'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'kg-extension', 'storage.json'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      const config = data.embeddingConfig as Partial<EmbeddingConfig> | undefined;
      if (!config?.enabled) return null;

      // Env var overrides stored API key (standard MCP pattern)
      if (config.providerId?.startsWith('openai')) {
        const envKey = process.env.OPENAI_API_KEY;
        if (envKey) {
          config.openaiApiKey = envKey;
        }
        if (!config.openaiApiKey) {
          console.warn(
            'OpenAI embeddings configured but no API key found. '
            + 'Set OPENAI_API_KEY env var in your MCP client config.'
          );
          return null;
        }
      }

      // ONNX: check if model is cached
      if (config.providerId?.startsWith('onnx')) {
        const cacheDir = process.env.SYNAPSE_MODELS_DIR
          || path.join(os.homedir(), '.synapse', 'models');
        const modelDir = path.join(cacheDir, 'Xenova', 'all-MiniLM-L6-v2');
        if (!fs.existsSync(modelDir)) {
          console.warn(
            'ONNX model not cached. Open the Synapse desktop app and enable '
            + 'embeddings to download the model.'
          );
          return null;
        }
      }

      return config;
    } catch {
      // ignore parse errors
    }
  }
  return null;
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/synapse-mcp && npm run build`
Expected: Builds. The type import from `../../src/embeddings/types` will be resolved by esbuild.

- [ ] **Step 3: Commit**

```bash
git add packages/synapse-mcp/src/index.ts
git commit -m "feat(mcp): load embedding config from desktop app storage"
```

---

### Task 4: Add EmbeddingService to StandaloneGraphProvider

**Files:**
- Modify: `packages/synapse-mcp/src/standalone-provider.ts`

Replace the current `semanticSearch()` method (which does a raw OpenAI fetch) with the real `EmbeddingService`. This gives the standalone CLI the same embedding pipeline as the desktop app — including graph-aware embeddings, text hashing, and the cascade mechanism.

- [ ] **Step 1: Add EmbeddingService import and field**

At the top of `standalone-provider.ts`, add the import:

```typescript
import { EmbeddingService } from '../../../electron/embeddings/embedding-service';
import type { EmbeddingConfig } from '../../../src/embeddings/types';
```

Add field and method to the class (after the constructor):

```typescript
  private embeddingService: EmbeddingService | null = null;

  async initEmbeddings(config: Partial<EmbeddingConfig>): Promise<void> {
    try {
      this.embeddingService = new EmbeddingService(
        () => this.db,
        (nodeId: string) => {
          // Read note content from vault filesystem
          const node = this.db.prepare('SELECT vault_path FROM nodes WHERE id = ?')
            .get(nodeId) as { vault_path: string | null } | undefined;
          if (node?.vault_path) {
            const absPath = path.join(this.vaultPath, node.vault_path);
            if (fs.existsSync(absPath)) return fs.readFileSync(absPath, 'utf-8');
          }
          return null;
        },
      );
      await this.embeddingService.initialize(config);
      console.log(`[embeddings] Initialized for vault (provider: ${config.providerId})`);
    } catch (e) {
      console.warn(`[embeddings] Failed to initialize: ${e instanceof Error ? e.message : e}`);
      this.embeddingService = null;
    }
  }

  async disposeEmbeddings(): Promise<void> {
    await this.embeddingService?.dispose();
    this.embeddingService = null;
  }
```

Note: The `StandaloneGraphProvider` constructor receives `vaultPath` — store it as a field if not already stored (check the constructor, it currently stores `this.db` but may not store `this.vaultPath`).

- [ ] **Step 2: Store vaultPath in constructor**

The constructor currently opens the DB but doesn't store the vault path. Add it:

```typescript
  private db: Database.Database;
  private vaultPath: string;

  constructor(vaultPath: string, readonly: boolean = true) {
    this.vaultPath = vaultPath;
    const dbPath = path.join(vaultPath, '.kg', 'graph.db');
    this.db = new Database(dbPath, { readonly });
  }
```

- [ ] **Step 3: Replace the semanticSearch method**

Replace the existing `semanticSearch()` method (which does raw OpenAI fetch + manual sqlite-vec) with one that delegates to the EmbeddingService:

```typescript
  async semanticSearch(query: string, limit = 5): Promise<StandaloneToolResult> {
    if (!this.embeddingService?.isEnabled()) {
      return {
        result: JSON.stringify({
          message: 'Embeddings not available. Ensure embeddings are enabled in the Synapse desktop app '
            + 'and the model is cached (ONNX) or OPENAI_API_KEY is set.',
        }),
      };
    }

    try {
      const results = await this.embeddingService.searchSimilar(query, limit);
      if (results.length === 0) {
        return { result: JSON.stringify({ message: 'No semantic matches found.' }) };
      }

      const nodeDetails = [];
      for (const r of results) {
        const node = this.db.prepare(
          'SELECT id, name, type, label FROM nodes WHERE id = ?'
        ).get(r.nodeId) as { id: string; name: string; type: string; label: string | null } | undefined;
        if (node) {
          nodeDetails.push({ ...node, similarity: r.score.toFixed(3) });
        }
      }
      return { result: JSON.stringify(nodeDetails) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }
```

- [ ] **Step 4: Remove the old vecLoaded field and raw fetch logic**

Delete the `private vecLoaded = false;` field and any leftover raw-fetch-based semantic search code that was replaced in Step 3.

- [ ] **Step 5: Update close() to dispose embeddings**

```typescript
  close(): void {
    this.embeddingService?.dispose().catch(() => {});
    this.db.close();
  }
```

- [ ] **Step 6: Commit**

```bash
git add packages/synapse-mcp/src/standalone-provider.ts
git commit -m "feat(mcp): integrate EmbeddingService into StandaloneGraphProvider"
```

---

### Task 5: Initialize Embeddings Per Vault at Startup

**Files:**
- Modify: `packages/synapse-mcp/src/index.ts`

Wire the embedding config loading (Task 3) and the StandaloneGraphProvider embedding init (Task 4) together at startup.

- [ ] **Step 1: Load config and init embeddings in openVaults()**

Update the `openVaults()` function to also initialize embeddings. The embedding config is loaded once and shared across all vaults:

```typescript
function openVaults(vaultPaths: string[], allowWrite: boolean, init: boolean): VaultEntry[] {
  const entries: VaultEntry[] = [];
  const embeddingConfig = loadEmbeddingConfig();

  for (const vaultPath of vaultPaths) {
    if (init) {
      StandaloneGraphProvider.initVault(vaultPath);
      process.stderr.write(`Initialized vault at ${vaultPath}\n`);
    }
    const dbPath = path.join(vaultPath, '.kg', 'graph.db');
    if (!fs.existsSync(dbPath)) {
      process.stderr.write(`Warning: No graph.db found at ${dbPath}, skipping.\n`);
      continue;
    }
    const name = path.basename(vaultPath);
    const provider = new StandaloneGraphProvider(vaultPath, !allowWrite);
    entries.push({ name, vaultPath, provider });

    // Initialize embeddings asynchronously (don't block vault opening)
    if (embeddingConfig) {
      provider.initEmbeddings(embeddingConfig).catch((e) => {
        process.stderr.write(`[${name}] Embedding init failed: ${e}\n`);
      });
    }
  }
  return entries;
}
```

Note: `initEmbeddings()` is async but we don't await it — embeddings initialize in the background while the MCP server starts accepting connections. The first `semantic_search` call may arrive before init completes; the method already handles this by checking `isEnabled()`.

- [ ] **Step 2: Clean up embeddings on exit**

In the `cleanup()` function (near the end of `main()`), add embedding disposal:

```typescript
  function cleanup(): void {
    for (const vault of vaults) {
      try {
        vault.provider.close();  // already disposes embeddings in close()
      } catch {}
    }
  }
```

This already works because Task 4 updated `close()` to dispose embeddings.

- [ ] **Step 3: Verify build**

Run: `cd packages/synapse-mcp && npm run build`
Expected: Builds. Relative imports from `../../electron/embeddings/` and `../../src/embeddings/types` are resolved and bundled by esbuild.

- [ ] **Step 4: Commit**

```bash
git add packages/synapse-mcp/src/index.ts
git commit -m "feat(mcp): initialize embeddings per vault at startup"
```

---

### Task 6: Update Build System for ONNX Worker

**Files:**
- Modify: `packages/synapse-mcp/package.json`

The ONNX provider spawns a worker thread from a file path. The worker must exist as a separate file in the build output. Add it as a second esbuild entry point and add `@huggingface/transformers` as an optional dependency.

- [ ] **Step 1: Update package.json dependencies**

Add `@huggingface/transformers` as an optional dependency:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^12.9.0",
    "sqlite-vec": "^0.1.9"
  },
  "optionalDependencies": {
    "@huggingface/transformers": "^3.0.0"
  }
}
```

- [ ] **Step 2: Update build script to bundle the ONNX worker**

Replace the `build` script in `package.json`:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --outdir=dist --format=esm --banner:js=\"#!/usr/bin/env node\" --packages=external && esbuild ../../electron/embeddings/onnx-worker.ts --bundle --platform=node --outfile=dist/onnx-worker.cjs --format=cjs --packages=external && npm rebuild better-sqlite3",
    "pack": "npm run build && npx @anthropic-ai/mcpb pack",
    "dev": "tsx src/index.ts"
  }
}
```

This adds a second esbuild invocation that bundles the ONNX worker as a separate CJS file (workers must be CJS for `worker_threads`).

- [ ] **Step 3: Pass the worker path from StandaloneGraphProvider**

In `standalone-provider.ts`, when initializing the `EmbeddingService`, the ONNX provider needs to know where the worker file is. The `EmbeddingService.createProvider()` in `embedding-service.ts` creates the provider — but the standalone CLI needs to override the worker path.

The cleanest approach: the `EmbeddingService` accepts the worker path in its config. Add a `workerPath` field to the service's constructor or init. But to avoid modifying the service interface for a CLI-only concern, use the env var approach instead.

Before calling `initEmbeddings()`, set the env var:

```typescript
// In standalone-provider.ts initEmbeddings():
process.env.SYNAPSE_ONNX_WORKER_PATH = process.env.SYNAPSE_ONNX_WORKER_PATH
  || path.join(path.dirname(new URL(import.meta.url).pathname), 'onnx-worker.cjs');
```

Then in `onnx-provider.ts`, update the default workerPath:

```typescript
this.workerPath = workerPath
  || process.env.SYNAPSE_ONNX_WORKER_PATH
  || join(__dirname, 'embeddings', 'onnx-worker.cjs');
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/synapse-mcp && npm run build
ls dist/  # should show: index.js, onnx-worker.cjs
```

Expected: Both files present. `index.js` has the shebang. `onnx-worker.cjs` is the bundled worker.

- [ ] **Step 5: Commit**

```bash
git add packages/synapse-mcp/package.json electron/embeddings/onnx-provider.ts
git commit -m "build(mcp): bundle ONNX worker and add @huggingface/transformers optional dep"
```

---

### Task 7: End-to-End Verification

**Files:** (none — testing only)

Verify the full pipeline works: CLI starts, discovers vaults, loads embedding config, initializes embeddings, and serves `semantic_search` over MCP.

- [ ] **Step 1: Build both packages**

```bash
npm run build:electron-main
cd packages/synapse-mcp && npm run build
```

Expected: Both build with no errors.

- [ ] **Step 2: Test standalone CLI starts and lists tools**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node packages/synapse-mcp/dist/index.js --allow-write 2>/dev/null | head -1
```

Expected: JSON response listing tools including `semantic_search`. stderr diagnostics (vault discovery, embedding init) go to stderr and are suppressed by `2>/dev/null`.

- [ ] **Step 3: Test semantic_search tool call**

If a vault with existing embeddings is available:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"semantic_search","arguments":{"query":"test query","limit":3}}}' | node packages/synapse-mcp/dist/index.js --allow-write 2>/dev/null
```

Expected: JSON response with either search results or a message about embeddings not being available (if no embeddings in the discovered vault).

- [ ] **Step 4: Run the eval case**

Use `/eval-run semantic-relational-discovery` to test the full flow through Claude Code's MCP client. The eval requires embeddings to be enabled and nodes to be embedded.

- [ ] **Step 5: Commit (if any test-driven fixes were needed)**

```bash
git add -A
git commit -m "fix(mcp): test-driven fixes for standalone embedding integration"
```

---

## Post-Implementation Notes

**What this enables:**
- `semantic_search` works in Claude Code, Cursor, and any MCP client
- Multi-vault semantic search across all discovered vaults
- Graph-aware embeddings (if configured in the desktop app) cascade through the CLI
- ONNX (local, free) or OpenAI (API key) — same providers as the desktop app

**What's next (Phase 2):**
- Headless Electron mode (`--headless`) for safeStorage keys, external MCP forwarding, and `--debug` UI
- See `docs/superpowers/specs/2026-05-27-headless-mcp-runtime-design.md` Phase 2 section
