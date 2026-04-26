# Electron Phase 3: Notes Filesystem Abstraction

## Context

Phase 0-2 delivered an Electron app with persistent storage and better-sqlite3. But note content is still skipped in Electron — `db-hooks.ts` guards against OPFS init. Notes are stored as `.md` files in OPFS (Chrome extension) and need a filesystem equivalent for Electron.

## Approach: Strategy Pattern

Create a `NoteStore` interface with two implementations:
- **`OpfsNoteStore`** — wraps existing OPFS logic (Chrome extension)
- **`FsNoteStore`** — uses Node.js `fs` via Electron IPC (desktop app)

A factory picks the implementation at init time. All 7 import sites switch from `opfs-note-store` to `note-store`.

## Interface

```typescript
export interface NoteStore {
  init(): Promise<void>;
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, markdown: string): Promise<void>;
  remove(nodeId: string): Promise<void>;
  list(): Promise<string[]>;
  exists(nodeId: string): Promise<boolean>;
}
```

## Architecture

```
Chrome Extension:
  note-store.ts → OpfsNoteStore → navigator.storage.getDirectory() → OPFS

Electron:
  note-store.ts → FsNoteStore → IPC → main process → fs → vault directory
```

### Vault directory

`app.getPath('userData')/notes/` (e.g., `~/Library/Application Support/kg-extension/notes/`). User-configurable path deferred to Phase 6.

### File naming

Same as OPFS: `{nodeId}.md`. Compatible — could copy files between OPFS export and vault.

## Files

| File | Change |
|------|--------|
| `src/notes/note-store.ts` | **Create** — NoteStore interface, singleton, factory |
| `src/notes/opfs-note-store.ts` | **Modify** — Refactor to class implementing NoteStore |
| `electron/notes-backend.ts` | **Create** — fs-based note operations |
| `electron/main.ts` | **Modify** — Register notes IPC handlers |
| `electron/preload.ts` | **Modify** — Expose electronNotes API |
| `src/db/client/db-hooks.ts` | **Modify** — Init note store for both platforms |
| 6 UI files | **Modify** — Update imports from `opfs-note-store` → `note-store` |

## Verification

1. Electron: create note → close → reopen → note content persists
2. Electron: check `~/Library/Application Support/kg-extension/notes/` for `.md` files
3. Chrome extension: notes still work via OPFS (unchanged behavior)
4. Cross-tab sync: `note_content_updated` BroadcastChannel events still fire
