# Electron Phase 1: Platform Storage

## Context

Phase 0 delivered an Electron shell with no-op Chrome API stubs. The app renders but can't persist anything — API keys, settings, and cached data are silently discarded. This phase makes `chrome.storage.local` actually work in Electron by backing the stubs with real persistence via IPC to the main process.

## Approach: Upgrade Stubs, Not Refactor

Instead of creating a platform abstraction layer and refactoring 51 call sites, we make the existing `chrome.storage.local` API work in Electron. The stubs in `install-chrome-stubs.ts` become real implementations backed by Electron IPC.

**Result:** Zero changes to UI code. All existing `chrome.storage.local.get/set/remove` calls and `chrome.storage.onChanged` listeners work identically in both Chrome extension and Electron.

## Storage Keys

| Key | Category | Encrypt | Read By | Written By |
|-----|----------|---------|---------|------------|
| `llmConfig` | Settings + Secret | `apiKey` field only | UI (8 places), SW (4 places) | UI (SettingsPanel) |
| `anthropicOAuth` | Secret | Entire value | SW (oauth.ts) | SW (oauth.ts) |
| `usageRecords` | Cached Data | No | UI (3), SW (4) | SW (usage-tracker) |
| `usageBudget` | Settings | No | UI (3), SW (1) | UI (SettingsPanel) |
| `readingListItems` | Cached Data | No | UI (1), SW (8) | SW (reading-list-handler) |
| `displayMode` | UI State | No | SW (1), UI (1) | UI (useDisplayMode) |
| `contextualRelevanceEnabled` | Settings | No | UI (2) | UI (SettingsPanel) |
| `extractionNotesEnabled` | Settings | No | UI (2) | UI (PromptInput) |
| `privacyDisclosureAccepted` | UI State | No | UI (3) | UI (PrivacyDisclosure) |
| `usageBackendType` | Cached Data | No | UI (2), SW (1) | SW (index.ts) |

## Architecture

```
Renderer (UI)                          Main Process
┌─────────────────────┐                ┌──────────────────────────┐
│ chrome.storage.local │                │ StorageBackend           │
│   .get()  ──────────── ipc invoke ──→│   read from storage.json │
│   .set()  ──────────── ipc invoke ──→│   write to storage.json  │
│   .remove()─────────── ipc invoke ──→│   delete from storage.json│
│                       │                │                          │
│ chrome.storage        │                │ Secret keys:             │
│   .onChanged ←──────── ipc event ────│   safeStorage.encrypt()  │
│   .addListener()      │                │   safeStorage.decrypt()  │
└─────────────────────┘                └──────────────────────────┘
```

### Main Process: StorageBackend

New file `electron/storage-backend.ts`:
- Reads/writes `storage.json` in `app.getPath('userData')`
- On `get(keys)`: reads file, returns requested key-value pairs. For secret keys, decrypts via `safeStorage.decryptString()`
- On `set(items)`: reads file, merges new values, writes file. For secret keys, encrypts via `safeStorage.encryptString()`. Computes diff (old vs new values), broadcasts `storage:changed` event to all BrowserWindows
- On `remove(keys)`: reads file, deletes keys, writes file. Broadcasts changes
- Secret detection: key is `anthropicOAuth`, OR key is `llmConfig` and value has `apiKey` property — encrypt the `apiKey` field only, leave `provider`/`model` in plaintext

### Preload: electronStorage API

Additions to `electron/preload.ts`:
- `electronStorage.get(keys)` → `ipcRenderer.invoke('storage:get', keys)`
- `electronStorage.set(items)` → `ipcRenderer.invoke('storage:set', items)`
- `electronStorage.remove(keys)` → `ipcRenderer.invoke('storage:remove', keys)`
- `electronStorage.onChanged(callback)` → `ipcRenderer.on('storage:changed', callback)` — returns unsubscribe function

### Stubs Upgrade

`src/platform/install-chrome-stubs.ts` changes:
- `chrome.storage.local.get` calls `window.electronStorage.get()`
- `chrome.storage.local.set` calls `window.electronStorage.set()`
- `chrome.storage.local.remove` calls `window.electronStorage.remove()`
- `chrome.storage.onChanged.addListener(fn)` registers via `window.electronStorage.onChanged(fn)`. The callback receives `(changes, areaName)` matching Chrome's API signature

### Edge Cases

- **safeStorage unavailability**: On some Linux desktops without a keyring, `safeStorage.isEncryptionAvailable()` returns false. Fallback: store secrets in plaintext with a console warning.
- **File corruption**: If `storage.json` is malformed, catch JSON parse error, log warning, start with empty storage.
- **Concurrent writes**: All storage ops are serialized through the main process (single-threaded IPC handlers), so no race conditions.
- **Large values**: `readingListItems` and `usageRecords` can grow. JSON file handles this fine up to ~100MB. No concern at current scale.

## Files

| File | Change |
|------|--------|
| `electron/storage-backend.ts` | **Create** — StorageBackend class with JSON file + safeStorage |
| `electron/main.ts` | **Modify** — Register IPC handlers, instantiate StorageBackend |
| `electron/preload.ts` | **Modify** — Expose electronStorage API via contextBridge |
| `src/platform/install-chrome-stubs.ts` | **Modify** — Upgrade stubs to use electronStorage IPC |

## Verification

1. Launch Electron app, open Settings, enter an API key → close and reopen → key persists
2. Check `~/Library/Application Support/kg-extension/storage.json` — apiKey field should be encrypted (Base64 blob), other fields plaintext
3. Change a setting in one window → verify `onChanged` fires (for future multi-window support)
4. `npm run build` (Chrome extension) still works — stubs only activate when `window.electronStorage` exists
5. Chrome extension in browser works identically — no behavior change
