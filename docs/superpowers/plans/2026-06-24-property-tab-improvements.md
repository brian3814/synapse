# Property Tab Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade NodeDetailPanel's property section from raw JSON to inline-editable key-value fields with save/revert, and add an entity file markdown preview with "Open in Editor" support.

**Architecture:** Rewrite `PropertyEditor.tsx` as a self-contained inline-edit component with dirty tracking. Add entity file preview section to `NodeDetailPanel.tsx`. Branch `NoteEditor.tsx` read/write paths for entity nodes. Add `write` endpoint to the entity files platform API.

**Tech Stack:** React, Zustand, TypeScript, Electron IPC, existing `NoteMarkdownPreview` and `parseMarkdown` utilities.

## Global Constraints

- No new files — all changes go into existing files
- Follow existing Tailwind class patterns (zinc-700/800 backgrounds, indigo accents, text-xs for labels)
- Entity files are Electron-only — Chrome stubs return no-ops
- Properties are `Record<string, unknown>` — type detection is runtime-based

---

### Task 1: PropertyEditor Rewrite — Inline Click-to-Edit with Save/Revert

**Files:**
- Rewrite: `src/ui/components/panels/PropertyEditor.tsx`

**Interfaces:**
- Consumes: `value: Record<string, unknown>`, `onSave: (value: Record<string, unknown>) => void`, `nodeId: string`
- Produces: Self-contained component used by NodeDetailPanel in Task 3

- [ ] **Step 1: Write the new PropertyEditor component**

Replace the entire contents of `src/ui/components/panels/PropertyEditor.tsx` with:

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';

interface PropertyEditorProps {
  value: Record<string, unknown>;
  onSave: (value: Record<string, unknown>) => void;
  nodeId: string;
}

type PropType = 'string' | 'number' | 'boolean' | 'json';

function detectType(value: unknown): PropType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}

function formatValue(value: unknown, type: PropType): string {
  if (type === 'json') return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(raw: string, type: PropType): unknown {
  if (type === 'string') return raw;
  if (type === 'number') return Number(raw);
  if (type === 'boolean') return raw === 'true';
  return JSON.parse(raw);
}

function deepEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function PropertyEditor({ value, onSave, nodeId }: PropertyEditorProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(value);
  const [baseline, setBaseline] = useState<Record<string, unknown>>(value);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<PropType>('string');
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  // Reset when node changes
  useEffect(() => {
    setDraft(value);
    setBaseline(value);
    setEditingField(null);
    setEditingKey(null);
    setJsonErrors({});
  }, [nodeId]);

  // Sync when external value changes (e.g., after panel-level save)
  useEffect(() => {
    if (!deepEqual(value, baseline)) {
      setDraft(value);
      setBaseline(value);
    }
  }, [value]);

  const isDirty = !deepEqual(draft, baseline);

  const updateField = useCallback((key: string, newVal: unknown) => {
    setDraft(prev => ({ ...prev, [key]: newVal }));
    setJsonErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const removeField = useCallback((key: string) => {
    setDraft(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setJsonErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const renameKey = useCallback((oldKey: string, newKeyName: string) => {
    if (!newKeyName.trim() || newKeyName === oldKey) {
      setEditingKey(null);
      return;
    }
    setDraft(prev => {
      const entries = Object.entries(prev);
      const next: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        next[k === oldKey ? newKeyName.trim() : k] = v;
      }
      return next;
    });
    setEditingKey(null);
  }, []);

  const addProperty = useCallback(() => {
    const key = newKey.trim();
    if (!key || key in draft) return;
    let val: unknown;
    if (newType === 'string') val = newValue;
    else if (newType === 'number') val = Number(newValue) || 0;
    else if (newType === 'boolean') val = false;
    else {
      try { val = JSON.parse(newValue || '{}'); } catch { val = {}; }
    }
    setDraft(prev => ({ ...prev, [key]: val }));
    setNewKey('');
    setNewValue('');
    setNewType('string');
  }, [newKey, newValue, newType, draft]);

  const handleSave = useCallback(() => {
    onSave(draft);
    setBaseline(draft);
  }, [draft, onSave]);

  const handleRevert = useCallback(() => {
    setDraft(baseline);
    setEditingField(null);
    setEditingKey(null);
    setJsonErrors({});
  }, [baseline]);

  const entries = Object.entries(draft);

  return (
    <div className="space-y-1">
      {entries.length === 0 && (
        <p className="text-xs text-zinc-600 italic">No properties</p>
      )}

      {entries.map(([key, val]) => {
        const type = detectType(val);
        return (
          <PropertyRow
            key={key}
            propKey={key}
            value={val}
            type={type}
            isEditing={editingField === key}
            isEditingKey={editingKey === key}
            jsonError={jsonErrors[key]}
            onStartEdit={() => {
              if (editingField && editingField !== key) {
                // Confirm the previous field
                setEditingField(null);
              }
              setEditingField(key);
            }}
            onStartKeyEdit={() => setEditingKey(key)}
            onChange={(newVal) => updateField(key, newVal)}
            onJsonError={(err) => setJsonErrors(prev => ({ ...prev, [key]: err }))}
            onBlur={() => setEditingField(null)}
            onRenameKey={(newName) => renameKey(key, newName)}
            onRemove={() => removeField(key)}
          />
        );
      })}

      {/* Add property row */}
      <div className="flex items-center gap-1 pt-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addProperty()}
          placeholder="key"
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
        {newType !== 'boolean' && (
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProperty()}
            placeholder="value"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          />
        )}
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as PropType)}
          className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-400 outline-none"
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="json">JSON</option>
        </select>
        <button
          onClick={addProperty}
          disabled={!newKey.trim()}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 px-1"
        >
          +
        </button>
      </div>

      {/* Save / Revert bar */}
      {isDirty && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500"
          >
            Save
          </button>
          <button
            onClick={handleRevert}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            Revert
          </button>
        </div>
      )}
    </div>
  );
}

// ── Individual property row ──────────────────────────────────────────

interface PropertyRowProps {
  propKey: string;
  value: unknown;
  type: PropType;
  isEditing: boolean;
  isEditingKey: boolean;
  jsonError?: string;
  onStartEdit: () => void;
  onStartKeyEdit: () => void;
  onChange: (value: unknown) => void;
  onJsonError: (err: string) => void;
  onBlur: () => void;
  onRenameKey: (newName: string) => void;
  onRemove: () => void;
}

function PropertyRow({
  propKey, value, type, isEditing, isEditingKey, jsonError,
  onStartEdit, onStartKeyEdit, onChange, onJsonError, onBlur, onRenameKey, onRemove,
}: PropertyRowProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const [keyDraft, setKeyDraft] = useState(propKey);

  useEffect(() => {
    if (isEditing && inputRef.current) inputRef.current.focus();
  }, [isEditing]);

  useEffect(() => {
    if (isEditingKey && keyInputRef.current) keyInputRef.current.focus();
  }, [isEditingKey]);

  useEffect(() => {
    setKeyDraft(propKey);
  }, [propKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'json') {
      onBlur();
    }
    if (e.key === 'Escape') {
      onBlur();
    }
  };

  return (
    <div className="group flex items-start gap-2 py-0.5">
      {/* Key */}
      <div className="w-28 shrink-0">
        {isEditingKey ? (
          <input
            ref={keyInputRef}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={() => onRenameKey(keyDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameKey(keyDraft);
              if (e.key === 'Escape') { setKeyDraft(propKey); onRenameKey(propKey); }
            }}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          />
        ) : (
          <span
            onClick={onStartKeyEdit}
            className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 truncate block"
            title={propKey}
          >
            {propKey}
          </span>
        )}
      </div>

      {/* Value */}
      <div className="flex-1 min-w-0">
        {type === 'boolean' ? (
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-indigo-500"
          />
        ) : isEditing ? (
          type === 'json' ? (
            <div>
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                defaultValue={formatValue(value, type)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    onChange(parsed);
                    onJsonError('');
                  } catch {
                    onJsonError('Invalid JSON');
                  }
                }}
                onBlur={onBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onBlur();
                }}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 font-mono outline-none focus:border-indigo-500 resize-y min-h-[60px]"
                spellCheck={false}
              />
              {jsonError && <p className="text-xs text-red-400 mt-0.5">{jsonError}</p>}
            </div>
          ) : type === 'number' ? (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="number"
              defaultValue={Number(value)}
              onChange={(e) => onChange(Number(e.target.value))}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              defaultValue={String(value)}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
            />
          )
        ) : (
          <span
            onClick={onStartEdit}
            className={`text-xs cursor-pointer hover:text-zinc-100 block truncate ${
              type === 'json' ? 'text-zinc-400 font-mono' : 'text-zinc-200'
            }`}
            title={formatValue(value, type)}
          >
            {type === 'json' ? JSON.stringify(value) : String(value)}
          </span>
        )}
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-0.5 shrink-0"
        title="Remove property"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit (build will be fixed in Task 3)**

The old `PropertyEditor` took `{ value, onChange }`. The new one takes `{ value, onSave, nodeId }`. NodeDetailPanel still passes the old props, so the build will have a type error until Task 3 updates it. Commit now — the intermediate state is fine since Tasks 1-3 are applied sequentially.

```bash
git add src/ui/components/panels/PropertyEditor.tsx
git commit -m "feat(properties): rewrite PropertyEditor with inline click-to-edit and save/revert"
```

---

### Task 2: EntityFiles `write` Endpoint

**Files:**
- Modify: `src/platform/types.ts:144-152` (PlatformEntityFiles interface)
- Modify: `electron/entity-files/entity-file-service.ts:404-507` (add writeEntityFile method)
- Modify: `electron/entity-files/ipc-handlers.ts:1-56` (register write handler)
- Modify: `src/platform/electron/index.ts:30-38` (add write to entityFiles)
- Modify: `src/platform/chrome/index.ts:31-39` (add write stub)
- Test: `tests/entity-files/entity-file-service.test.ts`

**Interfaces:**
- Consumes: Existing `EntityFileService` class, `VaultContext`, `computeFileHash`
- Produces: `entityFiles.write(nodeId, markdown, expectedHash?)` available from `@platform`

- [ ] **Step 1: Write the failing test**

Add at the end of `tests/entity-files/entity-file-service.test.ts`, inside the top-level `describe('EntityFileService', ...)` block:

```ts
  describe('writeEntityFile', () => {
    it('overwrites entity file content and updates DB metadata', async () => {
      const node = makeNode({ name: 'Test Entity' });
      insertNode(env.db, node);
      env.eventBus.emit({ type: 'node:created', node });

      // Verify file was generated
      const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(row.vault_path).toBeTruthy();

      const newContent = '---\nid: ' + node.id + '\ntitle: Test Entity\n---\n\n# Test Entity\n\nRewritten content.\n';
      const result = service.writeEntityFile(node.id, newContent);

      expect(result.contentHash).toBeTruthy();
      const onDisk = readFileSync(join(env.vaultPath, row.vault_path), 'utf-8');
      expect(onDisk).toBe(newContent);

      // DB metadata updated
      const dbRow = env.db.prepare('SELECT file_mtime, file_size, content_hash FROM nodes WHERE id = ?').get(node.id) as any;
      expect(dbRow.file_mtime).toBeGreaterThan(0);
      expect(dbRow.file_size).toBe(Buffer.byteLength(newContent));
      expect(dbRow.content_hash).toBe(result.contentHash);
    });

    it('throws when node has no vault_path', () => {
      const node = makeNode({ name: 'No File' });
      insertNode(env.db, node);
      // Don't emit node:created — no file generated, vault_path is null

      expect(() => service.writeEntityFile(node.id, 'content')).toThrow('no vault_path');
    });

    it('rejects on hash mismatch when expectedHash provided', async () => {
      const node = makeNode({ name: 'Hash Check' });
      insertNode(env.db, node);
      env.eventBus.emit({ type: 'node:created', node });

      expect(() => service.writeEntityFile(node.id, 'new content', 'wrong-hash')).toThrow('Hash mismatch');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/entity-files/entity-file-service.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — `service.writeEntityFile is not a function`

- [ ] **Step 3: Add `writeEntityFile` to EntityFileService**

In `electron/entity-files/entity-file-service.ts`, add after the `patchEntityFile` method (after line 507):

```ts
  writeEntityFile(
    nodeId: string,
    markdown: string,
    expectedHash?: string,
  ): { contentHash: string } {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(nodeId) as { vault_path: string | null } | undefined;

    const vaultPath = row?.vault_path;
    if (!vaultPath) {
      throw new Error(`Node ${nodeId} has no vault_path — generate the entity file first`);
    }

    const absolutePath = this.ctx.resolve(vaultPath);

    if (expectedHash !== undefined) {
      const currentHash = computeFileHash(absolutePath);
      if (currentHash !== expectedHash) {
        throw new Error(`Hash mismatch for ${vaultPath}: expected ${expectedHash}, got ${currentHash}`);
      }
    }

    this.markAsAppWritten?.(vaultPath);
    writeFileSync(absolutePath, markdown, 'utf-8');

    const stat = statSync(absolutePath);
    const newHash = computeFileHash(absolutePath) ?? '';

    this.ctx.db.prepare(
      'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(Math.floor(stat.mtimeMs), stat.size, newHash, nodeId);

    return { contentHash: newHash };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/entity-files/entity-file-service.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: All tests PASS including the new `writeEntityFile` tests.

- [ ] **Step 5: Add IPC handler**

In `electron/entity-files/ipc-handlers.ts`, add after the `entity-files:patch` handler (after line 45):

```ts
  ipcMain.handle('entity-files:write', async (_e, nodeId: string, markdown: string, expectedHash?: string) => {
    const service = getService();
    if (!service) throw new Error('EntityFileService not initialized');
    return service.writeEntityFile(nodeId, markdown, expectedHash);
  });
```

In the `unregisterEntityFileIpc` function, add:

```ts
  ipcMain.removeHandler('entity-files:write');
```

- [ ] **Step 6: Add `write` to PlatformEntityFiles interface**

In `src/platform/types.ts`, add after the `patch` method (line 151):

```ts
  write(nodeId: string, markdown: string, expectedHash?: string): Promise<{ contentHash: string }>;
```

- [ ] **Step 7: Add `write` to Electron platform export**

In `src/platform/electron/index.ts`, add after the `patch` method in the `entityFiles` object:

```ts
  async write(nodeId: string, markdown: string, expectedHash?: string) { return window.electronIPC.invoke('entity-files:write', nodeId, markdown, expectedHash) as Promise<{ contentHash: string }>; },
```

- [ ] **Step 8: Add `write` stub to Chrome platform**

In `src/platform/chrome/index.ts`, add after the `patch` line in the `entityFiles` object:

```ts
  async write() { return { contentHash: '' }; },
```

- [ ] **Step 9: Verify build compiles**

Run: `npm run build:electron-renderer 2>&1 | tail -10`

Expected: No errors related to `entityFiles` or `PlatformEntityFiles`.

- [ ] **Step 10: Commit**

```bash
git add src/platform/types.ts electron/entity-files/entity-file-service.ts electron/entity-files/ipc-handlers.ts src/platform/electron/index.ts src/platform/chrome/index.ts tests/entity-files/entity-file-service.test.ts
git commit -m "feat(entity-files): add write endpoint for full-content overwrite"
```

---

### Task 3: NodeDetailPanel — Property Integration + Entity File Preview

**Files:**
- Modify: `src/ui/components/panels/NodeDetailPanel.tsx`

**Interfaces:**
- Consumes: `PropertyEditor` from Task 1 (`{ value, onSave, nodeId }`), `entityFiles.read()` and `entityFiles.generateAll()` from `@platform`, `NoteMarkdownPreview` from `../shared/MarkdownRenderer`, `parseMarkdown` from `../../../filesystem/markdown-parser`
- Produces: Updated panel with inline property editing and entity file preview section

- [ ] **Step 1: Update imports**

At the top of `src/ui/components/panels/NodeDetailPanel.tsx`, add these imports:

```ts
import { entityFiles } from '@platform';
import { NoteMarkdownPreview } from '../shared/MarkdownRenderer';
import { parseMarkdown } from '../../../filesystem/markdown-parser';
```

- [ ] **Step 2: Add entity file state and loading effect**

After the existing `useEffect` that loads tags (around line 97-109), add:

```ts
  const [entityFileContent, setEntityFileContent] = useState<string | null>(null);
  const [entityFileLoading, setEntityFileLoading] = useState(false);
  const [entityFileExpanded, setEntityFileExpanded] = useState(false);
  const [entityFileGenerating, setEntityFileGenerating] = useState(false);

  useEffect(() => {
    if (!node || node.type !== 'entity') {
      setEntityFileContent(null);
      return;
    }
    let cancelled = false;
    setEntityFileLoading(true);
    entityFiles.read(node.id).then((result) => {
      if (cancelled) return;
      if (result) {
        const parsed = parseMarkdown(result.content);
        setEntityFileContent(parsed.content);
      } else {
        setEntityFileContent(null);
      }
    }).catch(() => {
      if (!cancelled) setEntityFileContent(null);
    }).finally(() => {
      if (!cancelled) setEntityFileLoading(false);
    });
    return () => { cancelled = true; };
  }, [node?.id, node?.type]);
```

- [ ] **Step 3: Add handleSaveProperties and handleGenerateEntityFile**

After the existing `handleDelete` function, add:

```ts
  const handleSaveProperties = async (newProps: Record<string, unknown>) => {
    await updateNode({ id: node.id, properties: newProps });
  };

  const handleGenerateEntityFile = async () => {
    setEntityFileGenerating(true);
    try {
      await entityFiles.generateAll();
      // Reload the entity file
      const result = await entityFiles.read(node.id);
      if (result) {
        const parsed = parseMarkdown(result.content);
        setEntityFileContent(parsed.content);
      }
    } finally {
      setEntityFileGenerating(false);
    }
  };

  const handleOpenEntityFile = () => {
    useUIStore.getState().openContentTab(
      { kind: 'noteEditor', noteId: node.id },
      node.name
    );
  };
```

- [ ] **Step 4: Replace the Properties section**

Replace the Properties section (the `<div>` containing the Properties label + the `editing ? PropertyEditor : <pre>` conditional) with:

```tsx
      {/* Properties */}
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Properties</label>
        <PropertyEditor value={node.properties} onSave={handleSaveProperties} nodeId={node.id} />
      </div>
```

Remove the `properties` state variable from the `useState` declarations (line 32) and remove `setProperties(node.properties)` from the `useEffect` that loads node data (line 102). Also remove `properties` from the `handleSave` call — it's no longer part of the panel-level save since PropertyEditor manages its own save.

Update `handleSave` to not include `properties`:

```ts
  const handleSave = async () => {
    await updateNode({
      id: node.id,
      name,
      type,
      label: type === 'entity' ? (label ?? undefined) : undefined,
    });
    await tags.setForNode(node.id, nodeTags);
    setEditing(false);
  };
```

- [ ] **Step 5: Add Entity File Preview section**

After the Properties `<div>` and before the Sources section, add:

```tsx
      {/* Entity File Preview */}
      {node.type === 'entity' && (
        <div>
          <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5 mb-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            Entity File
          </label>

          {entityFileLoading ? (
            <div className="flex items-center gap-2 py-2">
              <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-500">Loading...</span>
            </div>
          ) : entityFileContent === null ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-600 italic">No entity file</span>
              <button
                onClick={handleGenerateEntityFile}
                disabled={entityFileGenerating}
                className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 disabled:opacity-50"
              >
                {entityFileGenerating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          ) : (
            <div>
              <div className={`relative ${entityFileExpanded ? '' : 'max-h-[200px] overflow-hidden'}`}>
                <div className="bg-zinc-800 rounded p-2">
                  <NoteMarkdownPreview
                    content={entityFileContent}
                    onNodeClick={(nodeId) => handleNavigateToNode(nodeId)}
                  />
                </div>
                {!entityFileExpanded && (
                  <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-zinc-900 to-transparent rounded-b pointer-events-none" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={() => setEntityFileExpanded(!entityFileExpanded)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {entityFileExpanded ? 'Show less' : 'Show more'}
                </button>
                <button
                  onClick={handleOpenEntityFile}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-700/40 rounded text-sky-300 font-medium"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  Open in Editor
                </button>
              </div>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 6: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -10`

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/panels/NodeDetailPanel.tsx
git commit -m "feat(properties): integrate PropertyEditor + entity file preview in NodeDetailPanel"
```

---

### Task 4: NoteEditor Entity File Read/Write Branching

**Files:**
- Modify: `src/ui/components/notes/NoteEditor.tsx`

**Interfaces:**
- Consumes: `entityFiles.read()` and `entityFiles.write()` from `@platform` (Task 2), `graphStore.nodes` for type detection
- Produces: NoteEditor that handles both note and entity file editing

- [ ] **Step 1: Add entity files import**

At the top of `src/ui/components/notes/NoteEditor.tsx`, add:

```ts
import { entityFiles } from '@platform';
```

- [ ] **Step 2: Detect node type and branch the read path**

Inside the `NoteEditor` component, after the `effectiveNodeIdRef` and `lastSaved*` refs, add:

```ts
  const nodeType = graphStore.nodes.find((n) => n.id === nodeId)?.type;
  const isEntity = nodeType === 'entity';
```

Replace the existing `useEffect` that loads the note (the one calling `notes.read(nodeId)`, around lines 39-54) with:

```ts
  useEffect(() => {
    if (!nodeId) return;

    const node = graphStore.nodes.find((n) => n.id === nodeId);
    if (node) {
      setTitle(node.name);
      lastSavedTitleRef.current = node.name;
    }

    if (isEntity) {
      entityFiles.read(nodeId).then((result) => {
        if (result) {
          const parsed = parseMarkdown(result.content);
          if (parsed.title) {
            setTitle(parsed.title);
            lastSavedTitleRef.current = parsed.title;
          }
          setContent(parsed.content);
          lastSavedContentRef.current = parsed.content;
        }
      }).catch(() => {});
    } else {
      notes.read(nodeId).then((md) => {
        if (md) {
          const parsed = parseMarkdown(md);
          setContent(parsed.content);
          lastSavedContentRef.current = parsed.content;
        }
      }).catch(() => {});
    }
  }, [nodeId]);
```

- [ ] **Step 3: Branch the save path**

Inside the `handleSave` callback, replace the `if (nodeId)` branch (the existing-note save path, around lines 113-137) with:

```ts
      if (nodeId) {
        const wikiLinks = extractWikiLinks(content);
        const markdown = generateNoteMarkdown(title, content, wikiLinks);

        if (isEntity) {
          // Entity file: write via entityFiles API, skip note-specific side effects
          await entityFiles.write(nodeId, markdown);
          await graphStore.updateNode({ id: nodeId, name: title });
        } else {
          // Note: existing path
          await notes.write(nodeId, markdown);
          await noteSearch.upsert(nodeId, title, stripMarkdownToPlainText(content));
          await graphStore.updateNode({
            id: nodeId,
            name: title,
            properties: { wikiLinks },
          });
        }
```

Keep the rest of the save function (the `else` branch for creating new notes, the broadcast, the filesystem sync) as-is, but wrap the note-specific parts with a guard:

After the entity/note save branch, wrap the BroadcastChannel sync and filesystem sync in `if (!isEntity)`:

```ts
        if (!isEntity) {
          // Broadcast content update to other tabs
          const savedId = nodeId ?? graphStore.nodes.find((n) => n.name === title && n.type === 'note')?.id;
          if (savedId) {
            const channel = new BroadcastChannel(SYNC_CHANNEL);
            channel.postMessage({ type: 'note_content_updated', nodeId: savedId } satisfies SyncEvent);
            channel.close();
          }

          // Optionally sync to filesystem
          try {
            const folderHandle = await getStoredFolder();
            if (folderHandle) {
              const fileName = sanitizeFileName(title) + '.md';
              await writeMarkdownFile(folderHandle, `notes/${fileName}`, markdown);
            }
          } catch {
            // Folder not connected or permission denied — that's fine
          }
        }
```

- [ ] **Step 4: Guard the external change detection**

In the `useEffect` for external file change detection (around lines 74-85), wrap the entire effect body in a guard:

```ts
  useEffect(() => {
    if (!nodeId || !notes.onExternalChange || isEntity) return;
    return notes.onExternalChange((changedNodeId) => {
      if (changedNodeId !== nodeId) return;
      const isDirty = title !== lastSavedTitleRef.current || content !== lastSavedContentRef.current;
      if (isDirty) {
        setShowConflictModal(true);
      } else {
        reloadFromDisk(nodeId);
      }
    });
  }, [nodeId, title, content, isEntity]);
```

- [ ] **Step 5: Guard the cross-tab BroadcastChannel sync**

In the `useEffect` for BroadcastChannel sync (around lines 57-71), add the entity guard:

```ts
  useEffect(() => {
    if (!nodeId || isEntity) return;
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    // ... rest unchanged
```

- [ ] **Step 6: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -10`

Expected: Build succeeds with no errors.

- [ ] **Step 7: Manual testing**

Run: `npm run build:electron && npx electron .`

Test the following:
1. Select an entity node → verify properties show as editable key-value fields
2. Click a string property value → verify it becomes a text input
3. Click a number property value → verify it becomes a number input with stepper
4. Toggle a boolean property → verify checkbox works
5. Edit a value, verify Save/Revert bar appears
6. Click Revert → verify changes are discarded
7. Click Save → verify changes persist (re-select the node to confirm)
8. Add a new property → verify it appears in the list
9. Remove a property → verify it disappears
10. Rename a property key → verify key changes, value preserved
11. Select an entity with an entity file → verify markdown preview appears
12. Click "Show more" / "Show less" → verify expansion works
13. Click "Open in Editor" → verify entity file opens in a content tab
14. Edit and save in the editor → verify changes persist
15. Select a note node → verify properties still work, no entity file section

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/notes/NoteEditor.tsx
git commit -m "feat(entity-files): branch NoteEditor read/write for entity file editing"
```
