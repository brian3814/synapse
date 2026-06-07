# CLAUDE.md

## Project Overview

**Synapse** — local-first knowledge graph with SQLite persistence, 2D graph visualization (custom Three.js renderer with InstancedMesh), and LLM-powered entity extraction. Primarily an **Electron desktop app** with a vault-based workspace. The **Chrome extension** is deprecated (maintenance mode only, no new features).

## Build Commands

```bash
# Electron desktop (primary)
npm run build:electron           # Both main + renderer
npm run build:electron-main      # esbuild main process → dist-electron/main/
npm run build:electron-renderer  # Vite renderer build → dist-electron/renderer/
npm run dist:mac                 # Package macOS app via electron-builder

# Chrome extension (deprecated)
npm run build                    # Vite production build → dist/
npm run dev                      # Vite build in watch mode

# Other
npm run build:companion          # Companion extension → dist-companion/
npm run build:mcp                # MCP CLI → packages/synapse-mcp/dist/
```

No test framework or linter is configured. For Electron, run `npx electron .` after building.

## Architecture at a Glance

```
UI (React + Zustand) → @platform (build-time alias) → Background Service → External (SQLite, LLM, FS)
```

- **Platform abstraction**: UI imports `@platform` — never touches `chrome.*` or `ipcRenderer` directly. Seven interfaces (`PlatformStorage`, `PlatformDB`, `PlatformNotes`, `PlatformLLM`, `PlatformBrowser`, `PlatformEmbedding`, `PlatformVault`). See [`docs/platform-layer.md`](docs/platform-layer.md).
- **Vault**: Single user-chosen directory containing graph DB, notes, user files, embeddings. Graph DB is source of truth; filesystem is a projection. See [`docs/vault-architecture.md`](docs/vault-architecture.md).
- **Database**: Three abstraction levels (db-client → PlatformDB → DataStore interface → SQLite). 16 repository sub-interfaces. See [`docs/database-layer.md`](docs/database-layer.md).
- **Graph renderer**: Custom Three.js InstancedMesh renderer with Web Worker force layout. See [`docs/graph-renderer.md`](docs/graph-renderer.md).
- **LLM extraction**: Three modes (text, agent, file ingestion) → shared review flow → graph merge. See [`docs/llm-extraction.md`](docs/llm-extraction.md).
- **Vector embeddings**: Opt-in sqlite-vec + ONNX/OpenAI for semantic search. Electron-only. See [`docs/vector-embeddings.md`](docs/vector-embeddings.md).
- **Memory harness**: Governed agent memory with retrieval pipeline (metadata scoring → RRF fusion → annotated formatting). See [`docs/memory-harness.md`](docs/memory-harness.md).
- **MCP integration**: Synapse is both MCP client and server. Unified ToolRegistry in main process. See [`docs/mcp-integration.md`](docs/mcp-integration.md).
- **Chat agent tools**: Core + extended tool modules with ToolRegistry execution. See [`docs/chat-agent-tools.md`](docs/chat-agent-tools.md).
- **Agent management**: Per-agent tool isolation with `.md` frontmatter definitions, left sidebar panel, `ToolFilter` enforcement at listing + execution layers. See [`docs/agent-settings.md`](docs/agent-settings.md).
- **Build system**: Two Vite configs (Chrome/Electron) + esbuild for main process. See [`docs/build-system.md`](docs/build-system.md).

## Key Conventions

- **API keys** stay in app settings (`~/Library/Application Support/`), never in the vault.
- **`@platform` alias** must exist in EVERY `resolve.alias` block across all Vite build configs.
- **Shared core** (`src/core/`): Zero imports from `@platform`; all dependencies injected via `CommandContext`.
- **LLM provider abstraction**: `electron/llm-backend.ts` — provider factory with `registerStreamFn()`. Renderer never knows which provider is active.
- **State management**: Eleven independent Zustand stores in `src/graph/store/` (graph, ui, llm, node-type, extraction-review, agent).
- **Note storage**: `.md` files on disk, NOT in SQLite. Access via `import { notes } from '@platform'`. See [`docs/adr-opfs-note-storage.md`](docs/adr-opfs-note-storage.md).
- **Graph store sync**: Subscribes to both BroadcastChannel and IPC for real-time cross-source updates.

## Key Type/Reference Files

- `src/platform/types.ts` — All platform interfaces
- `src/shared/types.ts` — `DbNode`, `DbEdge`, `GraphNode`, `GraphEdge`, `LLMConfig`, `ToolCall`, `AgentTurn`
- `src/shared/chat-agent-tools.ts` — Tool definitions
- `src/shared/constants.ts` — Color palette, timeouts, LLM model IDs
- `src/core/llm-protocol.ts` — Provider-neutral `LLMMessage`, `StreamFn`, `LLMStreamResult`
- `src/db/data-store.ts` — DataStore interface (16 repository sub-interfaces)
- `src/shared/agent-definition-types.ts` — `AgentDefinition`, `AgentToolFilter`, frontmatter parser, `toToolFilter()`
- `src/shared/agent-settings-types.ts` — Legacy `AgentPromptConfig`, `AgentToolConfig`, `VaultSandboxConfig`
- `src/shared/messages.ts` — Chrome-internal message protocol (UI code should NOT import — use `@platform`)

## Path Aliases

- `@/` → `src/`
- `@platform` → `src/platform/chrome/` (Chrome build) or `src/platform/electron/` (Electron build)

## Documentation Index

| Doc | Content |
|---|---|
| [`docs/vault-architecture.md`](docs/vault-architecture.md) | Vault layout, event bus, file watcher, reconciliation, multi-vault |
| [`docs/platform-layer.md`](docs/platform-layer.md) | Eight interfaces, Chrome/Electron contexts, API key security |
| [`docs/build-system.md`](docs/build-system.md) | Vite configs, esbuild, CSP constraints, outputs |
| [`docs/database-layer.md`](docs/database-layer.md) | DataStore interface, migrations, note storage, state management |
| [`docs/graph-renderer.md`](docs/graph-renderer.md) | Three.js renderer, layout worker, pitfalls #14–#23 |
| [`docs/llm-extraction.md`](docs/llm-extraction.md) | Extraction modes, review flow, ingestion pipeline |
| [`docs/vector-embeddings.md`](docs/vector-embeddings.md) | sqlite-vec, ONNX/OpenAI providers, Chrome isolation |
| [`docs/memory-harness.md`](docs/memory-harness.md) | Memory file schema, retrieval pipeline, prompt assembly |
| [`docs/mcp-integration.md`](docs/mcp-integration.md) | ToolRegistry, MCP server/client, config, real-time sync |
| [`docs/chat-agent-tools.md`](docs/chat-agent-tools.md) | Core/extended tools, execution flow, context selection |
| [`docs/agent-settings.md`](docs/agent-settings.md) | Agent definitions, tool isolation harness, sidebar UI, chat integration |
| [`docs/adr-opfs-note-storage.md`](docs/adr-opfs-note-storage.md) | Note storage ADR |
| [`docs/search.md`](docs/search.md) | FTS5 sanitization, LIKE fallback, UI debounce |
| [`docs/pitfalls/`](docs/pitfalls/) | Detailed Chrome extension pitfall writeups |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full system design, SQLite schema |
