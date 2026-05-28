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
import { StandaloneGraphProvider } from './standalone-provider.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import type { EmbeddingConfig } from '../../../src/embeddings/types';

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
}

function parseArgs(argv: string[]): CliOptions {
  const vaultPaths: string[] = [];
  let allowWrite = false;
  let initVault = false;

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
    } else if (arg === '--help' || arg === '-h') {
      process.stderr.write(
        'Usage: synapse-mcp [--vault <path>]... [--allow-write] [--init]\n\n' +
        '  --vault <path>   Path to a Synapse vault (can repeat for multiple vaults).\n' +
        '                   If omitted, auto-discovers from recent vaults.\n' +
        '  --allow-write    Open vault DB in read-write mode (default: read-only).\n' +
        '  --init           Initialize vault directories and DB schema before opening.\n' +
        '                   Creates .kg/, notes/, and graph.db with full schema.\n' +
        '                   Safe to run on existing vaults (no-ops if already set up).\n'
      );
      process.exit(0);
    }
  }

  return { vaultPaths, allowWrite, initVault };
}

// ---------------------------------------------------------------------------
// Auto-discovery: read recent vaults from Electron app's storage.json
// ---------------------------------------------------------------------------

function discoverVaultPaths(): string[] {
  // Electron userData path on macOS: ~/Library/Application Support/<appName>
  // The app uses 'kg-extension' as the folder name.
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'kg-extension', 'storage.json'),
    // Linux
    path.join(os.homedir(), '.config', 'kg-extension', 'storage.json'),
    // Windows
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
            .filter((v): v is { path: string } => v && typeof v === 'object' && typeof (v as Record<string, unknown>)['path'] === 'string')
            .map((v) => v.path)
            .filter((p) => fs.existsSync(path.join(p, '.kg', 'graph.db')));
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
            + 'Set OPENAI_API_KEY env var in your MCP client config.'
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

// ---------------------------------------------------------------------------
// Vault registry
// ---------------------------------------------------------------------------

interface VaultEntry {
  name: string;
  vaultPath: string;
  provider: StandaloneGraphProvider;
}

function openVaults(vaultPaths: string[], allowWrite: boolean, init: boolean): VaultEntry[] {
  const entries: VaultEntry[] = [];
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
    entries.push({
      name,
      vaultPath,
      provider: new StandaloneGraphProvider(vaultPath, !allowWrite),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_LIST_VAULTS = {
  name: 'list_vaults',
  description: 'List all connected Synapse vaults.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
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

const TOOL_SEARCH_NODES = {
  name: 'search_nodes',
  description:
    'Search for nodes across all vaults by name. Returns matching nodes tagged with vault name.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Substring to search for in node names.',
      },
      limit: {
        type: 'number',
        description: 'Maximum results per vault (default 10).',
      },
    },
    required: ['query'],
  },
};

const TOOL_GET_NODE_DETAILS = {
  name: 'get_node_details',
  description:
    'Get full details and connected edges for a node by ID. When multiple vaults are loaded, specify the vault parameter.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'Node ID.',
      },
      vault: {
        type: 'string',
        description: 'Vault name (required when multiple vaults are connected).',
      },
    },
    required: ['id'],
  },
};

const TOOL_GET_NEIGHBORS = {
  name: 'get_neighbors',
  description:
    'Get neighboring nodes up to a given depth from a starting node. When multiple vaults are loaded, specify the vault parameter.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      node_id: {
        type: 'string',
        description: 'Starting node ID.',
      },
      depth: {
        type: 'number',
        description: 'Traversal depth (default 1, max 3).',
      },
      vault: {
        type: 'string',
        description: 'Vault name (required when multiple vaults are connected).',
      },
    },
    required: ['node_id'],
  },
};

const TOOL_GET_GRAPH_OVERVIEW = {
  name: 'get_graph_overview',
  description:
    'Get a high-level overview of the knowledge graph: node/edge counts, type distribution, and recent nodes.',
  inputSchema: { type: 'object' as const, properties: {}, required: [] },
};

const TOOL_GET_SUBGRAPH = {
  name: 'get_subgraph',
  description:
    'Extract a subgraph around a seed node. Returns all nodes and edges within the specified depth.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      node_id: { type: 'string', description: 'Seed node ID.' },
      depth: { type: 'number', description: 'Traversal depth (default 1, max 3).' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['node_id'],
  },
};

const TOOL_GET_NODES_BY_TYPE = {
  name: 'get_nodes_by_type',
  description:
    'Get all nodes of a specific type (e.g., "person", "concept", "note").',
  inputSchema: {
    type: 'object' as const,
    properties: {
      type: { type: 'string', description: 'Node type to filter by.' },
      limit: { type: 'number', description: 'Maximum results (default 50).' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['type'],
  },
};

const TOOL_READ_NOTE = {
  name: 'read_note',
  description:
    'Read the markdown content of a note by node ID.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      node_id: { type: 'string', description: 'The note node ID.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['node_id'],
  },
};

const TOOL_LIST_NOTES = {
  name: 'list_notes',
  description:
    'List all notes in the knowledge graph.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Maximum notes to return (default 50).' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: [],
  },
};

const TOOL_SEARCH_NOTES = {
  name: 'search_notes',
  description:
    'Full-text search within note content (bodies and titles).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query.' },
      limit: { type: 'number', description: 'Maximum results (default 10).' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['query'],
  },
};

const TOOL_FIND_SIMILAR_ENTITIES = {
  name: 'find_similar_entities',
  description:
    'Find entities with similar names using fuzzy matching. Use before creating a node to avoid duplicates.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Entity name to search for.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['name'],
  },
};

// --- Write tools (gated by --allow-write) ---

const TOOL_CREATE_NODE = {
  name: 'create_node',
  description: 'Create a new node in the knowledge graph.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Name of the node.' },
      type: { type: 'string', description: 'Type/category (e.g. person, concept, technology).' },
      label: { type: 'string', description: 'Semantic label for entity nodes.' },
      properties: { type: 'object', description: 'Optional key-value properties.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['name', 'type'],
  },
};

const TOOL_UPDATE_NODE = {
  name: 'update_node',
  description: 'Update an existing node\'s name, type, or properties.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      node_id: { type: 'string', description: 'ID of the node to update.' },
      name: { type: 'string', description: 'New name.' },
      type: { type: 'string', description: 'New type.' },
      label: { type: 'string', description: 'New label.' },
      properties: { type: 'object', description: 'Properties to merge.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['node_id'],
  },
};

const TOOL_DELETE_NODE = {
  name: 'delete_node',
  description: 'Delete a node and all its connected edges. Irreversible.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      node_id: { type: 'string', description: 'ID of the node to delete.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['node_id'],
  },
};

const TOOL_CREATE_EDGE = {
  name: 'create_edge',
  description: 'Create a relationship (edge) between two nodes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      source_id: { type: 'string', description: 'Source node ID.' },
      target_id: { type: 'string', description: 'Target node ID.' },
      label: { type: 'string', description: 'Relationship label (e.g. works_at, related_to).' },
      type: { type: 'string', description: 'Relationship category.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['source_id', 'target_id', 'label'],
  },
};

const TOOL_DELETE_EDGE = {
  name: 'delete_edge',
  description: 'Delete a single edge by ID.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      edge_id: { type: 'string', description: 'ID of the edge to delete.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['edge_id'],
  },
};

const TOOL_CREATE_NOTE = {
  name: 'create_note',
  description: 'Create a new note node with markdown content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Title of the note.' },
      content: { type: 'string', description: 'Markdown content.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['title', 'content'],
  },
};

const TOOL_MERGE_NODES = {
  name: 'merge_nodes',
  description: 'Merge two duplicate nodes. Keeps primary, transfers edges from secondary, adds alias, deletes secondary.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      primary_node_id: { type: 'string', description: 'Node ID to KEEP.' },
      secondary_node_id: { type: 'string', description: 'Node ID to merge into primary and DELETE.' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['primary_node_id', 'secondary_node_id'],
  },
};

const TOOL_SEMANTIC_SEARCH = {
  name: 'semantic_search',
  description: 'Find nodes semantically similar to a query using vector embeddings, even without keyword overlap. Requires embeddings to be enabled in the Synapse desktop app and OPENAI_API_KEY env var for standalone MCP mode.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Natural language search query.' },
      limit: { type: 'number', description: 'Max results (default 5).' },
      vault: { type: 'string', description: 'Vault name (when multiple vaults loaded).' },
    },
    required: ['query'],
  },
};

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

function getString(args: ToolArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

function getNumber(args: ToolArgs, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
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

  const vaults = openVaults(vaultPaths, opts.allowWrite, opts.initVault);

  // Helper: resolve vault by name or default to first
  function resolveVault(args: ToolArgs): VaultEntry | { error: string } {
    if (vaults.length === 0) {
      return { error: 'No vaults connected. Use open_vault tool to connect one first.' };
    }
    const vaultName = getString(args, 'vault');
    if (vaults.length > 1 && !vaultName) {
      return { error: `Multiple vaults loaded. Specify "vault" parameter: ${vaults.map((v) => v.name).join(', ')}` };
    }
    if (vaultName) {
      const found = vaults.find((v) => v.name === vaultName);
      if (!found) return { error: `Vault "${vaultName}" not found. Available: ${vaults.map((v) => v.name).join(', ')}` };
      return found;
    }
    return vaults[0];
  }

  // Create MCP server
  const server = new Server(
    { name: 'synapse', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const managementTools = [TOOL_LIST_VAULTS, TOOL_OPEN_VAULT, TOOL_CLOSE_VAULT];
  const readTools = [
    TOOL_SEARCH_NODES, TOOL_GET_NODE_DETAILS, TOOL_GET_NEIGHBORS,
    TOOL_GET_GRAPH_OVERVIEW, TOOL_GET_SUBGRAPH, TOOL_GET_NODES_BY_TYPE,
    TOOL_READ_NOTE, TOOL_LIST_NOTES, TOOL_SEARCH_NOTES, TOOL_FIND_SIMILAR_ENTITIES,
    TOOL_SEMANTIC_SEARCH,
  ];
  const writeTools = [
    TOOL_CREATE_NODE, TOOL_UPDATE_NODE, TOOL_DELETE_NODE,
    TOOL_CREATE_EDGE, TOOL_DELETE_EDGE,
    TOOL_CREATE_NOTE, TOOL_MERGE_NODES,
  ];

  const allTools = opts.allowWrite
    ? [...managementTools, ...readTools, ...writeTools]
    : [...managementTools, ...readTools];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as ToolArgs;

    switch (name) {
      case 'list_vaults': {
        const list = vaults.map((v) => ({ name: v.name, path: v.vaultPath }));
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
      }

      case 'open_vault': {
        const vaultPath = getString(toolArgs, 'path');
        if (!vaultPath) return { content: [{ type: 'text', text: JSON.stringify({ error: 'path is required' }) }], isError: true };
        const resolved = path.resolve(vaultPath);
        const existing = vaults.find((v) => v.vaultPath === resolved);
        if (existing) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'already_connected', name: existing.name, path: existing.vaultPath }) }] };
        }
        const shouldInit = toolArgs.init === true;
        if (shouldInit) {
          StandaloneGraphProvider.initVault(resolved);
          process.stderr.write(`Initialized vault at ${resolved}\n`);
        }
        const dbPath = path.join(resolved, '.kg', 'graph.db');
        if (!fs.existsSync(dbPath)) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `No graph.db at ${dbPath}. Use init: true to create one.` }) }], isError: true };
        }
        const name = path.basename(resolved);
        const entry: VaultEntry = { name, vaultPath: resolved, provider: new StandaloneGraphProvider(resolved, !opts.allowWrite) };
        vaults.push(entry);
        process.stderr.write(`Connected vault: ${name} (${resolved})\n`);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'connected', name, path: resolved }) }] };
      }

      case 'close_vault': {
        const vaultName = getString(toolArgs, 'vault');
        if (!vaultName) return { content: [{ type: 'text', text: JSON.stringify({ error: 'vault name is required' }) }], isError: true };
        const idx = vaults.findIndex((v) => v.name === vaultName);
        if (idx === -1) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Vault "${vaultName}" not found. Available: ${vaults.map((v) => v.name).join(', ')}` }) }], isError: true };
        }
        vaults[idx].provider.close();
        vaults.splice(idx, 1);
        process.stderr.write(`Disconnected vault: ${vaultName}\n`);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'disconnected', name: vaultName }) }] };
      }

      case 'search_nodes': {
        const query = getString(toolArgs, 'query');
        if (!query) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }) }], isError: true };
        }
        const limit = getNumber(toolArgs, 'limit') ?? 10;

        const allResults: Array<Record<string, unknown>> = [];
        for (const vault of vaults) {
          const { result, isError } = vault.provider.searchNodes(query, limit);
          if (!isError) {
            const rows = JSON.parse(result) as Record<string, unknown>[];
            for (const row of rows) {
              allResults.push({ ...row, _vault: vault.name });
            }
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(allResults, null, 2) }] };
      }

      case 'get_node_details': {
        const id = getString(toolArgs, 'id');
        if (!id) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'id is required' }) }], isError: true };
        }
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const { result, isError } = vault.provider.getNodeDetails(id);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_neighbors': {
        const nodeId = getString(toolArgs, 'node_id');
        if (!nodeId) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'node_id is required' }) }], isError: true };
        }
        const rawDepth = getNumber(toolArgs, 'depth') ?? 1;
        const depth = Math.min(rawDepth, 3);
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const { result, isError } = vault.provider.getNeighbors(nodeId, depth);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_graph_overview': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const { result, isError } = vault.provider.getGraphOverview();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_subgraph': {
        const nodeId = getString(toolArgs, 'node_id');
        if (!nodeId) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'node_id is required' }) }], isError: true };
        }
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const sgDepth = Math.min(getNumber(toolArgs, 'depth') ?? 1, 3);
        const { result, isError } = vault.provider.getSubgraph(nodeId, sgDepth);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_nodes_by_type': {
        const type = getString(toolArgs, 'type');
        if (!type) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'type is required' }) }], isError: true };
        }
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const limit = getNumber(toolArgs, 'limit') ?? 50;
        const { result, isError } = vault.provider.getNodesByType(type, limit);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'read_note': {
        const nodeId = getString(toolArgs, 'node_id');
        if (!nodeId) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'node_id is required' }) }], isError: true };
        }
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const notesDir = vault.vaultPath;
        const { result, isError } = vault.provider.readNote(nodeId, notesDir);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'list_notes': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const limit = getNumber(toolArgs, 'limit') ?? 50;
        const { result, isError } = vault.provider.listNotes(limit);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'search_notes': {
        const query = getString(toolArgs, 'query');
        if (!query) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }) }], isError: true };
        }
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const limit = getNumber(toolArgs, 'limit') ?? 10;
        const { result, isError } = vault.provider.searchNotes(query, limit);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'find_similar_entities': {
        const entityName = getString(toolArgs, 'name');
        if (!entityName) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'name is required' }) }], isError: true };
        }
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const { result, isError } = vault.provider.findSimilarEntities(entityName);
        return { content: [{ type: 'text', text: result }], isError };
      }

      // --- Write tools ---

      case 'create_node': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const nodeName = getString(toolArgs, 'name');
        const nodeType = getString(toolArgs, 'type');
        if (!nodeName || !nodeType) return { content: [{ type: 'text', text: JSON.stringify({ error: 'name and type are required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.createNode(nodeName, nodeType, getString(toolArgs, 'label'), toolArgs.properties as Record<string, unknown>);
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'update_node': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const nodeId = getString(toolArgs, 'node_id');
        if (!nodeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'node_id is required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.updateNode(nodeId, {
          name: getString(toolArgs, 'name'),
          type: getString(toolArgs, 'type'),
          label: getString(toolArgs, 'label'),
          properties: toolArgs.properties as Record<string, unknown> | undefined,
        });
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'delete_node': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const nodeId = getString(toolArgs, 'node_id');
        if (!nodeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'node_id is required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.deleteNode(nodeId);
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'create_edge': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const sourceId = getString(toolArgs, 'source_id');
        const targetId = getString(toolArgs, 'target_id');
        const label = getString(toolArgs, 'label');
        if (!sourceId || !targetId || !label) return { content: [{ type: 'text', text: JSON.stringify({ error: 'source_id, target_id, and label are required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.createEdge(sourceId, targetId, label, getString(toolArgs, 'type'));
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'delete_edge': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const edgeId = getString(toolArgs, 'edge_id');
        if (!edgeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'edge_id is required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.deleteEdge(edgeId);
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'create_note': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const title = getString(toolArgs, 'title');
        const content = getString(toolArgs, 'content');
        if (!title || !content) return { content: [{ type: 'text', text: JSON.stringify({ error: 'title and content are required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.createNote(title, content, vault.vaultPath);
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'merge_nodes': {
        if (!opts.allowWrite) return { content: [{ type: 'text', text: 'Write access not enabled. Use --allow-write flag.' }], isError: true };
        const primaryId = getString(toolArgs, 'primary_node_id');
        const secondaryId = getString(toolArgs, 'secondary_node_id');
        if (!primaryId || !secondaryId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'primary_node_id and secondary_node_id are required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.mergeNodes(primaryId, secondaryId);
        if (!isError) notifyApp();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'semantic_search': {
        const query = getString(toolArgs, 'query');
        if (!query) return { content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }) }], isError: true };
        const limit = getNumber(toolArgs, 'limit') ?? 5;
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = await vault.provider.semanticSearch(query, limit);
        return { content: [{ type: 'text', text: result }], isError };
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
  });

  // Cleanup on exit
  function cleanup(): void {
    for (const vault of vaults) {
      try {
        vault.provider.close();
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
