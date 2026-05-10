# Knowledge Graph

A Chrome extension that builds a local-first knowledge graph from web pages. Extract entities and relationships using LLMs, visualize them in an interactive 2D/3D graph, and query your knowledge base conversationally.

All data stays on your machine — SQLite with OPFS persistence, no external servers beyond the LLM API calls you configure.

## Features

- **LLM-powered extraction** — Extract entities and relationships from any web page or pasted text. Two modes: simple text extraction (any provider) and agentic page extraction with DOM inspection tools (Anthropic only).
- **Interactive graph visualization** — 2D and 3D views via Reagraph with force-directed, tree, radial, and hierarchical layouts. Clustering by node type.
- **Extraction review & editing** — Visual review step before committing to the graph. Inline editing, merge recommendations for duplicate entities, convert nodes to properties, full undo/redo.
- **Conversational queries** — Ask questions about your knowledge graph in natural language. RAG-powered chat interface.
- **Contextual relevance** — Optionally highlights related graph nodes as you browse the web.
- **Side panel or full tab** — Compact side panel view (default) or full-tab mode with side-by-side panels. Toggle between them anytime.
- **Search & CRUD** — Full-text search (FTS5 when available, LIKE fallback), manual node/edge creation, property editing, notes.

## Supported LLM Providers

| Provider | Models |
|---|---|
| OpenAI | GPT-4o, GPT-4o Mini, GPT-4 Turbo |
| Anthropic | Claude Sonnet 4, Claude Haiku 4 |

Bring your own API key. Keys are stored locally in Chrome's extension storage and injected securely by the service worker — they never appear in broadcast messages.

## Installation

### From source

```bash
git clone <repo-url>
cd kg_extension
npm install
npm run build
```

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. The extension icon appears in the toolbar — click it to open the side panel

### Development

```bash
npm run dev       # Watch mode — rebuilds on file changes
```

After each rebuild, go to `chrome://extensions` and click the refresh icon on the extension card (or press Ctrl+Shift+R on the extensions page).

## Usage

1. **Configure an LLM** — Open Settings (gear icon) and enter your API key for OpenAI or Anthropic.
2. **Extract from a page** — Navigate to any web page, open the extension, go to the LLM panel, and choose "From Page" (agentic, Anthropic only) or "From Text" (paste content, any provider).
3. **Review & edit** — After extraction, review the suggested entities and relationships. Edit labels, accept merge suggestions for duplicates, remove irrelevant nodes, or convert low-value nodes into properties of adjacent nodes.
4. **Explore your graph** — Switch layouts, toggle clustering, click nodes to see details, search for entities, or ask questions in the chat panel.
5. **Right-click extraction** — Right-click selected text on any page and choose "Extract to Knowledge Graph" from the context menu.

## Architecture

Chrome Manifest V3 with six execution contexts:

| Context | Role |
|---|---|
| Service Worker | Ephemeral message router, API key injection, content script management |
| Side Panel / Tab | React 19 SPA with Reagraph visualization and Zustand state |
| Offscreen Document | Long-running LLM streaming and agent loop (outlives SW lifecycle) |
| Content Script | Page text extraction via Readability, agent tool execution |
| DB SharedWorker | Query coordinator across tabs |
| DB Dedicated Worker | wa-sqlite + OPFS engine |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, database schema, worker bridging pattern, and 13 documented pitfalls with solutions.

## Tech Stack

React 19, TypeScript, Vite 7, Zustand 5, Reagraph 4, Tailwind CSS 4, wa-sqlite, Zod 4, @mozilla/readability

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Primary UI surface |
| `storage` | Persist settings and LLM config |
| `activeTab` | Read current tab for extraction |
| `scripting` | Inject content script for page parsing and agent tools |
| `contextMenus` | Right-click "Extract to KG" menu |
| `offscreen` | Hidden document for LLM streaming that outlives service worker |
| `<all_urls>` | Content script needs access to any page the user wants to extract from |

## References

- [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — Andrej Karpathy's design pattern for LLM-maintained personal knowledge bases that incrementally build interlinked markdown wikis from raw sources, eliminating re-derivation on every query.
- [The append-and-review note](https://karpathy.bearblog.dev/the-append-and-review-note/) — Andrej Karpathy's simple note-taking system: append ideas at the top of a single file, periodically review by scrolling through older entries.
- [Personal AI with Vector Embeddings](https://medium.com/@kp9810113/how-i-built-a-personal-ai-that-remembers-everything-using-vector-embeddings-and-zero-external-apis-fb5f7dc7eb7b) — Building a locally-hosted AI with persistent memory using vector embeddings and zero external APIs.

## License

MIT
