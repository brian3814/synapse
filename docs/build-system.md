# Build System

## Build Commands

```bash
# Chrome extension
npm run build                    # Vite production build → dist/
npm run dev                      # Vite build in watch mode (load dist/ in chrome://extensions)

# Electron desktop
npm run build:electron-main      # esbuild main process → dist-electron/main/
npm run build:electron-renderer  # Vite renderer build → dist-electron/renderer/
npm run build:electron           # Both main + renderer
npm run dist:mac                 # Package macOS app via electron-builder
npm run dist:win                 # Package Windows app via electron-builder
npm run dist:linux               # Package Linux app via electron-builder

# Companion extension
npm run build:companion          # Vite build → dist-companion/

# MCP CLI (standalone stdio server)
npm run build:mcp                # esbuild → packages/synapse-mcp/dist/
```

No test framework or linter is configured. For Chrome, load `dist/` as an unpacked extension in `chrome://extensions` (developer mode). For Electron, run `npx electron .` after building.

## Vite Configs

Two Vite configs share the same source via the `@platform` alias:

### `vite.config.chrome.ts` — 7 outputs (Chrome extension)

| Output | Plugin | Format |
|---|---|---|
| React SPA + service worker + offscreen | Main build (multi-entry) | ES modules |
| `db-worker.js` + `wa-sqlite-async.wasm` | `dbWorkerPlugin` | ES module (no content hash on WASM) |
| `db-shared-worker.js` | `dbSharedWorkerPlugin` | ES module |
| `layout-worker.js` | `layoutWorkerPlugin` | ES module |
| `content-script.js` | `contentScriptPlugin` | IIFE |

Key config: `base: ''` (chrome-extension:// relative paths), `modulePreload: false` (prevents DOM polyfill in SW). `@platform` → `src/platform/chrome/`.

### `vite.config.electron.ts` — 4 outputs (Electron renderer)

- React SPA + db-worker + db-shared-worker + layout-worker. No service worker, offscreen, or content script.
- `base: './'` for Electron `file://` or `app://` protocol. `@platform` → `src/platform/electron/`.

### Electron Main Process

Built separately via `esbuild` (not Vite): `electron/main.ts` + `electron/preload.ts` + `electron/embeddings/onnx-worker.ts` → `dist-electron/main/`.

## Important Constraints

- The `@platform` alias must exist in EVERY `resolve.alias` block across both configs — main build AND all sub-build plugins (contentScript, layoutWorker, dbWorker, dbSharedWorker).
- CSP `script-src 'self' 'wasm-unsafe-eval'` blocks all `blob:` URLs in Chrome extension.
- **DB Worker** — Built as separate entry, loaded via `new URL('/db-worker.js', location.origin)`.
- **Layout Worker** — Built as separate entry, loaded via `new URL('/layout-worker.js', location.origin)`.
