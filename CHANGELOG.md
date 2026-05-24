# Changelog

All notable changes to Synapse will be documented in this file.

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