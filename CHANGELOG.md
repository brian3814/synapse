# Changelog

All notable changes to Synapse will be documented in this file.

## [Unreleased]

### Added
- Tiered label visibility: H3-inspired progressive label disclosure — hub nodes (high relationship count) show labels first when zoomed out, lower-tier nodes fade in as you zoom closer
- Adaptive tier bucketing: nodes ranked into 6 tiers by edge count using percentile-based assignment; small graphs (≤40 nodes) bypass tiering to keep all labels visible
- Per-tier opacity fade-in: labels smoothly transition from transparent to opaque as each tier's zoom threshold is crossed
- Debounced tier recomputation: tier assignments automatically update within 200ms of graph mutations (edge/node create/delete)
- Settings → Agents page: assign which agent extraction uses and the default chat agent (chat header picker still overrides per conversation)
- Custom extraction agents can be created from the Agents panel
- Multi-provider LLM architecture: `ModelProvider` interface with provider registry, Anthropic implementation with dynamic model fetching via `/v1/models` API
- Settings model dropdown now fetches available models from the provider API on key entry, with static fallback on error and inline pricing display
- Per-provider API key storage with independent OS keychain encryption
- Per-agent model override: `modelProvider` and `modelId` fields on agent definitions with resolution chain (agent → global fallback), supported in frontmatter

### Fixed
- Agent custom instructions now actually reach extraction: all four extraction modes (text, page, agent, file ingestion) read the configured extraction agent instead of a legacy settings key that nothing had written since 0.3.0
- Artifact list in side rail not updating when artifacts are created during chat — `initArtifactStoreListener()` was implemented but never called at startup
- Settings model dropdown showed deprecated Sonnet 4 and Haiku 4 model IDs; updated fallback list to current Anthropic lineup (Opus 4.8, Sonnet 4.6, Haiku 4.5)
- Intelligence tools (domain synthesis, gap analysis) used hardcoded deprecated model ID instead of the user's configured model
- Reading list handler fallback model updated from retired `claude-sonnet-4-5-20241022` to `claude-sonnet-4-6`

## [0.5.0] - 2026-06-11

### Added
- Vault recovery modal: opening a recent vault whose `.kg` folder was deleted or cleaned up now shows a modal dialog explaining the issue and offering to reinitialize the vault as a fresh workspace, preserving existing user files
- Stale vault cleanup: dismissing the recovery modal automatically removes the broken entry from the recent vaults list
- VaultManager test suite covering `open()` error paths, `reinitialize()`, and `removeFromRecent()`
- Migration test suite driving the real migration runner against in-memory SQLite: drifted-vault fixture, atomic-rollback re-entry test, and data-preservation tests for the schema rebuilds

### Changed
- Database migrations now apply atomically (`BEGIN IMMEDIATE`/`COMMIT` with rollback) — an interrupted migration can no longer leave a vault part-migrated and unable to start
- `embedding_metadata` reduced to `(node_id, text_hash)`; existing embeddings regenerate lazily after migration
- Standalone MCP CLI initializes vaults by running the canonical migration chain (001–014) instead of a separately-maintained schema copy, so CLI-created vaults are schema-identical to app vaults

### Fixed
- Opening a recent vault with a missing `.kg` folder showed a cryptic "No vault found" error instead of actionable recovery options
- Vaults created by the standalone MCP CLI were stamped schema v11 with missing tables (`source_content`, `reading_list_history`, note FTS) and incompatibly-shaped embedding tables, crashing the shared embedding service and `get_source_content`; migration 014 repairs existing drifted vaults
- `open_vault` MCP tool with `init: true` raced tool execution against in-flight migrations (unawaited init)
- Chrome extension build broken by a stale 4-argument `addItem` call in ExtractionReviewTab

### Removed
- Migration 014 drops six dead tables (`extraction_log`, `note_folders`, `indexed_files`, `memory_semantic`, `memory_episodic`, `embedding_dismissals`) and dead columns across eight tables (`nodes.z`/`content_type`/`folder_path`, `edges.source_url`, `chat_messages.rag_context`, `chat_sessions.preset_id`, never-implemented ontology constraint columns, `source_content.content_hash`, `reading_list_history.node_ids`, redundant duplicate timestamps), plus all their orphaned query/repository plumbing
- DB-backed agent memory tables removed entirely — files in `.kg/agent/memory/` are the sole memory store

## [0.4.0] - 2026-06-09

### Added
- Artifact system: LLM-generated content (dashboards, documents, diagrams) persisted as first-class objects in the vault
- Five artifact types: JSX (React components), Markdown, HTML, SVG, Mermaid diagrams
- `create_artifact` and `update_artifact` chat agent tools with full-replacement update model
- Artifact storage in `.kg/artifacts/` grouped by chat session with human-readable directory/file names and sidecar `.meta.json` metadata
- SQLite `artifacts` table with FTS5 full-text search index
- Artifacts panel in left sidebar with search bar and type filter chips
- Artifact content tab with Preview/Source toggle and CodeMirror 6 editor
- Sandboxed JSX renderer: iframe with custom `artifact-sandbox://` Electron protocol, Sucrase transpilation, pre-bundled React 19 + Recharts + D3 (1.1MB vendor bundle via esbuild)
- ArtifactCard component in chat messages with type-specific icons and "Open" button
- Artifacts icon in activity bar (third position after Explorer and Agents)
- File watcher integration for external artifact edits with automatic SQLite re-sync
- Artifact instructions in chat agent system prompt with explicit library restrictions
- Mermaid diagram rendering via mermaid.js with error fallback
- SVG rendering via blob URL, HTML rendering via sandboxed iframe

### Changed
- `max_tokens` for chat streaming increased from 4096 to 16384 to support artifact tool calls with large content payloads
- `ContentTabType` extended with `artifact` variant, `LeftPanel` extended with `artifacts`
- `CommandContext` extended with optional `PlatformArtifacts` for artifact tool execution in main process
- `BuiltinToolProvider` categorizes artifact tools as write operations

### Fixed
- Chat agent silently failing to create artifacts due to `max_tokens: 4096` truncating tool calls mid-response
- Sandbox CORS errors from null-origin iframe loading CDN scripts — resolved by bundling vendor libs locally via custom Electron protocol

## [0.3.0] - 2026-06-07

### Added
- Agent management panel in the left sidebar with per-agent tool isolation
- AgentDefinition format using `.md` files with YAML frontmatter (Claude Code convention)
- ActivityBar: vertical icon rail replacing the single-icon vault drawer toggle
- AgentPicker: chat header dropdown replacing PresetPicker, with "Manage Agents..." link
- Two-layer tool enforcement: `allowedTools` on ToolFilter (listing) + execution-time validation in `tools:execute` IPC
- Per-agent MCP server scoping via `mcpServers` field
- Vault-scoped custom agents via `.kg/agents/*.md` files
- Agent store (Zustand) as single source of truth for agent configuration
- Migration from legacy `agentPromptConfig`/`agentToolConfig`/`harnessPresets` on first load
- Dynamic tool categorization from ToolRegistry data instead of hardcoded lists
- Extraction tools now injectable via `AgentLoopConfig.tools` parameter

### Changed
- Left sidebar: VaultDrawer icon rail extracted into reusable ActivityBar with switchable panels
- Chat agent loop: `getToolDefs()` accepts `AgentToolFilter` instead of plain `disabledTools` string array
- `useChatSession`: reads from agent store instead of 3 scattered `storage.get()` calls with `(storageData as any)` casts
- Agent tab removed from Settings modal; VaultSandbox moved to General tab

### Removed
- Dead `handleAgentRun` broadcast path in `llm-backend.ts` (silently dropped customInstructions and disabledTools)
- PresetPicker component (replaced by AgentPicker)
- `AGENT_RUN_START` case in Electron's `handleRuntimeMessage`

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