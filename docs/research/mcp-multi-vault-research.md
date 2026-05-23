# MCP Multi-Vault Design Research

Comparative analysis of how knowledge management products implement MCP servers, handle multi-vault/workspace scenarios, and expose extensibility to developers. Conducted May 2026 to inform Synapse's MCP multi-vault architecture.

## Products Analyzed

| Product | Stack | Data Location | Official MCP? | Plugin Model | Multi-Workspace MCP |
|---|---|---|---|---|---|
| Obsidian | Electron, closed-source | Local markdown files | No | Unsandboxed (full Node.js) | Unsolved |
| Heptabase | Electron, closed-source | Local DB + AWS sync | Yes (hosted + CLI) | None | N/A (single workspace) |
| Notion | Cloud (SQLite offline cache) | Cloud-first | Yes (hosted + open-source) | None (API + Workers) | Unsolved (1 auth = 1 workspace) |
| Logseq | Electron, open-source (ClojureScript) | SQLite (DB ver.) or local markdown | Yes (built into DB version) | Sandboxed iframe | Unsolved |

**Key finding: nobody has solved multi-workspace MCP.** Every product defaults to one-server-per-vault workarounds.

---

## Obsidian

### MCP Architecture

No official MCP server. Community fills the gap with three incompatible tiers:

1. **Filesystem-direct** (MCPVault, StevenStavrakis/obsidian-mcp) — reads `.md` files directly, Obsidian does not need to be running. Simplest but blind to graph metadata, Dataview, link resolution.
2. **REST API bridge** (MarkusPfundstein/mcp-obsidian, cyanheads) — wraps the Local REST API community plugin over HTTP. Obsidian must be running. Each vault = separate port + separate API key.
3. **Native plugin** (aaronsb/obsidian-mcp-plugin) — runs inside Obsidian, accesses `MetadataCache`, `resolvedLinks`, Dataview DQL. Richest data access but beta-only (BRAT install).

### Plugin Sandbox Model

**There is no sandbox.** Obsidian runs Electron with `nodeIntegration` enabled in the renderer process. Plugins are JavaScript files loaded via `eval()` and inherit the full permissions of the OS user.

Plugins can:
- Access all Node.js built-in modules: `fs`, `net`, `http`, `https`, `child_process`, `crypto`, `path`, `os`
- Bind TCP ports (Local REST API plugin does `https.createServer()` from the renderer)
- Read/write any file on disk
- Spawn child processes
- Directly manipulate the DOM

The only real restriction: mobile (iOS/Android) runs in Capacitor/WKWebView without Node.js, so `isDesktopOnly: true` prevents mobile installation.

### Multi-Vault Barrier

Each vault runs in a separate `BrowserWindow` with its own renderer process. There is no shared memory, no cross-vault event bus, and no API to discover other open vaults. A plugin in Vault A is architecturally invisible to a plugin in Vault B.

The primitives to build coordination exist (TCP sockets, filesystem writes) since plugins have full Node.js access, but Obsidian provides zero foundation for cross-vault communication.

### Key Internal APIs Available to Plugins

| API | Purpose |
|---|---|
| `app.vault` | Full CRUD on vault files, `getMarkdownFiles()`, `process()` (atomic read-modify-write) |
| `app.metadataCache` | `getFileCache()`, `resolvedLinks` (forward links map), `unresolvedLinks`, link resolution events |
| `app.fileManager` | `processFrontMatter()` for YAML manipulation, rename with link updates |
| `app.workspace` | Active file, leaf management, multi-window popout support (v0.15.3+) |
| `app.commands` | `listCommands()`, `executeCommandById()` |
| `app.plugins.plugins` | Access all loaded plugin instances — the primary inter-plugin communication pattern |

### Obstacles to Single-Server Multi-Vault (mcp-obsidian analysis)

Five concrete blockers identified in MarkusPfundstein/mcp-obsidian:

1. **Global singleton config** — vault connection configured via module-level globals from env vars, evaluated once at import time. No vault registry, no connection map.
2. **No vault parameter in tool schemas** — none of the 15 tools accept a `vault` parameter. File paths are vault-relative with no concept of which vault.
3. **REST API is inherently single-vault** — the Local REST API plugin endpoint `/vault/` means "the root of this vault." No vault selection in the HTTP API itself.
4. **Authentication is 1:1** — each vault has its own API key and port. No master key concept.
5. **Env var propagation bugs** — released version (v0.2.2) does not pass `port`/`protocol` through to the client constructor, breaking multi-instance workarounds.

### Multi-Vault Workarounds in Practice

The community consensus (Issue #63) is N server processes, one per vault:

```json
{
  "mcpServers": {
    "obsidian-personal": {
      "command": "mcp-obsidian",
      "env": { "OBSIDIAN_API_KEY": "key-1", "OBSIDIAN_PORT": "27123" }
    },
    "obsidian-work": {
      "command": "mcp-obsidian",
      "env": { "OBSIDIAN_API_KEY": "key-2", "OBSIDIAN_PORT": "27125" }
    }
  }
}
```

No one has proposed or attempted true single-process multi-vault.

---

## Heptabase

### MCP Architecture

Heptabase took a different path: no plugin system, MCP as the primary extensibility surface.

**Official hosted MCP server** at `https://api.heptabase.com/mcp`:
- OAuth authentication (browser redirect flow)
- Cloud-synced data (not local files)
- Streamable HTTP transport
- Shipped December 2025 (v1.81.2)

Tools exposed:

| Tool | Description |
|---|---|
| `semantic_search_objects` | Keyword + semantic search across cards, PDFs, journals, highlights |
| `search_whiteboards` | Find whiteboards by name/topic |
| `get_whiteboard_with_objects` | View board structure and relationships |
| `get_object` | Retrieve full content of notes, journals, media |
| `get_journal_range` | Access journal entries across date ranges |
| `search_pdf_content` | Locate content within PDFs |
| `get_pdf_pages` | Extract specific PDF pages |
| `save_to_note_card` | Create new notes in Inbox |
| `append_to_journal` | Add content to today's journal |

**Official CLI** (`heptabase-cli` on npm, shipped April 2026):
- Local tool, requires desktop app running
- Returns JSON for all commands
- Designed explicitly for AI coding agents
- v0.3.0 reads tag database schemas, reads/writes card property values

**Community MCP** (LarryStanley/heptabase-mcp):
- Reads local backup `.zip` files — privacy-focused, data never leaves machine
- 12 tools including spatial queries (`getCardsByArea` with x,y coordinates + radius), backup diffing, graph analysis, export to mermaid/graphviz

### Extension Model

No plugin/extension system exists. Official stance: "We plan to offer end-user programming capabilities in the future, but it's not our current priority." They worry customization introduces complexity that distracts from core UX.

No public REST API or GraphQL API. The MCP server and CLI are the only programmatic interfaces.

### Multi-Workspace

Not applicable — single workspace per account. "Multiple spaces" is Priority 1 on roadmap but unshipped.

### AI Features

Extensive built-in AI (third-party models: GPT 5.4-mini, GPT 5.5, Claude Opus 4.6, Claude Sonnet 4.6, Gemini Pro 3.1):
- AI Chat with full-space context awareness
- AI Tutor with structured learning and credits system
- AI Agent (v1.96.0) — can edit card content, view mention links, read images
- "Research a Topic" — upload PDFs, YouTube, .docx; AI analyzes and connects ideas

Bidirectional whiteboard integration: drag chat messages onto whiteboards; edits sync back.

---

## Notion

### MCP Architecture

The most mature MCP implementation of the four products.

**Hosted MCP server** (`mcp.notion.com`):
- OAuth only (human-in-loop consent), Streamable HTTP + SSE transport
- 18 tools across 6 categories (pages, databases/views, querying, comments, users, search)
- Code generation pipeline: OpenAPI schemas → Zod types → MCP tool definitions (iterate server-side without client updates)
- **Notion-flavored Markdown** output format — raw JSON block hierarchies consumed 55,000+ tokens per database query; Markdown format cuts this dramatically
- Intentionally omits block-level editing (simpler tools vs concurrent edit safety tradeoff)

**Open-source local server** (github.com/makenotion/notion-mcp-server, 4.4k stars):
- stdio + Streamable HTTP, integration token via env var (no OAuth)
- 22 tools (everything hosted has + block-level operations)
- Soft-deprecated — Notion prioritizing hosted server, "may sunset" local

### Multi-Workspace

One auth = one workspace. Claude accounts can only connect to one Notion workspace at a time. Switching requires disconnect/reconnect. Community workaround: multiple MCP server instances with different tokens.

### Token Optimization

Critical design lesson. Notion's API returns nested JSON block structures. A single database query can produce 55,000+ characters of JSON. Their hosted MCP server implements a custom Markdown dialect supporting callouts, columns, nested pages, and databases — dramatically reducing token consumption while preserving semantic structure.

### Custom Agents

Shipped February 2026 (Notion 3.3). Over 1M agents created. Can perform up to 20 minutes of autonomous work across hundreds of pages. Key patterns:
- MCP connections as tool providers for agents
- Read tools default to **auto-run**; write tools default to **"always ask" confirmation**
- Workers (hosted sandbox runtime) for custom deterministic logic that MCP can't cover
- Each MCP connection is unique to a single agent, uses credentials of the authenticating person

### Developer Model

No traditional plugin/extension system. Extensibility through:
- Public REST API with OAuth or integration tokens (3 req/sec rate limit)
- Workers (May 2026) — hosted code runtime, deployed via CLI, runs in secure sandbox
- Webhooks (API version 2025-09-03) for real-time change monitoring
- Integrations marketplace with pre-configured partner connections

---

## Logseq

### MCP Architecture

The closest architectural parallel to Synapse.

**Built-in MCP endpoint** in DB version:
- `/mcp` on the HTTP server at `http://127.0.0.1:12315/mcp`
- Streamable HTTP transport, bearer token auth
- Same HTTP server also exposes `/api` endpoint mirroring the plugin SDK
- Supports creating/editing nodes, searching, managing tags/properties/pages

Configuration:
```bash
claude mcp add logseq-http http://127.0.0.1:12315/mcp \
  --transport http --header "Authorization: Bearer TOKEN"
```

**Official CLI** for headless operations without the GUI:
- `qmd query` for multi-part queries
- `sync asset download`, `graph create --enable-sync`
- Designed for automation/CI/CD

### Plugin Sandbox Model

Polar opposite of Obsidian. `nodeIntegration` is **disabled**. Two sandboxing modes:

1. **Iframe sandbox** (default) — full document isolation, all communication via `postMessage` through Postmate library
2. **Shadow DOM** (`mode: 'shadow'`) — lighter isolation, shared window but scoped CSS

Plugins **cannot**: access filesystem, bind ports, spawn processes, communicate with other plugins, access Node.js modules, or directly manipulate the DOM.

This is why Logseq built MCP into the core — plugins literally cannot do it.

### Plugin APIs (7 namespaces)

| Namespace | Key Capabilities |
|---|---|
| `logseq.App` | `getInfo()`, `getUserConfigs()`, `getCurrentGraph()`, command registration |
| `logseq.Editor` | Block/page CRUD, `getCurrentPageBlocksTree()`, slash command registration |
| `logseq.DB` | `q(query, ...inputs)` — Datalog queries against the graph |
| `logseq.Git` | `execCommand(args)` — execute git commands on current graph |
| `logseq.UI` | Toast notifications, element queries |
| `logseq.Assets` | Write to graph's `assets/` directory |
| `logseq.FileStorage` | Namespaced per-plugin storage |

### Multi-Graph

Each graph is a separate SQLite database. The HTTP server serves whichever graph is currently active. No community MCP server handles multi-graph. Same N-instance workaround as everyone else.

### Community MCP Servers

| Server | Language | Differentiator |
|---|---|---|
| jimsynz/logseq-mcp-server | Rust | 13 tools: page/block CRUD, datascript query, graph info |
| eugeneyvt/logseq-mcp-server | TypeScript | 4 unified tools with impact analysis |
| joelhooks/logseq-mcp-tools | TypeScript | AI-powered: connection suggestions, journal analysis, knowledge gap detection |
| saichaitanyam/LogseqMCP | Python (FastMCP) | Graph, page, and block operations |

All access Logseq through the HTTP API, not plugins or direct file access.

### Architectural Parallel to Synapse

- Both use Electron + SQLite + a graph data model
- Both have a "vault/graph as directory" concept
- Logseq's Markdown Mirror (SQLite as truth, markdown as projection) matches Synapse's approach where graph DB is source of truth and filesystem is a projection
- The HTTP API + MCP dual-interface pattern maps directly to Synapse's companion server + MCP server

---

## Plugin Security Model Comparison

| Dimension | Obsidian | Logseq |
|---|---|---|
| Sandboxing | None — `eval()` in renderer | iframe (default) or Shadow DOM |
| Node.js access | Full — `child_process`, `fs`, `net` | None — `nodeIntegration` disabled |
| Filesystem access | Unrestricted | Scoped to plugin storage + assets dir |
| Process spawning | Yes | No |
| Network listeners | Yes (can bind ports) | No |
| DOM access | Full | No (iframe) / CSS-scoped (shadow DOM) |
| Inter-plugin comms | Direct function calls via `app.plugins.plugins` | Not supported |
| Plugin distribution | Community list + BRAT + manual | Marketplace + manual |
| Security review | Automated scanning (late 2025), trust-based | Architectural enforcement via sandbox |

Heptabase and Notion have no plugin systems and therefore no plugin security model to compare.

---

## Developer Interaction Patterns

| Capability | Obsidian | Heptabase | Notion | Logseq |
|---|---|---|---|---|
| Bind network port | Yes (from plugin) | N/A | N/A | No (sandbox) |
| Spawn process | Yes (`child_process`) | N/A | Workers (hosted sandbox) | No |
| Direct filesystem | Yes (unrestricted) | N/A | N/A | No (scoped) |
| Query graph structure | Yes (`MetadataCache.resolvedLinks`) | Via MCP/CLI only | Via API only | Yes (`logseq.DB.q()` — Datalog) |
| Cross-vault coordination | Possible but no foundation | N/A | Not possible via API | Not possible via plugin |
| Raw database access | No (markdown files) | No (format undisclosed) | No (cloud) | Yes (SQLite is documented) |

---

## Lessons for Synapse

### 1. Synapse Has Unique Advantages for Multi-Vault MCP

| Constraint | Obsidian | Heptabase | Notion | Logseq | Synapse |
|---|---|---|---|---|---|
| Who builds MCP server? | Community plugins | Company | Company | Company (core) | Us |
| Access to main process? | No (closed-source) | No (closed-source) | N/A (cloud) | Yes (open-source) | Yes |
| Inter-window coordination? | Not exposed | N/A | N/A | Not exposed | We control IPC |
| Can modify app lifecycle? | No | No | N/A | Possible (but complex) | Yes |
| Data access without app running? | Markdown files only | Backup zips only | API only | SQLite directly | SQLite directly |

### 2. Token Optimization Is Critical

Notion's biggest lesson: raw JSON block hierarchies consumed 55,000+ tokens per call. Any MCP server bridging a complex data model needs to think about output format for agent consumption. Design compact, Markdown-ish output with expandable detail levels from day one.

### 3. Read/Write Permission Separation

Notion's Custom Agents pattern: read tools default to auto-run, write tools default to confirmation. Synapse's `--allow-write` flag on the stdio CLI already follows this pattern.

### 4. The HTTP Daemon + Registration Pattern Is Viable

Every product that ships official MCP uses HTTP transport (Heptabase hosted, Notion hosted, Logseq DB). Synapse's companion server already runs on HTTP. Adding `/register` and `/mcp` endpoints gives us:
- Dynamic vault registration without file coordination
- MCP protocol and registration API on the same HTTP server
- `notifications/tools/list_changed` for dynamic vault appearance/disappearance
- Stale entry cleanup via connection health checks instead of PID/file gymnastics

### 5. No Plugin System Is a Valid Choice

Heptabase ships zero extensibility beyond MCP and CLI. MCP can serve as the primary extensibility surface rather than building a plugin system. This reduces security concerns, API surface maintenance, and backwards-compatibility burden.

---

## Sources

### Obsidian
- [MarkusPfundstein/mcp-obsidian — Multi-vault Issue #63](https://github.com/MarkusPfundstein/mcp-obsidian/issues/63)
- [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server)
- [bitbonsai/mcpvault](https://github.com/bitbonsai/mcpvault)
- [aaronsb/obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin)
- [coddingtonbear/obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins)
- [Obsidian Plugin Security](https://help.obsidian.md/plugin-security)

### Heptabase
- [Heptabase MCP Help Center](https://support.heptabase.com/)
- [LarryStanley/heptabase-mcp](https://github.com/LarryStanley/heptabase-mcp)
- [Heptabase CLI Documentation](https://docs.heptabase.com/cli)

### Notion
- [Notion's hosted MCP server: an inside look](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [makenotion/notion-mcp-server (GitHub)](https://github.com/makenotion/notion-mcp-server)
- [Notion MCP Developer Docs](https://developers.notion.com/guides/mcp/mcp)
- [Notion API Documentation](https://developers.notion.com/)
- [suekou/mcp-notion-server](https://github.com/suekou/mcp-notion-server)

### Logseq
- [Logseq DB Version Documentation](https://github.com/logseq/docs/blob/master/db-version.md)
- [Logseq Plugin API Docs](https://plugins-doc.logseq.com/)
- [jimsynz/logseq-mcp-server](https://github.com/jimsynz/logseq-mcp-server)
- [joelhooks/logseq-mcp-tools](https://github.com/joelhooks/logseq-mcp-tools)
- [Logseq Codebase Overview](https://github.com/logseq/logseq/blob/master/CODEBASE_OVERVIEW.md)
