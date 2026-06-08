# Artifact System Design

**Date**: 2026-06-08
**Status**: Draft
**Motivation**: When the LLM generates rich content in chat (dashboards, documents, diagrams), it disappears into the conversation scroll. Synapse needs a way to persist, browse, and render artifacts — making LLM-generated content a first-class citizen alongside notes and graph nodes.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Generation mechanism | Tool calls (`create_artifact` / `update_artifact`) | Synapse already has ToolRegistry + ChatToolCall infrastructure. Structured params enforce required fields. No streaming parser needed. ChatGPT Canvas uses this pattern. |
| Sandbox architecture | Single `<iframe sandbox="allow-scripts">` with local renderer HTML + postMessage | Sufficient for LLM-generated code (not untrusted third-party apps). Multi-layer cross-origin iframe (ChatGPT pattern) is overkill for Electron. |
| Pre-bundled libs | React 19, Recharts, Tailwind CSS, D3 | Covers charts, styled layouts, and custom graph visualizations. Matches Claude.ai's sandbox capabilities plus D3 for knowledge-graph-specific visuals. |
| Storage model | Files on disk (`.kg/artifacts/`) + sidecar `.meta.json` + SQLite metadata table + FTS5 | Content files are clean and independently usable. Sidecar metadata travels with the file. SQLite enables search without graph coupling. |
| Graph integration | None (V1) | Artifacts are a separate subsystem. No artifact nodes in the knowledge graph. Can be added later without breaking changes. |
| Versioning | None (V1) — full replacement | Simplifies storage and UI. `update_artifact` overwrites content. Version history can be added later as append-only files. |
| Update model | Full replacement | Both Claude.ai and ChatGPT Canvas default to full rewrites for code artifacts. Partial patching is fragile and rarely needed. |
| Editor | CodeMirror 6 | Lightweight (~150KB), syntax highlighting for JSX/HTML/MD, line numbers. Good balance for V1. |
| Chat display | Compact card with "Open" button | Non-intrusive in conversation flow. Clicking opens full artifact tab. |

**Research basis**: See `docs/research/artifact-systems-research.md` for detailed analysis of Claude.ai, ChatGPT Canvas, bolt.new, E2B Fragments, LibreChat, Open WebUI, and Open Artifacts.

## Artifact Types

| Type | File extension | Renderer | Mechanism |
|---|---|---|---|
| `jsx` | `.jsx` | `JsxRenderer` | postMessage to sandbox iframe → Sucrase transpile → React render |
| `markdown` | `.md` | `MarkdownRenderer` | Reuse existing `MarkdownRenderer` component (react-markdown + remark-gfm) |
| `html` | `.html` | `HtmlRenderer` | Sandboxed iframe, content injected via postMessage |
| `svg` | `.svg` | `SvgRenderer` | Render as `<img src={blobUrl}>` from Blob |
| `mermaid` | `.mmd` | `MermaidRenderer` | mermaid.js `render()` → inject resulting SVG |

## Architecture

```
User in chat: "Create a dashboard of my top connected nodes"
    |
    v
LLM calls: create_artifact({ type: "jsx", title: "Top Nodes", content: "..." })
    |
    v
Tool handler (Electron main process):
    ├── 1. Generate UUID, resolve session dir + artifact filename
    ├── 2. Write content → .kg/artifacts/{sessionDir}/{slug}.jsx
    ├── 3. Write metadata → .kg/artifacts/{sessionDir}/{slug}.meta.json
    ├── 4. Insert row → SQLite artifacts table
    └── 5. Index → artifacts_fts virtual table
    |
    v
Tool result: { artifactId, title, type }
    |
    v
Chat renders ArtifactCard (compact card with "Open" button)
    |
    v (user clicks Open)
openContentTab({ kind: 'artifact', artifactId }) → ArtifactTab renders
```

### Component Map

**New files:**

| File | Purpose |
|---|---|
| `src/shared/artifact-types.ts` | Type definitions: `ArtifactType`, `ArtifactMeta`, `ArtifactRecord` |
| `src/graph/store/artifact-store.ts` | Zustand store: artifact list, CRUD actions, FTS search |
| `src/ui/components/tabs/ArtifactTab.tsx` | Content tab: toolbar, Preview/Source toggle, routes to renderer |
| `src/ui/components/artifacts/JsxRenderer.tsx` | Sandboxed iframe + postMessage bridge for JSX |
| `src/ui/components/artifacts/HtmlRenderer.tsx` | Sandboxed iframe for raw HTML |
| `src/ui/components/artifacts/SvgRenderer.tsx` | Blob URL `<img>` renderer |
| `src/ui/components/artifacts/MermaidRenderer.tsx` | mermaid.js renderer |
| `src/ui/components/artifacts/ArtifactEditor.tsx` | CodeMirror 6 editor wrapper |
| `src/ui/components/chat/ArtifactCard.tsx` | Compact card in chat messages |
| `src/ui/components/sidebar/ArtifactPanel.tsx` | Left sidebar: search, filter, artifact list |
| `electron/sandbox/artifact-renderer.html` | Static sandbox HTML with pre-bundled libs |
| `electron/main/artifact-handlers.ts` | IPC handlers for artifact CRUD + file I/O |

**Modified files:**

| File | Change |
|---|---|
| `src/graph/store/ui-store.ts` | Add `ContentTabType: { kind: 'artifact'; artifactId: string }`, add `'artifacts'` to left panel type |
| `src/ui/components/layout/ActivityBar.tsx` | Add artifacts icon (third position) |
| `src/ui/layouts/TabLayout.tsx` | Route `artifact` tab type to `ArtifactTab` |
| `src/ui/components/chat/ChatMessage.tsx` | Detect artifact tool results, render `ArtifactCard` |
| `src/shared/chat-agent-tools.ts` | Add `create_artifact` and `update_artifact` tool definitions |
| `electron/main/...` | Register IPC handlers for artifact operations |
| `src/db/migrations/` | New migration: `artifacts` table + `artifacts_fts` virtual table |

## Storage

### File Layout

Artifacts are grouped by chat session. Directories and files use human-readable slugified names. UUIDs are stored in metadata, not in filenames.

```
<vault-root>/
  .kg/
    artifacts/
      2026-06-08-analyze-my-graph/
        top-connected-nodes.jsx            ← clean JSX content
        top-connected-nodes.meta.json      ← sidecar metadata
        project-summary.md
        project-summary.meta.json
      2026-06-08-explore-machine-learning/
        ml-concepts-overview.md
        ml-concepts-overview.meta.json
        knowledge-tree.mmd
        knowledge-tree.meta.json
```

### Naming Rules

**Session directory**: `{YYYY-MM-DD}-{session-title-slug}`
- Session title comes from `chat_sessions.title` (first user message, truncated to 100 chars)
- Slugified: lowercased, non-alphanumeric replaced with hyphens, truncated to ~50 chars
- Collision: append `-2`, `-3` if same date + title slug exists (rare — different sessions on the same day with identical first messages)

**Artifact files**: `{artifact-title-slug}.{ext}`
- Title slugified with same rules as above
- Extension determined by type: `.jsx`, `.md`, `.html`, `.svg`, `.mmd`
- Collision within session: append `-2`, `-3` (e.g., `top-connected-nodes-2.jsx`)

**Slug function**:
```typescript
function slugify(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '');
}

function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = `${base}.${ext}`;
  let i = 2;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${i}.${ext}`;
    i++;
  }
  return candidate;
}
```

### Sidecar Metadata (`.meta.json`)

```typescript
interface ArtifactMeta {
  id: string;            // UUID — stable programmatic identifier
  title: string;
  type: ArtifactType;    // 'jsx' | 'markdown' | 'html' | 'svg' | 'mermaid'
  sessionId: string;     // chat session UUID
  sessionDir: string;    // readable directory name (e.g., '2026-06-08-analyze-my-graph')
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
}
```

Example:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "title": "Top Connected Nodes",
  "type": "jsx",
  "sessionId": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  "sessionDir": "2026-06-08-analyze-my-graph",
  "createdAt": "2026-06-08T10:30:00Z",
  "updatedAt": "2026-06-08T10:35:00Z"
}
```

### SQLite Schema

```sql
CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,         -- 'jsx' | 'markdown' | 'html' | 'svg' | 'mermaid'
  session_id   TEXT,
  session_dir  TEXT NOT NULL,         -- readable dir name: '2026-06-08-analyze-my-graph'
  file_name    TEXT NOT NULL,         -- file within session dir: 'top-connected-nodes.jsx'
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE VIRTUAL TABLE artifacts_fts USING fts5(
  title,
  content,                            -- extracted text for full-text search
  tokenize='unicode61'
);
```

The full file path is derived: `.kg/artifacts/{session_dir}/{file_name}`. SQLite mirrors the sidecar metadata for indexing. The file on disk is the source of truth for content; SQLite is the source of truth for search.

**FTS content extraction by type:**
- `jsx`: Strip JSX tags and imports, index string literals and variable names
- `markdown`: Index the raw markdown text (headings, body, links)
- `html`: Strip HTML tags, index visible text content
- `svg`: Index `<text>` element content and `<title>`/`<desc>` elements
- `mermaid`: Index the raw mermaid syntax (node labels, edge labels)

### File Watcher Integration

The existing vault file watcher is extended to watch `.kg/artifacts/`:

1. **File added**: Read `.meta.json`, insert into `artifacts` table, index content into `artifacts_fts`
2. **File modified**: Re-read content, update `updated_at`, re-index FTS
3. **File deleted**: Remove from `artifacts` table and `artifacts_fts`
4. **Meta modified**: Re-read `.meta.json`, update metadata columns

This handles external edits (user modifies an artifact file in their editor) and keeps the search index in sync.

## Tool Definitions

### `create_artifact`

```typescript
{
  name: 'create_artifact',
  description: 'Create a new artifact — an interactive component, document, diagram, or visualization that the user can open, view, and edit. Use for content that benefits from dedicated rendering rather than inline display.',
  parameters: {
    type: {
      type: 'string',
      enum: ['jsx', 'markdown', 'html', 'svg', 'mermaid'],
      description: 'Artifact type. jsx: React component with Recharts/D3/Tailwind. markdown: formatted document. html: standalone page. svg: vector graphic. mermaid: diagram.'
    },
    title: {
      type: 'string',
      description: 'Human-readable title (displayed in tab bar and artifact list)'
    },
    content: {
      type: 'string',
      description: 'The full artifact content. For jsx: a React component using export default function. For markdown: standard markdown. For html: complete HTML document. For svg: SVG markup. For mermaid: mermaid diagram syntax.'
    },
  },
  required: ['type', 'title', 'content'],
}
```

**Tool handler flow:**
1. Generate UUID for artifact
2. Determine file extension from `type`
3. Resolve session directory: look up `chat_sessions.title` + `created_at` for current session → slugify to `{YYYY-MM-DD}-{title-slug}` → create directory under `.kg/artifacts/` if it doesn't exist
4. Resolve artifact filename: slugify `title` → check for collision within session dir → append suffix if needed
5. Write `content` to `.kg/artifacts/{sessionDir}/{filename}.{ext}`
6. Write `ArtifactMeta` to `.kg/artifacts/{sessionDir}/{filename}.meta.json`
7. Insert metadata row into `artifacts` table
8. Index title + content text into `artifacts_fts`
9. Return `{ artifactId, title, type }`

### `update_artifact`

```typescript
{
  name: 'update_artifact',
  description: 'Replace the content of an existing artifact. Always sends the complete new content (full replacement, not a patch).',
  parameters: {
    artifactId: {
      type: 'string',
      description: 'ID of the artifact to update'
    },
    content: {
      type: 'string',
      description: 'The complete new content (replaces existing content entirely)'
    },
    title: {
      type: 'string',
      description: 'New title (optional, keeps existing if omitted)'
    },
  },
  required: ['artifactId', 'content'],
}
```

**Tool handler flow:**
1. Look up existing artifact by ID in SQLite (error if not found)
2. Derive file path from `session_dir` + `file_name`
3. Overwrite content file
4. Update `updatedAt` in `.meta.json`
5. Update `updated_at` in `artifacts` table
6. Re-index in `artifacts_fts`
7. Return `{ artifactId, title, type }`

### System Prompt Guidance

The LLM needs instructions on when and how to use artifact tools. Added to the chat agent system prompt:

```
## Artifacts

You can create persistent, interactive artifacts that the user can open in a dedicated tab. Use artifacts for:
- Dashboards and data visualizations (type: jsx — React with Recharts, D3, Tailwind)
- Formatted documents, summaries, reports (type: markdown)
- Standalone web pages or interactive demos (type: html)
- Vector graphics and illustrations (type: svg)
- Diagrams: flowcharts, sequence diagrams, entity relationships (type: mermaid)

Use artifacts when content benefits from dedicated rendering — not for short code snippets or simple text answers that belong inline in chat.

For jsx artifacts:
- Use `export default function ComponentName()` as the entry point
- Available imports: react, recharts, d3 (pre-bundled in sandbox)
- Use Tailwind CSS classes for styling
- Hardcode data directly into the component (no external fetching)

When updating an existing artifact, always send the complete new content via update_artifact. Do not attempt partial patches.
```

## UI Design

### Activity Bar

New icon in third position (after Explorer and Agents). Grid/squares icon. Toggles the Artifacts panel in the left sidebar.

```typescript
// Addition to ActivityBar.tsx ITEMS array
{ panel: 'artifacts', title: 'Artifacts', icon: <ArtifactsIcon /> }
```

### Artifacts Panel (Left Sidebar)

Displayed when the artifacts icon is active in the activity bar.

**Components:**
- **Search bar**: Text input, debounced, queries `artifacts_fts` via the Zustand store
- **Type filter chips**: All | JSX | Markdown | HTML | SVG | Mermaid — filters the list by `type`
- **Artifact list**: Sorted by `updated_at` descending. Each item shows:
  - Type icon (color-coded per type)
  - Title
  - Type label + relative timestamp
  - Click → `openContentTab({ kind: 'artifact', artifactId })`

### Artifact Card (Chat)

Rendered inline in assistant messages when a `create_artifact` or `update_artifact` tool call completes. Detected by checking tool call name in `ChatMessage.tsx`.

**Layout:**
- Type icon (32px, colored background)
- Title + type label
- "Open" button → `openContentTab({ kind: 'artifact', artifactId })`

### Artifact Tab (Content Area)

New `ContentTabType`:

```typescript
{ kind: 'artifact'; artifactId: string }
```

**Tab structure:**
- **Tab bar label**: Type icon + artifact title
- **Toolbar**:
  - Type badge (e.g., "React Component")
  - Timestamp ("Last updated 2 min ago")
  - Preview/Source toggle (segmented control)
  - Copy button (copies content to clipboard)
  - Save button (visible in Source mode when content is modified)
- **Content area**:
  - **Preview mode** (default): Type-specific renderer (see Rendering Pipeline)
  - **Source mode**: CodeMirror 6 editor with syntax highlighting for the artifact's language

**Edit flow:**
1. User switches to Source mode
2. CodeMirror 6 loads with artifact content
3. User edits code — toolbar shows "Modified" indicator
4. User clicks Save → writes to `.kg/artifacts/{id}.{ext}` → updates `.meta.json` `updatedAt` → re-indexes FTS
5. Switching to Preview re-renders with updated content

## Rendering Pipeline

### Type Routing

```typescript
// In ArtifactTab.tsx
switch (artifact.type) {
  case 'jsx':      return <JsxRenderer content={content} />;
  case 'markdown': return <MarkdownRenderer content={content} />;
  case 'html':     return <HtmlRenderer content={content} />;
  case 'svg':      return <SvgRenderer content={content} />;
  case 'mermaid':  return <MermaidRenderer content={content} />;
}
```

### JSX Renderer (Sandboxed iframe + postMessage)

**Architecture:**

```
ArtifactTab.tsx (parent)              artifact-renderer.html (iframe)
    |                                     |
    |  <iframe sandbox="allow-scripts"    |
    |   src="artifact-renderer.html">     |
    |                                     |
    |-- postMessage({ type: 'RENDER',  -->|  1. Sucrase.transform(code, {
    |    code: artifactContent })          |       transforms: ['jsx', 'imports']
    |                                     |     })
    |                                     |  2. new Function('module','React',
    |                                     |       'recharts','d3', transformed)
    |                                     |  3. ReactDOM.createRoot(root)
    |                                     |       .render(createElement(component))
    |                                     |
    |<-- postMessage({ type: 'READY' }) --|  4. Signal success
    |<-- postMessage({ type: 'ERROR',  --|  (or) Signal error with message
    |    message: '...' })                |
    |<-- postMessage({ type: 'RESIZE', --|  5. ResizeObserver reports height
    |    height: 600 })                   |
```

**`artifact-renderer.html`** — Static file bundled with the Electron app:

```
electron/sandbox/artifact-renderer.html
electron/sandbox/vendor/
  react.production.min.js
  react-dom.production.min.js
  sucrase.min.js
  recharts.umd.min.js
  d3.min.js
  tailwind.css                         (pre-built, not the CDN)
```

The renderer HTML loads all vendor scripts via `<script>` tags pointing to local files, then listens for `RENDER` messages. On receive, it transpiles the JSX, evaluates it, and renders the React component.

**iframe attributes:**
- `sandbox="allow-scripts"` — permits JS, blocks same-origin access, navigation, forms, popups
- No `allow-same-origin` — iframe gets a null origin, cannot access parent window's DOM, IPC, or Node.js

**Error handling:** If Sucrase fails to transpile or the component throws during render, the renderer catches the error and sends `{ type: 'ERROR', message }` back. The parent displays the error message in a styled error panel within the tab.

### HTML Renderer

Same iframe sandbox as JSX but simpler — no transpilation. Content is sent via postMessage and injected via `document.write()` or `document.open()/write()/close()` in the iframe.

### Markdown Renderer

Reuses the existing `MarkdownRenderer` component from `src/ui/components/shared/MarkdownRenderer.tsx`. No iframe needed — renders directly in the tab content area with react-markdown + remark-gfm.

### SVG Renderer

Converts SVG string to a Blob, creates a blob URL, renders as `<img src={blobUrl}>`. Displayed centered in the tab with zoom controls (CSS transform scale).

### Mermaid Renderer

Imports mermaid.js, calls `mermaid.render(id, content)`, receives rendered SVG string, injects into a container div via `dangerouslySetInnerHTML`. Error handling: if mermaid fails to parse, display the error message and fall back to showing raw mermaid syntax.

## Zustand Store

```typescript
// src/graph/store/artifact-store.ts

interface ArtifactRecord {
  id: string;
  title: string;
  type: ArtifactType;
  sessionId: string;
  sessionDir: string;       // '2026-06-08-analyze-my-graph'
  fileName: string;         // 'top-connected-nodes.jsx'
  createdAt: string;
  updatedAt: string;
}
// Derived: filePath = `.kg/artifacts/${sessionDir}/${fileName}`

interface ArtifactStore {
  // State
  artifacts: ArtifactRecord[];
  loading: boolean;

  // Actions
  loadArtifacts: () => Promise<void>;           // fetch all from SQLite
  searchArtifacts: (query: string) => Promise<ArtifactRecord[]>;  // FTS query
  getArtifactContent: (id: string) => Promise<string>;            // read file
  createArtifact: (params: { type: ArtifactType; title: string; content: string; sessionId: string }) => Promise<ArtifactRecord>;
  updateArtifact: (id: string, content: string, title?: string) => Promise<ArtifactRecord>;
  deleteArtifact: (id: string) => Promise<void>;

  // Subscriptions
  onArtifactChanged: (callback: (artifact: ArtifactRecord) => void) => () => void;
}
```

All I/O goes through `@platform` (IPC to main process). The store is the single source of truth for the UI. File watcher events in the main process push updates to the renderer via IPC, which the store subscribes to.

## IPC Channels

```typescript
// New IPC channels (electron/main/artifact-handlers.ts)

'artifacts:list'       → ArtifactRecord[]
'artifacts:get'        → ArtifactRecord | null
'artifacts:getContent' → string
'artifacts:create'     → ArtifactRecord          // writes file + meta + SQLite
'artifacts:update'     → ArtifactRecord          // overwrites file, updates meta + SQLite
'artifacts:delete'     → void                    // removes file + meta + SQLite row
'artifacts:search'     → ArtifactRecord[]        // FTS5 query

// Renderer → Main (from tool execution)
'artifacts:onChanged'  → ArtifactRecord          // push notification when file watcher detects change
```

## Platform Abstraction

A new `PlatformArtifacts` interface is added to the platform layer:

```typescript
interface PlatformArtifacts {
  list(): Promise<ArtifactRecord[]>;
  get(id: string): Promise<ArtifactRecord | null>;
  getContent(id: string): Promise<string>;
  create(params: { type: ArtifactType; title: string; content: string; sessionId: string }): Promise<ArtifactRecord>;
  update(id: string, content: string, title?: string): Promise<ArtifactRecord>;
  delete(id: string): Promise<void>;
  search(query: string): Promise<ArtifactRecord[]>;
  onChanged(callback: (artifact: ArtifactRecord) => void): () => void;
}
```

Electron implementation uses IPC to main process handlers. Chrome implementation is not needed (Chrome extension is deprecated).

## Scope Boundaries

**In scope (V1):**
- `create_artifact` and `update_artifact` chat agent tools
- File storage in `.kg/artifacts/` with sidecar `.meta.json`
- SQLite metadata table + FTS5 search index
- File watcher sync for external edits
- Activity bar icon + Artifacts panel with search and type filtering
- Artifact card in chat messages
- Artifact content tab with Preview/Source toggle
- JSX sandbox (iframe + Sucrase + React + Recharts + D3 + Tailwind)
- Markdown, HTML, SVG, Mermaid renderers
- CodeMirror 6 editor in Source mode
- Session ID tracking for future chat session restoration

**Out of scope (future):**
- Artifact nodes in the knowledge graph
- Version history / undo
- Live data bridge (postMessage `hostFetch` for graph queries)
- Artifact-to-artifact references
- Inline preview in chat (V1 uses compact card only)
- Artifact templates / scaffolding
- Collaborative editing
- Chrome extension support
- Background agent for naming enhancement, memory extraction, metadata enrichment — see `docs/plans/background-agent-infrastructure.md`
