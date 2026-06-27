/**
 * Standalone context factory for direct-SQLite mode.
 *
 * Builds a CommandContext backed by a better-sqlite3 database opened at
 * `vaultPath/.synapse/graph.db`.  Used by the standalone MCP CLI so it can
 * share the DefaultKnowledgeService with the Electron main process instead of
 * maintaining its own 900-line tool dispatch layer.
 *
 * Usage:
 *   const ctx = await createStandaloneContext(db, vaultPath);
 *   const service = new DefaultKnowledgeService(ctx);
 */

import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { setEngine } from '../../db/worker/query-executor';
import { createSqliteDataStore } from '../../db/sqlite-data-store';
import type { CommandContext } from '../../commands/types';
import type { DataStore } from '../../db/data-store';
import type {
  PlatformStorage,
  PlatformNotes,
  PlatformFiles,
  PlatformLLM,
  PlatformBrowser,
} from '../../platform/types';
import type { SemanticSearchResult } from '../../embeddings/types';

// ---------------------------------------------------------------------------
// Engine wiring — adapts a better-sqlite3 Database to the global query engine
// ---------------------------------------------------------------------------

/**
 * Wire a better-sqlite3 Database instance into the global query engine.
 *
 * IMPORTANT: The query engine is a global singleton.  When multiple vaults are
 * open simultaneously, you must call `wireEngine(db)` before dispatching any
 * DataStore operations to ensure the correct database receives the queries.
 * MCP stdio is single-threaded, so calling this before each tool dispatch is safe.
 */
export function wireEngine(db: Database.Database): void {
  setEngine({
    async exec(sql: string, params?: unknown[]): Promise<number> {
      if (params && params.length > 0) {
        return db.prepare(sql).run(...params).changes;
      }
      db.exec(sql);
      return 0;
    },
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> {
      if (params && params.length > 0) {
        return db.prepare(sql).all(...params) as T[];
      }
      return db.prepare(sql).all() as T[];
    },
    async checkModuleAvailable(moduleName: string): Promise<boolean> {
      try {
        const rows = db
          .prepare('SELECT name FROM pragma_module_list WHERE name = ?')
          .all(moduleName) as { name: string }[];
        return rows.length > 0;
      } catch {
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Filesystem-backed PlatformNotes
// ---------------------------------------------------------------------------

function createFilesystemNotes(vaultPath: string, db: Database.Database): PlatformNotes {
  const notesDir = path.join(vaultPath, 'notes');

  return {
    async init() {
      fs.mkdirSync(notesDir, { recursive: true });
    },

    async read(nodeId: string): Promise<string | null> {
      // First check if node has a vault_path (file-backed note)
      const row = db
        .prepare('SELECT vault_path FROM nodes WHERE id = ?')
        .get(nodeId) as { vault_path: string | null } | undefined;

      if (row?.vault_path) {
        const absPath = path.join(vaultPath, row.vault_path);
        if (fs.existsSync(absPath)) {
          return fs.readFileSync(absPath, 'utf-8');
        }
      }

      // Fallback: check notes/{nodeId}.md
      const notePath = path.join(notesDir, `${nodeId}.md`);
      if (fs.existsSync(notePath)) {
        return fs.readFileSync(notePath, 'utf-8');
      }

      return null;
    },

    async write(nodeId: string, markdown: string): Promise<void> {
      fs.mkdirSync(notesDir, { recursive: true });
      const notePath = path.join(notesDir, `${nodeId}.md`);
      fs.writeFileSync(notePath, markdown, 'utf-8');
    },

    async remove(nodeId: string): Promise<void> {
      const notePath = path.join(notesDir, `${nodeId}.md`);
      if (fs.existsSync(notePath)) {
        fs.unlinkSync(notePath);
      }
    },

    async list(): Promise<string[]> {
      if (!fs.existsSync(notesDir)) return [];
      return fs
        .readdirSync(notesDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''));
    },

    async exists(nodeId: string): Promise<boolean> {
      const notePath = path.join(notesDir, `${nodeId}.md`);
      return fs.existsSync(notePath);
    },
  };
}

// ---------------------------------------------------------------------------
// No-op stubs for platform interfaces not relevant to CLI
// ---------------------------------------------------------------------------

const noopStorage: PlatformStorage = {
  get: async () => ({} as any),
  set: async () => {},
  remove: async () => {},
  onChange: () => () => {},
};

const noopFiles: PlatformFiles = {
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  list: async () => [],
};

const noopLLM: PlatformLLM = {
  streamExtraction: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
  runAgent: async () => {},
  streamChat: async () => ({
    textContent: '',
    toolCalls: [],
    stopReason: 'end_turn',
    inputTokens: 0,
    outputTokens: 0,
  }),
} as any;

const noopBrowser: PlatformBrowser = {
  getActiveTab: async () => null,
  getPageContent: async () => '',
  executeTool: async () => '',
  onPageCapture: () => () => {},
  onReadingQueue: () => () => {},
} as any;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StandaloneContextOptions {
  embedding?: {
    searchSimilar(query: string, topK?: number): Promise<SemanticSearchResult[]>;
  };
}

/**
 * Build a CommandContext for a better-sqlite3 database.
 *
 * The context reuses the shared `createSqliteDataStore` so the standalone CLI
 * gets the same 16-repository DataStore as the Electron main process.
 *
 * @param db   An already-opened better-sqlite3 Database instance
 * @param vaultPath  Absolute path to the vault root directory
 * @param opts  Optional dependencies (e.g. embedding service)
 */
export async function createStandaloneContext(
  db: Database.Database,
  vaultPath: string,
  opts?: StandaloneContextOptions,
): Promise<CommandContext> {
  // Wire better-sqlite3 into the global query engine
  wireEngine(db);

  // Build DataStore via the shared delegation layer (runs migrations on init)
  const dataStore: DataStore = createSqliteDataStore(
    async () => {
      // initEngine is a no-op — the DB is already open and engine is wired
    },
    async () => {
      // resetEngine — re-wire to pick up any DB changes
      wireEngine(db);
    },
  );

  // Initialize (runs migrations)
  await dataStore.init();

  // Build filesystem notes adapter
  const notes = createFilesystemNotes(vaultPath, db);

  return {
    db: dataStore,
    storage: noopStorage,
    notes,
    files: noopFiles,
    llm: noopLLM,
    browser: noopBrowser,
    embedding: opts?.embedding,
    getGraphSnapshot: async () => {
      const nodes = await dataStore.nodes.getAll();
      const edges = await dataStore.edges.getAll();
      return { nodes: nodes as any, edges: edges as any };
    },
  };
}
