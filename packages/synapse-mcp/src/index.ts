// MCP stdio transport uses stdout exclusively for JSON-RPC.
// Redirect all logging to stderr to prevent protocol corruption.
// See: docs/pitfalls/mcp-stdio-stdout-corruption.md
console.log = (...args: unknown[]) => { process.stderr.write(args.join(' ') + '\n'); };
console.warn = (...args: unknown[]) => { process.stderr.write('[WARN] ' + args.join(' ') + '\n'); };
console.error = (...args: unknown[]) => { process.stderr.write('[ERROR] ' + args.join(' ') + '\n'); };
console.debug = (...args: unknown[]) => { process.stderr.write('[DEBUG] ' + args.join(' ') + '\n'); };

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';

import { createStandaloneContext, wireEngine } from '../../../src/mcp/adapters/standalone';
import { DefaultKnowledgeService } from '../../../src/mcp/knowledge-service-impl';
import { createSynapseMcpServer } from '../../../src/mcp/server';
import { ProfilePolicy, loadProfileFromFile } from '../../../src/mcp/authorization';
import { MCP_TOOL_DEFINITIONS } from '../../../src/mcp/tools/definitions';
import { executeToolHandler } from '../../../src/mcp/tools/handlers';
import { StandaloneGraphProvider } from './standalone-provider.js';
import type { KnowledgeService } from '../../../src/mcp/knowledge-service';
import type { EmbeddingConfig } from '../../../src/embeddings/types';
import type { Capability } from '../../../src/mcp/tools/types';
import type { CommandContext } from '../../../src/commands/types';

// ---------------------------------------------------------------------------
// App notification — tells running Electron app to refresh its graph
// ---------------------------------------------------------------------------

function notifyApp(): void {
  const req = http.request(
    { hostname: '127.0.0.1', port: 19876, path: '/api/graph-changed', method: 'POST', timeout: 1000 },
    () => {},
  );
  req.on('error', () => {});
  req.end();
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  vaultPaths: string[];
  allowWrite: boolean;
  initVault: boolean;
  profile: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const vaultPaths: string[] = [];
  let allowWrite = false;
  let initVault = false;
  let profile: string | null = null;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault' || arg === '-v') {
      const next = argv[++i];
      if (!next) {
        process.stderr.write('Error: --vault requires a path argument\n');
        process.exit(1);
      }
      vaultPaths.push(path.resolve(next));
    } else if (arg === '--allow-write') {
      allowWrite = true;
    } else if (arg === '--init') {
      initVault = true;
    } else if (arg === '--profile') {
      profile = argv[++i] ?? null;
    } else if (arg === '--help' || arg === '-h') {
      process.stderr.write(
        'Usage: synapse-mcp [--vault <path>]... [--allow-write] [--init] [--profile <name>]\n\n' +
        '  --vault <path>     Path to a Synapse vault (can repeat for multiple vaults).\n' +
        '                     If omitted, auto-discovers from recent vaults.\n' +
        '  --allow-write      Open vault DB in read-write mode (default: read-only).\n' +
        '  --init             Initialize vault directories and DB schema before opening.\n' +
        '                     Creates .synapse/, notes/, and graph.db with full schema.\n' +
        '                     Safe to run on existing vaults (no-ops if already set up).\n' +
        '  --profile <name>   MCP profile to load from .synapse/mcp-server.json.\n'
      );
      process.exit(0);
    }
  }

  return { vaultPaths, allowWrite, initVault, profile };
}

// ---------------------------------------------------------------------------
// Auto-discovery: read recent vaults from Electron app's storage.json
// ---------------------------------------------------------------------------

function discoverVaultPaths(): string[] {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'kg-extension', 'storage.json'),
    path.join(os.homedir(), '.config', 'kg-extension', 'storage.json'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'kg-extension', 'storage.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const recentVaults = data['recentVaults'];
        if (Array.isArray(recentVaults)) {
          const paths = recentVaults
            .filter((v): v is { path: string } =>
              v && typeof v === 'object' && typeof (v as Record<string, unknown>)['path'] === 'string',
            )
            .map((v) => v.path)
            .filter((p) => fs.existsSync(path.join(p, '.synapse', 'graph.db')));
          if (paths.length > 0) return paths;
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Embedding config: read from desktop app's storage.json
// ---------------------------------------------------------------------------

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

      if (config.providerId?.startsWith('openai')) {
        const envKey = process.env.OPENAI_API_KEY;
        if (envKey) {
          config.openaiApiKey = envKey;
        }
        if (!config.openaiApiKey) {
          console.warn(
            'OpenAI embeddings configured but no API key found. '
            + 'Set OPENAI_API_KEY env var in your MCP client config.',
          );
          return null;
        }
      }

      if (config.providerId?.startsWith('onnx')) {
        const cacheDir = process.env.SYNAPSE_MODELS_DIR
          || path.join(os.homedir(), '.synapse', 'models');
        const modelDir = path.join(cacheDir, 'Xenova', 'all-MiniLM-L6-v2');
        if (!fs.existsSync(modelDir)) {
          console.warn(
            'ONNX model not cached. Open the Synapse desktop app and enable '
            + 'embeddings to download the model.',
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

// ---------------------------------------------------------------------------
// Vault registry — each vault gets its own KnowledgeService
// ---------------------------------------------------------------------------

interface VaultEntry {
  name: string;
  vaultPath: string;
  db: Database.Database;
  ctx: CommandContext;
  service: KnowledgeService;
  /** Legacy provider for embeddings init only */
  legacyProvider?: StandaloneGraphProvider;
}

async function openVault(
  vaultPath: string,
  readonly: boolean,
  embeddingConfig: Partial<EmbeddingConfig> | null,
): Promise<VaultEntry> {
  const dbPath = path.join(vaultPath, '.synapse', 'graph.db');
  const db = new Database(dbPath, { readonly });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const name = path.basename(vaultPath);

  // Build context and service via shared core
  const ctx = await createStandaloneContext(db, vaultPath);
  const service = new DefaultKnowledgeService(ctx);

  const entry: VaultEntry = { name, vaultPath, db, ctx, service };

  // Wire embeddings if configured (reuse legacy provider's embedding init)
  if (embeddingConfig) {
    try {
      const provider = new StandaloneGraphProvider(vaultPath, readonly);
      await provider.initEmbeddings(embeddingConfig);
      entry.legacyProvider = provider;
      // Expose embedding search on the context
      if ((provider as any).embeddingService) {
        (ctx as any).embedding = {
          searchSimilar: (query: string, topK?: number) =>
            (provider as any).embeddingService.search(query, topK),
        };
      }
    } catch (e) {
      process.stderr.write(`[${name}] Embedding init failed: ${e}\n`);
    }
  }

  return entry;
}

async function openVaults(
  vaultPaths: string[],
  allowWrite: boolean,
  init: boolean,
): Promise<VaultEntry[]> {
  const entries: VaultEntry[] = [];
  const embeddingConfig = loadEmbeddingConfig();

  for (const vaultPath of vaultPaths) {
    if (init) {
      await StandaloneGraphProvider.initVault(vaultPath);
      process.stderr.write(`Initialized vault at ${vaultPath}\n`);
    }
    const dbPath = path.join(vaultPath, '.synapse', 'graph.db');
    if (!fs.existsSync(dbPath)) {
      process.stderr.write(`Warning: No graph.db found at ${dbPath}, skipping.\n`);
      continue;
    }
    try {
      const entry = await openVault(vaultPath, !allowWrite, embeddingConfig);
      entries.push(entry);
    } catch (e) {
      process.stderr.write(`Warning: Failed to open vault at ${vaultPath}: ${e}\n`);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Build profile policy from CLI flags
// ---------------------------------------------------------------------------

function buildPolicy(opts: CliOptions, vaultPath?: string): ProfilePolicy {
  // --profile flag: load from vault's .synapse/mcp-server.json
  if (opts.profile && vaultPath) {
    const configPath = path.join(vaultPath, '.synapse', 'mcp-server.json');
    const config = loadProfileFromFile(configPath, opts.profile);
    return new ProfilePolicy(config);
  }

  // --allow-write: full read+write access
  const capabilities: Capability[] = opts.allowWrite
    ? ['read', 'write']
    : ['read'];

  return new ProfilePolicy({
    capabilities,
    blocked_tools: [],
    blocked_actions: [],
  });
}

// ---------------------------------------------------------------------------
// CLI-specific vault management tool definitions
// ---------------------------------------------------------------------------

const TOOL_LIST_VAULTS = {
  name: 'list_vaults',
  description: 'List all connected Synapse vaults.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
};

const TOOL_OPEN_VAULT = {
  name: 'open_vault',
  description: 'Connect a vault at the given path. If --init is enabled, creates vault structure first. Safe to call on already-connected vaults.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Absolute path to the vault directory.' },
      init: { type: 'boolean', description: 'Initialize vault structure if it does not exist (default false).' },
    },
    required: ['path'],
  },
};

const TOOL_CLOSE_VAULT = {
  name: 'close_vault',
  description: 'Disconnect a vault by name. Closes the database connection.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vault: { type: 'string', description: 'Vault name to disconnect.' },
    },
    required: ['vault'],
  },
};

// ---------------------------------------------------------------------------
// Vault resolution helper
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

function resolveVault(vaults: VaultEntry[], args: ToolArgs): VaultEntry | { error: string } {
  if (vaults.length === 0) {
    return { error: 'No vaults connected. Use open_vault tool to connect one first.' };
  }
  const vaultName = typeof args.vault === 'string' ? args.vault : undefined;
  if (vaults.length > 1 && !vaultName) {
    return {
      error: `Multiple vaults loaded. Specify "vault" parameter: ${vaults.map((v) => v.name).join(', ')}`,
    };
  }
  if (vaultName) {
    const found = vaults.find((v) => v.name === vaultName);
    if (!found) {
      return { error: `Vault "${vaultName}" not found. Available: ${vaults.map((v) => v.name).join(', ')}` };
    }
    return found;
  }
  return vaults[0];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  let vaultPaths = opts.vaultPaths;
  if (vaultPaths.length === 0) {
    vaultPaths = discoverVaultPaths();
    if (vaultPaths.length > 0) {
      process.stderr.write(`Auto-discovered vaults: ${vaultPaths.join(', ')}\n`);
    } else {
      process.stderr.write('No vaults connected. Use open_vault tool or --vault flag to connect one.\n');
    }
  }

  const vaults = await openVaults(vaultPaths, opts.allowWrite, opts.initVault);

  // Build profile policy using the first vault (or defaults)
  const policy = buildPolicy(opts, vaults[0]?.vaultPath);

  // Create the shared MCP server using the first vault's service
  // (multi-vault routing is handled below via tool call interception)
  const primaryService = vaults[0]?.service;

  // For single-vault mode, use the shared server directly.
  // For multi-vault or zero-vault mode, we need custom routing.
  const server = primaryService
    ? createSynapseMcpServer(primaryService, policy, () => notifyApp())
    : new Server(
        { name: 'synapse', version: '0.7.0' },
        { capabilities: { tools: {} } },
      );

  // Override the request handlers to add vault management tools and multi-vault routing
  const managementTools = [TOOL_LIST_VAULTS, TOOL_OPEN_VAULT, TOOL_CLOSE_VAULT];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Service tools filtered by policy
    const serviceTools = MCP_TOOL_DEFINITIONS
      .filter((t) => policy.canListTool(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as any,
      }));

    return {
      tools: [...managementTools, ...serviceTools],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as ToolArgs;

    // ── Vault management tools (CLI-specific) ─────────────────────

    if (name === 'list_vaults') {
      const list = vaults.map((v) => ({ name: v.name, path: v.vaultPath }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
    }

    if (name === 'open_vault') {
      const vaultPath = typeof toolArgs.path === 'string' ? toolArgs.path : '';
      if (!vaultPath) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'path is required' }) }], isError: true };
      }
      const resolved = path.resolve(vaultPath);
      const existing = vaults.find((v) => v.vaultPath === resolved);
      if (existing) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'already_connected', name: existing.name, path: existing.vaultPath }) }],
        };
      }
      const shouldInit = toolArgs.init === true;
      if (shouldInit) {
        await StandaloneGraphProvider.initVault(resolved);
        process.stderr.write(`Initialized vault at ${resolved}\n`);
      }
      const dbPath = path.join(resolved, '.synapse', 'graph.db');
      if (!fs.existsSync(dbPath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `No graph.db at ${dbPath}. Use init: true to create one.` }) }],
          isError: true,
        };
      }
      try {
        const entry = await openVault(resolved, !opts.allowWrite, loadEmbeddingConfig());
        vaults.push(entry);
        process.stderr.write(`Connected vault: ${entry.name} (${resolved})\n`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'connected', name: entry.name, path: resolved }) }],
        };
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to open vault: ${e}` }) }],
          isError: true,
        };
      }
    }

    if (name === 'close_vault') {
      const vaultName = typeof toolArgs.vault === 'string' ? toolArgs.vault : '';
      if (!vaultName) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'vault name is required' }) }], isError: true };
      }
      const idx = vaults.findIndex((v) => v.name === vaultName);
      if (idx === -1) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Vault "${vaultName}" not found. Available: ${vaults.map((v) => v.name).join(', ')}` }) }],
          isError: true,
        };
      }
      vaults[idx].db.close();
      vaults[idx].legacyProvider?.close();
      vaults.splice(idx, 1);
      process.stderr.write(`Disconnected vault: ${vaultName}\n`);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'disconnected', name: vaultName }) }] };
    }

    // ── Shared service tools — route to correct vault ────────────

    const vault = resolveVault(vaults, toolArgs);
    if ('error' in vault) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: vault.error }) }],
        isError: true,
      };
    }

    // Re-wire global query engine to target this vault's DB before dispatch.
    // Required because the DataStore delegation layer uses a global engine.
    wireEngine(vault.db);

    const result = await executeToolHandler(
      vault.service,
      policy,
      name,
      toolArgs,
    );

    if (
      !result.isError &&
      (result.effects.nodeIds.length > 0 || result.effects.edgeIds.length > 0)
    ) {
      notifyApp();
    }

    return {
      content: [{ type: 'text' as const, text: result.result }],
      isError: result.isError,
    };
  });

  // ── Cleanup ───────────────────────────────────────────────────────

  function cleanup(): void {
    for (const vault of vaults) {
      try {
        vault.db.close();
        vault.legacyProvider?.close();
      } catch {
        // ignore
      }
    }
  }
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
