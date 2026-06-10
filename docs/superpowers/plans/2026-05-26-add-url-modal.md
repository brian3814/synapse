# Add URL Modal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline single-URL add form with a modal supporting multi-URL paste, live validation preview, async title extraction, HTTP warnings, and improved relative time display.

**Architecture:** New `AddUrlModal` component (follows `SettingsModal` pattern) replaces the `AddUrlForm` function in `ReadingListPanel`. The store's `addItem` is simplified to auto-resolve the vault internally, and a new `fetchTitles` method handles background title resolution via HTML fetch + LLM fallback.

**Tech Stack:** React, Zustand, Electron IPC (`fetch-url-content`), LLM via `@platform` `llm.streamChat`

**Note:** No test framework is configured in this project. Each task includes build verification (`npm run build:electron-renderer`) and manual check instructions instead of automated tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/ui/components/reading-list/ReadingListItemCard.tsx` | Modify | Enhanced `timeAgo()` with weeks/months/years + "Added" prefix, HTTP shield indicator |
| `src/graph/store/reading-list-store.ts` | Modify | Simplified `addItem(url, title)` with internal vault resolution, new `fetchTitles()` method |
| `src/ui/components/reading-list/AddUrlModal.tsx` | Create | Modal with textarea, URL parsing, live preview, submit handler |
| `src/ui/components/reading-list/ReadingListPanel.tsx` | Modify | Replace `AddUrlForm` with `AddUrlModal`, remove vault state from add flow |

---

### Task 1: Enhanced timeAgo and HTTP indicator on ReadingListItemCard

**Files:**
- Modify: `src/ui/components/reading-list/ReadingListItemCard.tsx:26-35` (timeAgo function)
- Modify: `src/ui/components/reading-list/ReadingListItemCard.tsx:67-70` (pending card metadata row)
- Modify: `src/ui/components/reading-list/ReadingListItemCard.tsx:163-170` (ready card metadata row)

- [ ] **Step 1: Replace the `timeAgo` function**

Replace the existing `timeAgo` function (lines 26-35) with an enhanced version that handles weeks, months, and years with proper singular/plural:

```tsx
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
```

- [ ] **Step 2: Add the HTTP shield icon helper**

Add this component below the `timeAgo` function and above the `ReadingListItemCard` export:

```tsx
function HttpWarningIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-500 flex-shrink-0"
      aria-label="Insecure connection (HTTP)"
    >
      <title>Insecure connection (HTTP)</title>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
```

- [ ] **Step 3: Update metadata rows in the pending card**

In the pending card section (the `if (mode === 'pending')` block), find the metadata row (lines 67-70):

```tsx
            <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
```

Replace with:

```tsx
            <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
            {item.url.startsWith('http://') && (
              <>
                <span className="text-xs text-zinc-600">&middot;</span>
                <HttpWarningIcon />
              </>
            )}
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-500">Added {timeAgo(item.addedAt)}</span>
```

- [ ] **Step 4: Update metadata rows in the ready card**

In the ready card section (the `// mode === 'ready'` block), find the metadata row (lines 163-170):

```tsx
        <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
```

Replace with:

```tsx
        <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
        {item.url.startsWith('http://') && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <HttpWarningIcon />
          </>
        )}
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">Added {timeAgo(item.addedAt)}</span>
```

- [ ] **Step 5: Build and verify**

Run: `npm run build:electron-renderer`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/reading-list/ReadingListItemCard.tsx
git commit -m "feat(reading-list): enhanced relative time display and HTTP indicator on item cards"
```

---

### Task 2: Store changes — simplified addItem and fetchTitles

**Files:**
- Modify: `src/graph/store/reading-list-store.ts:1-4` (imports)
- Modify: `src/graph/store/reading-list-store.ts:6-24` (store interface)
- Modify: `src/graph/store/reading-list-store.ts:116-130` (addItem method)
- Add new method `fetchTitles` after `addItem`

- [ ] **Step 1: Add `vaultWorkspace` to imports**

In `src/graph/store/reading-list-store.ts`, line 3, change:

```ts
import { storage, browser, platformId, llm } from '@platform';
```

to:

```ts
import { storage, browser, platformId, llm, vaultWorkspace } from '@platform';
```

- [ ] **Step 2: Update the store interface**

In the `ReadingListStore` interface (lines 6-24), make vault params optional (backward compatible so existing callers still compile) and add `fetchTitles`:

```ts
  addItem: (url: string, title: string, vaultPath?: string, vaultName?: string) => Promise<void>;
  fetchTitles: (urls: string[]) => Promise<void>;
```

replaces:

```ts
  addItem: (url: string, title: string, vaultPath: string, vaultName: string) => Promise<void>;
```

The vault params are optional as a transitional step — they're ignored by the implementation (vault is resolved internally). Task 4 removes them entirely when the old `AddUrlForm` caller is deleted.

- [ ] **Step 3: Rewrite the `addItem` method with internal vault resolution**

Replace the existing `addItem` method (lines 116-130) with:

```ts
  addItem: async (url, title) => {
    const normalized = url.trim();
    if (!normalized) return;
    if (get().items[normalized]) return;

    let targetVaultPath: string | undefined;
    let targetVaultName: string | undefined;
    if (platformId === 'electron') {
      try {
        const status = await vaultWorkspace.getStatus();
        if (status.open) {
          targetVaultPath = status.path;
          targetVaultName = status.name;
        }
      } catch {}
    }

    const item: ReadingListItem = {
      url: normalized,
      title: title.trim() || normalized,
      addedAt: Date.now(),
      status: 'pending',
      targetVaultPath,
      targetVaultName,
    };
    set((state) => ({ items: { ...state.items, [normalized]: item } }));
    await storage.set({ readingListItems: get().items });
  },
```

- [ ] **Step 4: Add the `fetchTitles` method**

Add the following method directly after `addItem` (before `startBatchExtraction`):

```ts
  fetchTitles: async (urls) => {
    if (platformId !== 'electron') return;

    const ipc = (window as any).electronIPC;
    const BAD_TITLES = ['404', 'page not found', 'access denied', 'forbidden', 'not found', 'error', 'untitled'];

    for (const url of urls) {
      const item = get().items[url];
      if (!item || item.pageTitle) continue;

      try {
        const { html } = await ipc.invoke('fetch-url-content', url);
        if (!html) continue;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rawTitle = doc.querySelector('title')?.textContent?.trim() ?? '';

        const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; } })();
        const isUsable = rawTitle
          && rawTitle.toLowerCase() !== domain.toLowerCase()
          && !BAD_TITLES.includes(rawTitle.toLowerCase());

        let resolvedTitle = '';

        if (isUsable) {
          resolvedTitle = rawTitle;
        } else {
          try {
            const configResult = await storage.get('llmConfig') as Record<string, any>;
            const config = configResult.llmConfig;
            if (config?.apiKey) {
              const textContent = doc.body?.textContent?.slice(0, 2000) ?? '';
              if (textContent.trim()) {
                const result = await llm.streamChat({
                  requestId: crypto.randomUUID(),
                  model: config.model,
                  systemPrompt: 'Generate a concise title (about 5-8 words) for this web page content. Return only the title text, nothing else.',
                  messages: [{ role: 'user', content: textContent }],
                }, () => {});
                resolvedTitle = result.textContent.trim();
              }
            }
          } catch {}
        }

        if (resolvedTitle) {
          set((state) => ({
            items: {
              ...state.items,
              [url]: { ...state.items[url], pageTitle: resolvedTitle },
            },
          }));
          await storage.set({ readingListItems: get().items });
        }
      } catch {}

      if (urls.indexOf(url) < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  },
```

- [ ] **Step 5: Build and verify**

Run: `npm run build:electron-renderer`
Expected: Clean build, no errors. The optional vault params keep the old `ReadingListPanel` caller compatible.

- [ ] **Step 6: Commit**

```bash
git add src/graph/store/reading-list-store.ts
git commit -m "feat(reading-list): simplify addItem with internal vault resolution, add fetchTitles"
```

---

### Task 3: AddUrlModal component

**Files:**
- Create: `src/ui/components/reading-list/AddUrlModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `src/ui/components/reading-list/AddUrlModal.tsx` with the full implementation:

```tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import { useReadingListStore } from '../../../graph/store/reading-list-store';

type ParsedUrl = {
  raw: string;
  normalized: string;
  domain: string;
  status: 'valid' | 'insecure' | 'duplicate' | 'invalid';
};

function parseUrls(text: string, existingUrls: Set<string>): ParsedUrl[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  const results: ParsedUrl[] = [];

  for (const raw of lines) {
    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

    let domain = '';
    try {
      const u = new URL(normalized);
      domain = u.hostname.replace('www.', '');
    } catch {
      results.push({ raw, normalized, domain: '', status: 'invalid' });
      continue;
    }

    if (existingUrls.has(normalized) || seen.has(normalized)) {
      results.push({ raw, normalized, domain, status: 'duplicate' });
      continue;
    }

    seen.add(normalized);
    const isHttp = normalized.startsWith('http://');
    results.push({ raw, normalized, domain, status: isHttp ? 'insecure' : 'valid' });
  }

  return results;
}

interface AddUrlModalProps {
  onClose: () => void;
}

export function AddUrlModal({ onClose }: AddUrlModalProps) {
  const [text, setText] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const items = useReadingListStore((s) => s.items);
  const addItem = useReadingListStore((s) => s.addItem);
  const fetchTitles = useReadingListStore((s) => s.fetchTitles);

  useEffect(() => {
    textareaRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const existingUrls = useMemo(() => new Set(Object.keys(items)), [items]);
  const parsed = useMemo(() => parseUrls(text, existingUrls), [text, existingUrls]);
  const addable = parsed.filter((p) => p.status === 'valid' || p.status === 'insecure');

  const handleAdd = async () => {
    if (addable.length === 0) return;
    const urls: string[] = [];
    for (const p of addable) {
      const domain = p.domain || p.normalized;
      await addItem(p.normalized, domain);
      urls.push(p.normalized);
    }
    fetchTitles(urls);
    onClose();
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col"
        style={{ width: 480, maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-100">Add URLs to Reading List</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
          <p className="text-xs text-zinc-500">Paste one URL per line</p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"https://example.com/article-one\nhttps://example.com/article-two"}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 font-mono outline-none focus:border-indigo-500 resize-y"
          />

          {/* Live preview */}
          {parsed.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {parsed.map((p, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                    p.status === 'invalid' || p.status === 'duplicate'
                      ? 'text-zinc-500'
                      : 'text-zinc-300'
                  }`}
                >
                  <StatusIcon status={p.status} />
                  <span className="truncate flex-1 min-w-0">
                    {p.domain || p.raw}
                  </span>
                  <StatusLabel status={p.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={addable.length === 0}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addable.length === 0 ? 'Add URLs' : `Add ${addable.length} URL${addable.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ParsedUrl['status'] }) {
  if (status === 'valid') {
    return <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />;
  }
  if (status === 'insecure') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (status === 'duplicate') {
    return <span className="w-2 h-2 rounded-full bg-zinc-600 flex-shrink-0" />;
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-400 flex-shrink-0">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function StatusLabel({ status }: { status: ParsedUrl['status'] }) {
  if (status === 'insecure') {
    return <span className="text-amber-500 flex-shrink-0">insecure</span>;
  }
  if (status === 'duplicate') {
    return <span className="text-zinc-500 flex-shrink-0">already added</span>;
  }
  if (status === 'invalid') {
    return <span className="text-red-400 flex-shrink-0">invalid</span>;
  }
  return null;
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build:electron-renderer`
Expected: The new file compiles (it may still show errors from `ReadingListPanel.tsx` due to the old `addItem` 4-arg call — that's expected and fixed in Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/reading-list/AddUrlModal.tsx
git commit -m "feat(reading-list): add multi-URL modal component with live validation preview"
```

---

### Task 4: Wire modal into ReadingListPanel and remove old form

**Files:**
- Modify: `src/ui/components/reading-list/ReadingListPanel.tsx`
- Modify: `src/graph/store/reading-list-store.ts:18` (finalize addItem signature)

- [ ] **Step 1: Update imports**

At the top of `ReadingListPanel.tsx`, add the modal import and remove now-unused imports.

Change:

```tsx
import { platformId, vaultWorkspace } from '@platform';
import type { ReadingListItem } from '../../../shared/types';
import type { RecentVault, VaultStatus } from '@platform/vault-workspace';
```

to:

```tsx
import { platformId, vaultWorkspace } from '@platform';
import type { ReadingListItem } from '../../../shared/types';
import type { VaultStatus } from '@platform/vault-workspace';
import { AddUrlModal } from './AddUrlModal';
```

(`RecentVault` is no longer needed since we removed vault selection from the add flow.)

- [ ] **Step 2: Replace showAddForm state and remove vault-related add state**

In the `ReadingListPanel` function, find lines 27-37:

```tsx
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);

  // Vault info for filtering + add form
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  useEffect(() => {
    if (platformId !== 'electron') return;
    vaultWorkspace.getStatus().then(setVaultStatus);
    vaultWorkspace.getRecent().then(setRecentVaults);
  }, []);
```

Replace with:

```tsx
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectMode, setSelectMode] = useState(false);

  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  useEffect(() => {
    if (platformId !== 'electron') return;
    vaultWorkspace.getStatus().then(setVaultStatus);
  }, []);
```

(Removed `recentVaults` state and `getRecent()` call — no longer needed. Kept `vaultStatus` for item filtering.)

- [ ] **Step 3: Update the "+ Add URL" button**

Find the button in the header (line 104):

```tsx
            onClick={() => setShowAddForm(!showAddForm)}
```

Replace with:

```tsx
            onClick={() => setShowAddModal(true)}
```

- [ ] **Step 4: Replace the inline form with the modal**

Find the add form block (lines 112-124):

```tsx
      {/* Add URL form */}
      {showAddForm && (
        <AddUrlForm
          currentVaultPath={currentVaultPath ?? ''}
          currentVaultName={vaultStatus?.name ?? ''}
          recentVaults={recentVaults}
          onAdd={(url, title, vaultPath, vaultName) => {
            addItem(url, title, vaultPath, vaultName);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
```

Replace with:

```tsx
      {/* Add URL modal */}
      {showAddModal && (
        <AddUrlModal onClose={() => setShowAddModal(false)} />
      )}
```

- [ ] **Step 5: Remove `addItem` from the panel's store destructure**

In line 21, find:

```tsx
  const { items, loading, selectedUrl, selectItem, selectedUrls, toggleSelectUrl, selectAllPending, clearSelection, startBatchExtraction, addItem } = useReadingListStore();
```

Remove `addItem` (the modal handles its own store calls):

```tsx
  const { items, loading, selectedUrl, selectItem, selectedUrls, toggleSelectUrl, selectAllPending, clearSelection, startBatchExtraction } = useReadingListStore();
```

- [ ] **Step 6: Delete the entire `AddUrlForm` function**

Delete the `AddUrlForm` function at the bottom of the file (lines 243-331 — everything from `function AddUrlForm({` to the closing `}`). This function is no longer used.

- [ ] **Step 7: Finalize the store interface — remove optional vault params**

In `src/graph/store/reading-list-store.ts`, the interface still has optional vault params from the transitional step. Now that the old caller is gone, change:

```ts
  addItem: (url: string, title: string, vaultPath?: string, vaultName?: string) => Promise<void>;
```

to:

```ts
  addItem: (url: string, title: string) => Promise<void>;
```

- [ ] **Step 8: Build and verify**

Run: `npm run build:electron-renderer`
Expected: Clean build, no errors. All four files compile correctly together.

- [ ] **Step 9: Manual verification**

Run: `npm run build:electron && npx electron .`

Verify:
1. Click "+ Add URL" → modal opens centered with backdrop
2. Click backdrop or press Escape → modal closes
3. Paste multiple URLs (one per line) → live preview shows parsed domains
4. Paste a duplicate URL (one already in the list) → shows "already added" label
5. Paste an `http://` URL → shows amber shield icon + "insecure" label
6. Type garbage text → shows red X + "invalid" label
7. Click "Add N URLs" → modal closes, items appear in pending list with domain as title
8. After a few seconds, item titles update (async title extraction)
9. Existing pending items show "Added X days ago" format
10. HTTP items in the list show the amber shield icon next to the domain

- [ ] **Step 10: Commit**

```bash
git add src/ui/components/reading-list/ReadingListPanel.tsx src/graph/store/reading-list-store.ts
git commit -m "feat(reading-list): wire AddUrlModal into panel, remove old inline form and vault params"
```
