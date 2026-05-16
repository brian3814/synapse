import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StandaloneGraphProvider } from './standalone-provider.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  vaultPaths: string[];
  allowWrite: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const vaultPaths: string[] = [];
  let allowWrite = false;

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
    } else if (arg === '--help' || arg === '-h') {
      process.stderr.write(
        'Usage: synapse-mcp [--vault <path>]... [--allow-write]\n\n' +
        '  --vault <path>   Path to a Synapse vault (can repeat for multiple vaults).\n' +
        '                   If omitted, auto-discovers from recent vaults.\n' +
        '  --allow-write    Open vault DB in read-write mode (default: read-only).\n'
      );
      process.exit(0);
    }
  }

  return { vaultPaths, allowWrite };
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
// Vault registry
// ---------------------------------------------------------------------------

interface VaultEntry {
  name: string;
  vaultPath: string;
  provider: StandaloneGraphProvider;
}

function openVaults(vaultPaths: string[], allowWrite: boolean): VaultEntry[] {
  const entries: VaultEntry[] = [];
  for (const vaultPath of vaultPaths) {
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
    if (vaultPaths.length === 0) {
      process.stderr.write(
        'Error: No vaults found. Use --vault <path> or open Synapse app first.\n'
      );
      process.exit(1);
    }
    process.stderr.write(`Auto-discovered vaults: ${vaultPaths.join(', ')}\n`);
  }

  const vaults = openVaults(vaultPaths, opts.allowWrite);
  if (vaults.length === 0) {
    process.stderr.write('Error: None of the specified vaults have a valid graph.db.\n');
    process.exit(1);
  }

  const multiVault = vaults.length > 1;

  // Helper: resolve vault by name or default to first
  function resolveVault(args: ToolArgs): VaultEntry | { error: string } {
    const vaultName = getString(args, 'vault');
    if (multiVault && !vaultName) {
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOL_LIST_VAULTS, TOOL_SEARCH_NODES, TOOL_GET_NODE_DETAILS, TOOL_GET_NEIGHBORS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as ToolArgs;

    switch (name) {
      case 'list_vaults': {
        const list = vaults.map((v) => ({ name: v.name, path: v.vaultPath }));
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
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
        const depth = Math.min(rawDepth, 3); // cap at 3 to avoid runaway queries
        const vault = resolveVault(toolArgs);
        if ('error' in vault) {
          return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        }
        const { result, isError } = vault.provider.getNeighbors(nodeId, depth);
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
