# Headless MCP Runtime Design

Evolution of the [MCP Integration Design](2026-05-15-mcp-integration-design.md). The stdio CLI (`synapse-mcp`) gains embedding capabilities and a headless Electron mode, organized as two tiers that the user doesn't need to think about — the CLI auto-selects the best available runtime.

## Problem

The original MCP design created a hard capability split:

| | HTTP (Electron running) | stdio CLI (standalone) |
|---|---|---|
| Embeddings | Full (ONNX/OpenAI) | None |
| API keys | Encrypted via safeStorage | None |
| Tools | All via BuiltinToolProvider | Reimplemented subset |
| Graph-aware embeddings | Yes (cascade, direction) | No |
| Multi-vault | No (one vault per app) | Yes |

Users configuring `synapse-mcp` in Claude Code or Cursor get no semantic search, no graph-aware context, and no access to stored keys. The CLI reimplements tool logic in `StandaloneGraphProvider`, creating two codepaths that drift.

## Solution: Two-Tier Runtime

The CLI operates in two tiers. **Tier 1 (standalone)** is the default — it runs everywhere, supports multi-vault, and now gains embedding capabilities. **Tier 2 (headless Electron)** is an opt-in upgrade for when you need the full desktop runtime (encrypted keys, debug UI). The CLI auto-falls-back from Tier 2 to Tier 1 if Electron is unavailable.

```
synapse-mcp                                  → Tier 1: standalone + embeddings
synapse-mcp --headless --vault <path>        → Tier 2: headless Electron
synapse-mcp --headless --vault <path> --debug → Tier 2: headless + visible UI
```

### Tier Comparison

| Capability | Tier 1: Standalone (default) | Tier 2: Headless Electron |
|---|---|---|
| **Multi-vault** | Yes (auto-discover or multiple `--vault`) | Single vault only |
| **Semantic search** | Yes (ONNX from cached model, or OpenAI via env var) | Yes (ONNX/OpenAI, keys from safeStorage) |
| **Graph-aware embeddings** | Yes (same `EmbeddingService`) | Yes |
| **API key source** | `OPENAI_API_KEY` env var | Encrypted app storage (safeStorage) |
| **ONNX model source** | `~/.synapse/models/` (must be pre-downloaded by desktop app) | Same cache, auto-available |
| **Tool implementation** | `StandaloneGraphProvider` (enhanced) | `BuiltinToolProvider` (same as desktop) |
| **External MCP servers** | No (no `McpClientManager`) | Yes (full client manager) |
| **Debug UI** | No | Yes (`--debug` shows Synapse window) |
| **Requirements** | Node.js only | Electron binary |
| **Startup time** | Fast (~200ms) | Slower (~1-2s, Electron boot) |

### When to use which

- **Tier 1** — the everyday default. Multi-vault, embeddings, fast startup. Good for Claude Code, Cursor, CI pipelines. Covers 90% of use cases.
- **Tier 2** — when you need encrypted API keys without env vars, external MCP server forwarding, or visual debugging of what the MCP client is doing to your graph.

## Architecture

```
MCP Client (Claude Code, Cursor, etc.)
  │
  │ spawns process, communicates via stdio
  │
  ▼
synapse-mcp (entry point)
  │
  ├─ [default] Tier 1: Standalone Node.js
  │    ├── Vault A
  │    │    ├── StandaloneGraphProvider (SQLite)
  │    │    └── EmbeddingService(dbA)  ← NEW: ONNX or OpenAI
  │    ├── Vault B
  │    │    ├── StandaloneGraphProvider (SQLite)
  │    │    └── EmbeddingService(dbB)
  │    └── Shared ONNX provider (one worker thread across vaults)
  │
  ├─ [--headless] Tier 2: Headless Electron (single vault)
  │    ├── VaultManager.open()
  │    ├── EmbeddingService  ← safeStorage keys, ONNX/OpenAI
  │    ├── ToolRegistry + BuiltinToolProvider
  │    ├── McpClientManager (external MCP servers)
  │    ├── McpServerBridge (HTTP on 19876)
  │    └── StdioMcpTransport
  │
  └─ [auto-fallback] Tier 2 requested but Electron not found → Tier 1 with warning
```

## Changes

### Phase 1: Enhance Standalone with Embeddings (Tier 1)

The `EmbeddingService` is already Electron-free — only one line in the ONNX provider touches Electron (`app.getPath('userData')` for the model cache directory). Fixing that line makes the entire embedding stack portable.

#### 1a. `electron/embeddings/onnx-provider.ts` — Remove Electron dependency

Replace the single `app.getPath('userData')` call:

```typescript
// Before:
import { app } from 'electron';
const cacheDir = join(app.getPath('userData'), 'models');

// After:
const cacheDir = process.env.SYNAPSE_MODELS_DIR
  || join(os.homedir(), '.synapse', 'models');
```

The desktop app sets `SYNAPSE_MODELS_DIR` to its own userData path (preserving existing behavior). The standalone CLI uses `~/.synapse/models/` — the same directory the desktop app's ONNX provider downloads to, so cached models are shared.

#### 1b. `packages/synapse-mcp/src/standalone-provider.ts` — Add embedding integration

Add an `EmbeddingService` instance per vault:

```typescript
export class StandaloneGraphProvider {
  private db: Database.Database;
  private embeddingService: EmbeddingService | null = null;

  async initEmbeddings(config: Partial<EmbeddingConfig>): Promise<void> {
    this.embeddingService = new EmbeddingService(
      () => this.db,
      (nodeId) => this.readNoteContent(nodeId),
    );
    await this.embeddingService.initialize(config);
  }

  async semanticSearch(query: string, limit = 5): Promise<StandaloneToolResult> {
    if (!this.embeddingService?.isEnabled()) {
      return { result: JSON.stringify({ message: 'Embeddings not enabled.' }) };
    }
    const results = await this.embeddingService.searchSimilar(query, limit);
    // enrich with node details...
  }
}
```

The `EmbeddingService`, `EmbeddingQueue`, `OnnxProvider`, `OpenAIProvider`, `vec-store`, and `build-embedding-text` modules are all pure Node.js and can be imported directly from the `electron/embeddings/` directory (or extracted to a shared location).

#### 1c. `packages/synapse-mcp/src/index.ts` — Load embedding config at startup

On startup, read the desktop app's stored config:

```typescript
function loadEmbeddingConfig(): Partial<EmbeddingConfig> | null {
  // Read from ~/Library/Application Support/kg-extension/storage.json
  const storagePath = getAppStoragePath();  // existing auto-discovery logic
  const storage = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
  const config = storage.embeddingConfig;
  if (!config) return null;

  // API key: can't decrypt safeStorage, use env var fallback
  if (config.providerId?.startsWith('openai')) {
    config.openaiApiKey = process.env.OPENAI_API_KEY || undefined;
    if (!config.openaiApiKey) {
      process.stderr.write(
        '[synapse-mcp] OpenAI embeddings configured but OPENAI_API_KEY not set. '
        + 'Semantic search unavailable. Use --headless for encrypted key access.\n'
      );
      return null;
    }
  }

  return config;
}
```

For each vault, call `provider.initEmbeddings(config)`. If ONNX model is not cached, the `EmbeddingService` logs: "ONNX model not cached. Open Synapse desktop app and enable embeddings to download the model."

#### 1d. New dependencies for `synapse-mcp` package

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

`@huggingface/transformers` is optional — if not installed, ONNX embeddings are unavailable but OpenAI still works. The CLI degrades gracefully.

### Phase 2: Headless Electron Mode (Tier 2)

#### 2a. `electron/main.ts` — Headless mode

Detect `--headless` in `process.argv`. When set:

- **Skip `createWindow()`** — the `vaultReadyPromise.then(() => createWindow())` becomes conditional
- **Redirect logging to stderr** — override `console.log/warn/error` so stdout is reserved for MCP protocol (see `docs/pitfalls/mcp-stdio-stdout-corruption.md`)
- **Add stdio MCP transport** — after vault init, create `StdioServerTransport` connected to the same tool registry as the HTTP bridge
- **Handle process lifecycle** — process stays alive until stdin closes or SIGTERM
- **Hide Dock icon** — `app.dock?.hide()` on macOS

Detect `--debug` alongside `--headless`:

- Create a BrowserWindow showing the Synapse UI
- MCP stdio transport runs simultaneously — watch the graph update as the MCP client operates
- Window close does NOT quit the process (headless lifecycle rules apply)

Detect `--allow-write`:

- Override the MCP server profile to include write capabilities

#### 2b. `electron/headless-stdio.ts` — New file, stdio MCP transport

Minimal module that creates an MCP server over stdio, reusing the same `IToolRegistry`:

```typescript
export async function startStdioMcpServer(
  registry: IToolRegistry,
  filter: ToolFilter,
  onMutated: () => void,
): Promise<{ transport: StdioServerTransport }> {
  // register ListTools and CallTool handlers using registry
  // connect to StdioServerTransport
  // return transport for lifecycle management
}
```

#### 2c. `packages/synapse-mcp/src/headless-launcher.ts` — New file, Electron spawn + stdio proxy

```typescript
export function runHeadlessElectron(args: string[]): void {
  const electronPath = resolveElectronBinary();
  const appPath = resolveAppPath();

  const child = spawn(electronPath, [appPath, '--headless', ...args], {
    stdio: ['pipe', 'pipe', 'inherit'],  // stdin/stdout for MCP, stderr passthrough
  });

  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.on('exit', (code) => process.exit(code ?? 0));
}
```

#### 2d. `packages/synapse-mcp/src/index.ts` — Mode selection

```typescript
#!/usr/bin/env node

const isHeadless = process.argv.includes('--headless');

if (isHeadless) {
  if (!electronAvailable()) {
    process.stderr.write('[synapse-mcp] --headless requires Electron. Falling back to standalone.\n');
    runStandalone();
  } else {
    runHeadlessElectron(process.argv.slice(2));
  }
} else {
  runStandalone();  // Tier 1: multi-vault + embeddings
}
```

### Phase 3: Logging (both tiers)

MCP protocol uses stdout exclusively. All logging must go to stderr.

**Tier 1 (standalone):** Already uses `process.stderr.write()` for its own logging. The `EmbeddingService` and providers use `console.log` — override at entry point:

```typescript
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');
console.warn = (...args) => process.stderr.write('[WARN] ' + args.join(' ') + '\n');
console.error = (...args) => process.stderr.write('[ERROR] ' + args.join(' ') + '\n');
```

**Tier 2 (headless Electron):** Same override in `electron/main.ts` when `--headless` detected, before any imports with side effects.

### Phase 4: Process lifecycle

**Tier 1:** Process exits when stdin closes (MCP client disconnected), or SIGTERM/SIGINT.

**Tier 2 (headless):** Same stdin/signal-based lifecycle. `window-all-closed` event is suppressed.

**Tier 2 (debug):** Window close does NOT quit — only stdin close or signal terminates.

## CLI Interface

### Default usage (Tier 1 — most users)

```json
{
  "mcpServers": {
    "synapse": {
      "command": "synapse-mcp",
      "args": ["--allow-write"]
    }
  }
}
```

Auto-discovers all recent vaults. Embeddings enabled if ONNX model is cached or `OPENAI_API_KEY` is set. Multi-vault search across all vaults.

### Explicit vault

```json
{
  "mcpServers": {
    "synapse": {
      "command": "synapse-mcp",
      "args": ["--vault", "/path/to/vault", "--allow-write"]
    }
  }
}
```

### Headless Electron (Tier 2)

```json
{
  "mcpServers": {
    "synapse": {
      "command": "synapse-mcp",
      "args": ["--headless", "--vault", "/path/to/vault", "--allow-write"]
    }
  }
}
```

Single vault. Full Electron runtime. Encrypted API keys. External MCP server forwarding.

### Debugging

```bash
synapse-mcp --headless --vault /path/to/vault --allow-write --debug
```

Shows the Synapse UI window. MCP client still operates via stdio. Like `playwright --debug`.

### CI / Docker

```bash
synapse-mcp --vault /path/to/vault --allow-write
```

Tier 1 (standalone) runs without a display server. No Electron needed.

### Full flag reference

| Flag | Tier | Description |
|---|---|---|
| (none) | 1 | Default. Standalone Node.js, multi-vault, embeddings. |
| `--headless` | 2 | Headless Electron. Single vault, full runtime. |
| `--debug` | 2 | Headless + visible Synapse UI window. |
| `--vault <path>` | both | Vault path (repeatable in Tier 1, single in Tier 2). Auto-discovers if omitted. |
| `--allow-write` | both | Enable write tools. |
| `--init` | both | Initialize vault structure before opening. |

## What Stays the Same

- **HTTP MCP server** on port 19876 — runs in Tier 2 headless mode
- **`StandaloneGraphProvider`** — preserved as Tier 1 foundation, enhanced with embeddings
- **Vault auto-discovery** — reads from `~/Library/Application Support/kg-extension/storage.json`
- **MCP server profiles** — per-vault `.kg/mcp-server.json` still controls access

## What Changes

| Before | After |
|---|---|
| CLI has no embeddings | Tier 1: embeddings via shared ONNX model or OpenAI env var |
| CLI has no graph-aware search | Both tiers: full graph-aware embedding cascade |
| Only env var for API keys | Tier 2: encrypted keys via safeStorage |
| No debug UI | Tier 2: `--debug` shows Synapse window |
| CLI reimplements all tools | Tier 1 enhanced, Tier 2 shares desktop implementation |
| Single mode | Auto-selecting two-tier runtime |

## File Structure

```
electron/
  main.ts                         ← Phase 2: headless mode flag handling
  headless-stdio.ts               ← Phase 2: NEW, stdio MCP transport
  embeddings/
    onnx-provider.ts              ← Phase 1a: replace app.getPath() with env var

packages/
  synapse-mcp/
    src/
      index.ts                    ← Phase 1c/2d: mode selection + embedding config
      standalone-provider.ts      ← Phase 1b: add EmbeddingService per vault
      headless-launcher.ts        ← Phase 2c: NEW, Electron spawn + stdio proxy
```

## Dependencies

**New for `synapse-mcp` package:**
- `sqlite-vec` (already added)
- `@huggingface/transformers` (optional — for ONNX embeddings)
- `electron` (optional peer dependency — only for `--headless`)

**Electron app:**
- No new dependencies. `@modelcontextprotocol/sdk` already includes `StdioServerTransport`.

## Edge Cases

- **Electron not installed + `--headless` requested**: Falls back to Tier 1 with stderr warning
- **ONNX model not cached**: Clear error — "Open Synapse desktop app and enable embeddings to download the model." No auto-download from CLI.
- **`OPENAI_API_KEY` not set + OpenAI configured**: Clear error — "Set OPENAI_API_KEY env var or use --headless for encrypted key access."
- **Port 19876 conflict (Tier 2)**: Catch `EADDRINUSE` silently. Log: "Port 19876 in use, HTTP MCP server skipped." Stdio transport works regardless.
- **macOS Dock icon (Tier 2)**: `app.dock?.hide()` in headless mode.
- **Multiple vaults in Tier 2**: Not supported. Single `--vault` only. Error if multiple `--vault` flags with `--headless`.

## Non-Goals

- **Remote headless server**: Localhost only.
- **Auto-download ONNX model from CLI**: Users consent via desktop app.
- **Multi-vault in Tier 2**: Electron handles one vault. Use Tier 1 for multi-vault.
- **Replacing the desktop app**: Headless mode is for programmatic access.

## Implementation Order

1. **Phase 1** (Tier 1 embeddings) — unblocks semantic search for all MCP clients immediately
2. **Phase 2** (Tier 2 headless) — adds encrypted keys, debug UI, external MCP forwarding
3. **Phase 3** (logging) — can be done in either phase, needed by both
4. **Phase 4** (lifecycle) — handled per-phase as each tier is implemented
