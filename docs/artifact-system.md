# Artifact System

LLM-generated content (dashboards, documents, diagrams) persisted as first-class objects in the vault, browsable via sidebar panel, rendered in dedicated content tabs with a sandboxed JSX runtime.

## Architecture

```
LLM calls create_artifact({ type, title, content })
    │
    ▼
Tool handler (Electron main process)
    ├── Write content → .kg/artifacts/{sessionDir}/{slug}.{ext}
    ├── Write sidecar → .kg/artifacts/{sessionDir}/{slug}.meta.json
    ├── Insert row → SQLite artifacts table
    └── Index → artifacts_fts (FTS5)
    │
    ▼
Chat renders ArtifactCard → user clicks "Open" → ArtifactTab renders
```

## Artifact Types

| Type | Extension | Renderer | Sandbox |
|---|---|---|---|
| `jsx` | `.jsx` | `JsxRenderer` — iframe + Sucrase + React 19 + Recharts + D3 | `artifact-sandbox://` protocol |
| `markdown` | `.md` | Reuses `MarkdownRenderer` (react-markdown + remark-gfm) | No |
| `html` | `.html` | `HtmlRenderer` — sandboxed iframe with postMessage | `sandbox="allow-scripts"` |
| `svg` | `.svg` | `SvgRenderer` — blob URL `<img>` | No |
| `mermaid` | `.mmd` | `MermaidRenderer` — mermaid.js `render()` → injected SVG | No |

## Storage Layout

Artifacts are grouped by chat session with human-readable names. UUIDs live in `.meta.json`, not filenames.

```
<vault-root>/
  .kg/
    artifacts/
      2026-06-08-analyze-my-graph/
        top-connected-nodes.jsx
        top-connected-nodes.meta.json
        project-summary.md
        project-summary.meta.json
```

**Naming rules:**
- Session directory: `{YYYY-MM-DD}-{session-title-slug}` (collision suffix `-2`, `-3`)
- Artifact file: `{title-slug}.{ext}` (collision suffix `-2`, `-3`)
- `slugify()` in `src/shared/artifact-types.ts` — lowercase, non-alphanumeric → hyphen, max 50 chars

**Sidecar metadata (`.meta.json`):**
```json
{
  "id": "uuid",
  "title": "Top Connected Nodes",
  "type": "jsx",
  "sessionId": "session-uuid",
  "sessionDir": "2026-06-08-analyze-my-graph",
  "createdAt": "2026-06-08T10:30:00Z",
  "updatedAt": "2026-06-08T10:35:00Z"
}
```

## SQLite Schema

```sql
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
    session_id TEXT, session_dir TEXT NOT NULL, file_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE artifacts_fts USING fts5(id UNINDEXED, title, text_content);
```

File on disk is source of truth for content. SQLite is source of truth for search.

## Tool Definitions

**`create_artifact`** — Creates a new artifact. LLM provides `type`, `title`, `content`. Handler generates UUID, resolves session directory + filename, writes files, inserts into SQLite, indexes FTS, broadcasts change.

**`update_artifact`** — Full replacement. LLM provides `artifactId`, `content`, optional `title`. Handler overwrites files and re-indexes.

Both tools return `{ artifactId, title, type, _artifactCard: true }`. The `_artifactCard` flag triggers `ArtifactCard` rendering in chat.

## JSX Sandbox

The sandbox runs LLM-generated React code in an isolated iframe.

```
ArtifactTab (parent)                artifact-renderer.html (iframe)
    │                                   │
    │  <iframe sandbox="allow-scripts"  │
    │   src="artifact-sandbox://...">   │
    │                                   │
    │── postMessage({ RENDER, code }) ──│→ Sucrase.transform(code)
    │                                   │→ new Function(transformed)
    │                                   │→ ReactDOM.createRoot().render()
    │                                   │
    │←─ postMessage({ READY })  ────────│
    │←─ postMessage({ ERROR, msg }) ────│
    │←─ postMessage({ RESIZE, h }) ─────│
```

**Custom Electron protocol:** `artifact-sandbox://` registered in `electron/main.ts` serves the sandbox HTML and vendor bundle from `dist-electron/main/sandbox/`.

**Vendor bundle:** `electron/sandbox/vendor-entry.js` bundles React 19, ReactDOM, Sucrase, Recharts, and D3 into a single 1.1MB IIFE via esbuild (`build:sandbox-vendor` script). No CDN dependency, works offline.

**`fakeRequire` shim:** Maps `'react'`, `'recharts'`, `'d3'` to the window globals. Unknown modules throw `"Module not available: <name>"`.

**Security:** `sandbox="allow-scripts"` without `allow-same-origin`. The iframe gets the `artifact-sandbox:` origin — different from the main window's `app:` origin. No access to parent DOM, cookies, IPC, or Node.js.

## UI Components

| Component | File | Purpose |
|---|---|---|
| `ArtifactCard` | `src/ui/components/chat/ArtifactCard.tsx` | Compact card in chat with type icon + "Open" button |
| `ArtifactPanel` | `src/ui/components/sidebar/ArtifactPanel.tsx` | Left sidebar: search bar, type filter chips, artifact list |
| `ArtifactTab` | `src/ui/components/tabs/ArtifactTab.tsx` | Content tab: toolbar, Preview/Source toggle, renderer routing |
| `ArtifactEditor` | `src/ui/components/artifacts/ArtifactEditor.tsx` | CodeMirror 6 editor for Source mode |
| `JsxRenderer` | `src/ui/components/artifacts/JsxRenderer.tsx` | iframe + postMessage bridge |
| `HtmlRenderer` | `src/ui/components/artifacts/HtmlRenderer.tsx` | Sandboxed iframe for raw HTML |
| `SvgRenderer` | `src/ui/components/artifacts/SvgRenderer.tsx` | Blob URL `<img>` |
| `MermaidRenderer` | `src/ui/components/artifacts/MermaidRenderer.tsx` | mermaid.js with error fallback |

## Data Flow

**Zustand store** (`src/graph/store/artifact-store.ts`): CRUD actions, FTS search, change listener. All I/O via `@platform` → IPC.

**Platform layer** (`src/platform/electron/artifacts.ts`): `ElectronArtifacts` class bridges to IPC channels (`artifacts:list`, `artifacts:create`, etc.).

**IPC handlers** (`electron/main/artifact-handlers.ts`): File I/O + SQLite operations. Exports `createArtifactCore()` / `updateArtifactCore()` used by both IPC handlers and the tool module.

**File watcher** (`electron/vault/handlers/artifact-file-handler.ts`): Listens for `file:added`/`file:removed` events in `.kg/artifacts/`, syncs metadata from `.meta.json` back to SQLite, broadcasts changes to renderer.

## Build

```bash
npm run build:sandbox-vendor   # esbuild vendor bundle (React+Recharts+D3+Sucrase → 1.1MB IIFE)
npm run build:electron-main    # includes sandbox-vendor + copies electron/sandbox/ to dist
npm run build:electron         # full build (main + renderer)
```

## Constraints

- **Available in JSX sandbox:** `react`, `recharts`, `d3` only. No Tailwind, no icon libraries, no network access.
- **No versioning (V1):** `update_artifact` overwrites content. Version history is a future addition.
- **No graph integration (V1):** Artifacts are a separate subsystem — not nodes in the knowledge graph.
- **Electron only:** Chrome extension gets a no-op stub (`src/platform/chrome/index.ts`).

## Related

- Design spec: `docs/superpowers/specs/2026-06-08-artifact-system-design.md`
- Research: `docs/research/artifact-systems-research.md`
- Implementation plan: `docs/superpowers/plans/2026-06-08-artifact-system.md`
- Future: `docs/plans/background-agent-infrastructure.md` (naming enhancement, memory extraction)
