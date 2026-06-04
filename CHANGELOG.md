# Changelog

All notable changes to Synapse will be documented in this file.

## [0.2.0] - 2026-06-05

### Added
- Content-hash-based rename detection: files moved via Finder while the app is off are matched by SHA-256 hash, preserving node identity, edges, and metadata
- Bidirectional note reconciliation: `.md` files added to `notes/` while offline are auto-imported as note nodes with FTS indexing
- Live external note change detection: edits made in external editors while Synapse is running trigger re-indexing and re-embedding
- NoteEditor conflict prompt: modal dialog when external changes conflict with unsaved edits ("Load external changes" / "Keep my version")
- `file:changed` event: modified files now trigger re-embedding and renderer notification (previously only mtime/size were updated silently)
- Hash backfill: first startup after upgrade hashes all tracked files for future rename detection
- Graph-aware embedding strategy: neighbor context (node names + edge labels) included in embedding text for richer semantic search
- Embedding strategy toggle in Settings UI
- Test infrastructure: vitest with 30 integration tests covering reconciliation, rename detection, note creation, and handler behavior
- `npm test` / `npm run dev:electron` auto-rebuild native modules for the correct runtime

### Changed
- Vault reconciliation rewritten as 6-phase algorithm (walk, classify, orphan, rename-match, new files, modified + backfill)
- MCP bridge `onGraphMutated` passes affected node/edge IDs for targeted cascade re-embedding

## [0.1.2] - 2026-05-29

### Added
- Vault explorer drawer with filesystem tree, file viewer, and drag-and-drop import
- Reading list: multi-URL paste modal with live validation preview (duplicate, HTTP, invalid detection)
- Reading list: async title extraction from page `<title>` with LLM fallback for missing titles
- Reading list: enhanced relative time display (weeks, months, years) with "Added X ago" format
- Reading list: HTTP insecure connection indicator on item cards
- MCP server: vector embeddings support (ONNX provider made Electron-free, per-vault initialization)

### Changed
- Reading list `addItem` auto-resolves vault internally (removed vault selection from add flow)
- MCP ONNX provider refactored with configurable `cacheDir`/`workerPath` for standalone use

### Fixed
- MCP stdio: redirect console output to stderr to avoid corrupting JSON-RPC protocol
- Publish: include `docs/images` in public repo

## [0.1.1] - 2025-05-24

### Fixed
- Package `sqlite-vec` as production dependency so it loads in the built app
- Unpack native modules (`sqlite-vec-*`, `better-sqlite3`) from asar

## [0.1.0] - 2025-05-24

Initial release.

### Added
- Local-first knowledge graph with SQLite persistence
- 2D graph visualization (Three.js InstancedMesh renderer with Web Worker force layout)
- LLM-powered entity extraction (text, agent, and file ingestion modes)
- Extraction review UI for approving/editing entities before merge
- Chat agent with tool use (graph queries, note creation, web search)
- Vault-based workspace with multi-vault support
- Markdown note storage synced to filesystem
- MCP server and client integration
- Agent settings with prompt customization and tool toggles