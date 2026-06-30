# Changelog

All notable changes to Synapse will be documented in this file.

## [Unreleased]

## [0.13.0] - 2026-06-30

### Added
- **UI Scale preference**: 5-step zoom slider (Small / Compact / Default / Large / X-Large) in Settings → General, powered by Electron's `webFrame.setZoomFactor()` — persisted and restored on app startup
- **Vault settings tab**: vault-related settings (vault info, embeddings, file import, sandbox, stress test, danger zone) moved from General to a dedicated Vault tab for cleaner organization

### Changed
- General settings tab streamlined to app-wide preferences: Appearance (UI Scale), Contextual Relevance, Reading List

## [0.12.0] - 2026-06-30

### Added
- **Vault cleanup modal**: multi-step destructive action flow replacing inline confirm/cancel in Danger Zone — confirmation step, vault path verification with copy button, and granular category selection tree
- **Selective data cleanup**: choose which data to delete — graph data, chat history, artifacts, memories, notes, vault files — each with live count badges and per-category progress indicators
- **TabErrorBoundary**: tab content wrapped in error boundaries so render crashes show inline error details (with component stack in dev mode) instead of blanking the entire UI
- `vault:clear-all` IPC handler for bulk vault file cleanup
- 29 TDD tests for vault cleanup logic (path matching, category selection, deletion ordering, error handling)

### Fixed
- **Agent panel crash**: clicking an agent card blanked the UI — `useState`/`useRef` hooks in `AgentDetailDrawer` were placed after a conditional early return, violating React's Rules of Hooks

## [0.11.0] - 2026-06-30

### Added
- **UI redesign**: consolidated ActivityBar with 3 groups (Library / Workspace / Tools) replacing scattered Header toolbar buttons
- **Content tabs**: ReadingList, Notes, Intelligence, Query, Agents, and Artifacts now open as main-area content tabs instead of sidebar panels
- **Floating graph panels**: node/edge detail and create panels float inside the graph pane (bounded to graph column in split-view), replacing the fixed right-side ActivePanel column
- **Resizable graph detail panel**: drag left edge to resize, max 30% of graph pane width
- **Agent management view**: grid/list toggle with 2-column responsive cards, detail drawer (resizable 260–480px), sub-tabs for Agents/Connections/MCP Server
- **Command palette** (⌘K): centered modal overlay with type filter tabs, keyboard navigation, match highlighting, semantic vector fallback
- **Artifact browser**: content tab with split-pane list + inline preview using existing type-specific renderers, "Open in Tab" for full editing
- **Chat history sidebar**: left panel listing conversations grouped by date, with session loading, ⋮ options menu (rename/delete), auto-refresh on new sessions
- **Custom tooltip component**: 500ms hover delay, replaces native HTML title attributes across header buttons
- Chat DB operations: `deleteSession` and `updateSessionTitle` wired through full stack

### Changed
- Header simplified to logo, vault switcher, search icon (⌘K), settings gear
- ActivityBar width increased from 32px to 40px
- Graph toolbar styling: rounded-lg corners, z-10 layering
- Node/edge detail panels organized into sections with separators
- Inbox badge counts only 'ready' items (not 'complete')
- Search bar replaced with icon button showing tooltip "Search (⌘K)"
- Create button removed from header (available in graph toolbar)
- Theme toggle commented out until light theme is built

### Removed
- `ActivePanel` component and right-side panel column
- Header toolbar buttons for ReadingList, Query, LLM Extract, Notes, Intelligence

### Tests
- 23 TDD tests for chat history DB operations (session CRUD, lifecycle, messages, integration)
- 9 tests for inbox badge count logic

## [0.10.1] - 2026-06-29

### Changed
- `useLLMExtraction` hook refactored into `extractionActions` module — 8 stateless async functions exported directly instead of wrapped in unnecessary `useCallback`/hook pattern
- Scattered imports in the extraction module consolidated at the top of the file

### Fixed
- Existing vaults at schema v11-v13 threw a fatal error on startup instead of migrating incrementally — implemented migration steps v12 (content_hash column), v13 (artifacts table), and v14 (schema cleanup: dead table/column drops, table rebuilds) with per-migration atomic transactions and rollback support

## [0.10.0] - 2026-06-29

### Added
- Extraction regeneration with feedback: "Regenerate with feedback" button in the review step lets users describe how extraction should differ, then re-runs with the previous results included in the prompt so the LLM knows what to change
- Reading list panel card updates to "processing" during regeneration if the resource came from the reading list

### Changed
- Unified extraction progress UI: all extraction paths (LLM panel, quick extraction, regeneration) now use the same `ExtractionProgressPanel` component with stage-based progress (fetch/extract/validate), matching the Chrome companion extraction flow
- `ExtractionProgressPanel` stages are now dynamic — only stages that receive events are shown, so text extraction shows 2 stages while page extraction shows 3

## [0.9.0] - 2026-06-26

### Added
- MCP shared core: unified `KnowledgeService` with one implementation for both Electron and standalone CLI — replaces dual codebases with a single shared server
- 8 consolidated MCP tools (`search`, `get_entity`, `get_neighbors`, `manage_entity`, `manage_relationship`, `merge_entities`, `manage_note`, `analyze_graph`) with snake_case naming, down from 30+ separate tools
- Action-level authorization via `ProfilePolicy`: per-profile capabilities (`read`/`write`), tool blocking, and action blocking (e.g. allow `manage_note:read` but block `manage_note:create`)
- Graph intelligence analyses via `analyze_graph` tool: overview, health, centrality, orphans, shortest paths
- MCP Settings tab: copy-to-clipboard connection configs for Claude Desktop, Claude Code, Codex, and Cursor with auto-filled vault path
- MCPB bundle support (`npm run bundle`) for single-click Claude Desktop installation
- Input validation layer with descriptive error messages per tool and action
- Structured mutation effects: all write operations return `{ nodeIds, edgeIds }` for targeted embedding updates and UI sync
- 135 MCP tests across 5 test suites covering authorization, validation, service delegation, and end-to-end integration

### Changed
- Standalone MCP CLI (`packages/synapse-mcp`) reduced from 1075 to 535 lines — inline tool definitions replaced with shared `DefaultKnowledgeService`
- MCP server bridge supports dual path: new `KnowledgeService` for external MCP clients, legacy `ToolRegistry` for built-in chat agent (Phase 1 coexistence)
- CLI package renamed from `synapse-mcp` to `synapse-kg` for npm publishing
- Entity mutations via MCP always set `DbNode.type = 'entity'`; external `label` field maps to `DbNode.label` (semantic type like person, concept, technology)
- Merge operations run in `BEGIN IMMEDIATE` transaction with rollback on failure

### Fixed
- `oneOf` JSON schemas silently rejected by Claude Desktop — flattened to `type: "object"` with action enum
- `updateNote` silently dropped content when only title was updated — now reads existing content before saving

## [0.8.0] - 2026-06-24

### Added
- Inline property editor: node properties displayed as editable key-value fields instead of raw JSON — click any value to edit in place (string, number, boolean, JSON), with key renaming, add/remove, and save/revert controls
- Markdown content preview in node detail panel: entity files and note content rendered inline with collapsible preview, "Show more/less" toggle, and clickable wiki-links
- "Open in Editor" button on entity and note previews opens the markdown content in a full editor tab
- Entity file generation button: entities without a file show a "Generate" action in the detail panel
- `entityFiles.write()` API: full-content overwrite endpoint for entity markdown files across the platform layer (service, IPC, Electron, Chrome stub)
- NoteEditor entity file support: opening an entity node in the editor reads/writes via the entity files API with correct frontmatter format (`id` + `title`), skipping note-specific side effects

### Changed
- Property editing decoupled from the panel-level edit mode — properties have independent dirty tracking and save/revert
- Companion page captures now route through the reading list with prefetched content instead of directly to the LLM extraction panel
- Viewport re-queries on external DB mutations (MCP, companion CLI) via `db.onSync`

### Removed
- `pendingCapture` state from LLM store (replaced by reading list flow with prefetched content)

## [0.7.0] - 2026-06-23

### Added
- Entity files: graph entities automatically projected to markdown files in `entities/` directory with YAML frontmatter (id, type, aliases) and relationship/source sections
- Bidirectional entity sync: edits to entity markdown files (title renames, new files, deletions) detected and reconciled back into the graph database
- Wiki-link drift detection: `[[broken-link]]` references in entity files checked against graph; broken, dead, and missing links surfaced as sync notifications
- External edit detection: title mismatches between entity file headings and DB names flagged for user resolution
- Sync panel UI in activity bar with badge count and notification cards for each issue type (title mismatch, new file, unknown ID, broken/dead/missing links)
- Notification action resolution: dismiss, accept rename, or reject from the sync panel
- Entity file agent tools and RAG integration: chat agents can read entity file content for grounded responses

### Changed
- Database migrations consolidated from 14 incremental files into a single merged schema DDL, applied atomically on fresh vaults
- Vault reconciliation extended to handle `entities/` directory alongside existing `notes/` handling
- Node render size increased 2x; edge arrow cones increased 2.5x for better visibility

### Fixed
- Edge selection arrow highlighting: selecting an edge now correctly dims unrelated arrow cones along with their lines, instead of leaving all cones at full brightness
- `addAlias` silently created duplicate aliases for the same entity; now uses `ON CONFLICT DO NOTHING` backed by a unique index on `(node_id, alias_lower)`
- Missing index on `entity_aliases.node_id` caused full table scans when loading entity details
- Missing index on `edges.type` caused full table scans when filtering by edge type
- `entity_sources.resource_id` and `edge_sources.resource_id` lacked foreign key constraints, allowing orphan provenance rows when resources were deleted

## [0.6.0] - 2026-06-18

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