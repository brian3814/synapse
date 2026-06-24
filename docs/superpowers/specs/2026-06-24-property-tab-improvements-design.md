# Property Tab Improvements Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the NodeDetailPanel property section from raw JSON display to editable key-value fields, and add an inline entity file preview with a button to open in the markdown editor.

**Approach:** In-place rewrite of `PropertyEditor` + new entity file preview section in `NodeDetailPanel`. No new files. Three files modified.

---

## 1. PropertyEditor Rewrite

**File:** `src/ui/components/panels/PropertyEditor.tsx`

### Interface Change

```ts
interface PropertyEditorProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  editing: boolean; // NEW — controls read-only vs editable rendering
}
```

### View Mode (`editing: false`)

Render properties as a static key-value list:
- Each property is a row: key label (left, `text-zinc-400`), value (right, `text-zinc-200`)
- String/number/boolean values render as plain text
- Boolean values display as "true" / "false"
- Complex values (arrays, nested objects) render as compact inline JSON in monospace
- Empty state: "No properties" in muted italic text

### Edit Mode (`editing: true`)

Each row becomes interactive with type-appropriate inputs:

| Value type | Input control |
|---|---|
| `string` | Text input |
| `number` | Number input |
| `boolean` | Checkbox toggle |
| `object` / `array` | Inline JSON textarea (scoped to that single value, with parse validation) |

Additional edit controls:
- **Key renaming:** Clicking the key label converts it to a text input. On blur/enter, the key is renamed in the properties object (preserving the value).
- **Remove:** Small `x` button per row, removes the key-value pair.
- **Add:** An "Add property" row at the bottom with: key text input, value text input, type selector dropdown (`string` | `number` | `boolean` | `JSON`). Clicking `+` or pressing Enter adds the pair.

### Value Type Detection

On load, infer the type from the existing value:
- `typeof value === 'string'` → string input
- `typeof value === 'number'` → number input
- `typeof value === 'boolean'` → checkbox
- Everything else → JSON textarea

When adding a new property, the type selector determines the initial input type.

---

## 2. Entity File Preview

**File:** `src/ui/components/panels/NodeDetailPanel.tsx`

### Placement

New section rendered below Properties and above Sources. Only shown when `node.type === 'entity'`.

### State

```ts
const [entityFileContent, setEntityFileContent] = useState<string | null>(null);
const [entityFileLoading, setEntityFileLoading] = useState(false);
const [entityFileExpanded, setEntityFileExpanded] = useState(false);
```

### Loading

On `selectedNodeId` change, if `node.type === 'entity'`:
1. Set `entityFileLoading = true`
2. Call `entityFiles.read(node.id)` (imported from `@platform`)
3. On success: parse `result.content` through `parseMarkdown()` to strip frontmatter, store body in `entityFileContent`
4. On null return (no file): set `entityFileContent = null`
5. Set `entityFileLoading = false`

### Rendering

**Loading state:** Small inline spinner (consistent with existing app patterns).

**No file exists (`entityFileContent === null`):**
```
No entity file
[Generate] button
```
The Generate button calls `entityFiles.generateAll()` and shows a brief loading spinner. This regenerates files for all entities that don't have one yet — acceptable since generation is idempotent and skips existing files. A single-node generate endpoint is out of scope but could optimize this later.

**File exists:**
- Section header: "Entity File" with document icon, styled as `text-xs font-medium text-zinc-400`
- Rendered markdown preview using `NoteMarkdownPreview` component
- Constrained to `max-height: 200px` with `overflow: hidden` and a bottom gradient fade (`bg-gradient-to-t from-zinc-900 to-transparent`)
- "Show more" / "Show less" toggle button below the preview, controls `entityFileExpanded` state
- When expanded, `max-height` constraint is removed
- Wiki-links (`[[Entity Name]]`) are clickable via `onNodeClick` handler (navigates to entity in graph)

**"Open in Editor" button:**
- Styled consistently with the existing "Open in Note Editor" button (sky-600 theme)
- Calls `openContentTab({ kind: 'noteEditor', noteId: node.id }, node.name)`

---

## 3. NoteEditor Entity File Support

**File:** `src/ui/components/notes/NoteEditor.tsx`

### Read Path

On mount, look up the node type from `graphStore.nodes`:
- If `node.type === 'entity'`: call `entityFiles.read(nodeId)`, use `result.content` field, parse through `parseMarkdown()`
- If `node.type === 'note'` (or anything else): existing `notes.read(nodeId)` path unchanged

### Write Path

On save, branch by node type:

**Entity nodes:**
- Generate markdown with `generateNoteMarkdown(title, content, wikiLinks)` (same as notes)
- Write via a new `entityFiles.write(nodeId, markdown)` method (see section 3.1 below)
- Update node name via `graphStore.updateNode({ id, name: title })`
- Skip: note search indexing (`noteSearch.upsert`), wiki-link edge creation (`createWikiLinkEdges`), BroadcastChannel sync, external filesystem folder sync

### 3.1 New `write` endpoint on EntityFiles

The existing entity files API only supports `append` (add text) and `patch` (search-and-replace). NoteEditor needs a full-content overwrite for saves. Add:

**`PlatformEntityFiles` interface** (`src/platform/types.ts`):
```ts
write(nodeId: string, markdown: string, expectedHash?: string): Promise<{ contentHash: string }>;
```

**`EntityFileService`** (`electron/entity-files/entity-file-service.ts`):
- New method `writeEntityFile(nodeId, markdown, expectedHash?)` — resolves the file path from the node ID, writes the full content via `writeFileSync`, updates `content_hash` in DB, marks as app-written via `markAsAppWritten` to avoid triggering the file watcher as an external change. Returns new `contentHash`.

**IPC handler** (`electron/entity-files/ipc-handlers.ts`):
- Register `entity-files:write` handler delegating to `service.writeEntityFile()`.

**Platform layer** (`src/platform/electron/index.ts`):
- Add `write` method to the `entityFiles` export.

**Chrome stub** (`src/platform/chrome/index.ts`):
- Add no-op stub returning `{ contentHash: '' }` (entity files are Electron-only).

**Note nodes:** Existing save path unchanged.

### External Change Detection

The `onExternalChange` hook (`notes.onExternalChange`) only fires for note files. Entity file external changes are handled by the `EntitySyncPanel` — no changes needed in NoteEditor.

---

## 4. NodeDetailPanel Integration

### Properties Section Change

Replace the current conditional rendering (lines 406-415):

**Before:**
```tsx
{editing ? (
  <PropertyEditor value={properties} onChange={setProperties} />
) : (
  <pre>...</pre>
)}
```

**After:**
```tsx
<PropertyEditor value={properties} onChange={setProperties} editing={editing} />
```

PropertyEditor now handles both display modes internally.

### Entity File Section

New JSX block between Properties and Connected Edges sections, gated on `node.type === 'entity'`. Import `entityFiles` from `@platform` and `NoteMarkdownPreview` from `../shared/MarkdownRenderer`. Import `parseMarkdown` from `../../../filesystem/markdown-parser`.

---

## 5. Files Modified

| File | Change |
|---|---|
| `src/ui/components/panels/PropertyEditor.tsx` | Full rewrite — key-value field editor with view/edit modes |
| `src/ui/components/panels/NodeDetailPanel.tsx` | Simplified property integration + new entity file preview section |
| `src/ui/components/notes/NoteEditor.tsx` | Branch read/write paths for entity vs note nodes |
| `src/platform/types.ts` | Add `write` method to `PlatformEntityFiles` interface |
| `electron/entity-files/entity-file-service.ts` | Add `writeEntityFile()` method |
| `electron/entity-files/ipc-handlers.ts` | Register `entity-files:write` IPC handler |
| `src/platform/electron/index.ts` | Add `write` to `entityFiles` export |
| `src/platform/chrome/index.ts` | Add `write` no-op stub to `entityFiles` |

---

## 6. Out of Scope

- Generic/abstract markdown editor refactor — NoteEditor stays note-centric with an entity branch
- Entity file generation for individual nodes (uses existing `generateAll()`)
- Note search indexing for entity files
- Wiki-link edge creation from entity file content
- EdgeDetailPanel property editing (can reuse PropertyEditor later if needed)
