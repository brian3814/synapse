# Pitfall: `File.path` broken on macOS in Electron 30+

## Problem

Electron historically added a non-standard `.path` property to the Web API `File` object, giving the absolute filesystem path for files obtained through `<input type="file">` or drag-and-drop from the OS. Starting with Electron 30, this property is **deprecated** and returns `undefined` or an empty string on macOS for files obtained via drag-and-drop.

This affects any code that reads `event.dataTransfer.files[i].path` after a drop event — a pattern widely used in Electron apps for importing external files.

## Error Behaviour

- `(file as any).path` returns `undefined` or `''` on macOS with Electron 30+
- No error is thrown — the value is silently empty
- `<input type="file">` is **not affected** — `File.path` still works there
- The issue appears to be related to macOS filesystem security changes (sandboxing / TCC)
- The `File` object itself is valid — `file.name`, `file.size`, `file.type`, and `file.arrayBuffer()` all work correctly

## Root Cause

Electron deprecated `File.path` in favour of the new `webUtils.getPathForFile(file)` API introduced in Electron 22. The deprecation became a breaking change around Electron 30 on macOS, where the OS-level security model prevents the renderer process from accessing the real path through the legacy mechanism.

## Solution

Use `webUtils.getPathForFile(file)` from the `electron` module. Since this API is only available in the **preload** script (not the renderer), expose it via the context bridge:

### preload.ts

```typescript
import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronIPC', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  // File.path is deprecated and broken on macOS in Electron 30+.
  // webUtils.getPathForFile is the replacement but must be called from preload.
  // See: https://github.com/electron/electron/issues/43534
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
```

### Renderer usage

```typescript
const ipc = (window as any).electronIPC;
const filePaths = Array.from(event.dataTransfer.files)
  .map(f => ipc.getPathForFile ? ipc.getPathForFile(f) : (f as any).path)
  .filter(Boolean);
```

The fallback to `(f as any).path` provides backwards compatibility if running on an older Electron version without `getPathForFile` exposed.

## Where this applies in the codebase

- `electron/preload.ts` — exposes `getPathForFile` via context bridge
- `src/ui/components/vault-explorer/VaultExplorer.tsx` — external file drop handler

## Resources

- [Electron #43534: path not set on DataTransfer.files on drop event](https://github.com/electron/electron/issues/43534)
- [Electron #44370: File API — no longer possible to get a dropped file's absolute path](https://github.com/electron/electron/issues/44370)
- [Electron #44600: Breaking change in webUtils.getPathForFile on macOS](https://github.com/electron/electron/issues/44600)
- [VS Code PR #213031: replace File.path with webUtils](https://github.com/microsoft/vscode/pull/213031)
- [Electron docs: webUtils.getPathForFile](https://www.electronjs.org/docs/latest/api/web-utils#webutilsgetpathforfilefile)
