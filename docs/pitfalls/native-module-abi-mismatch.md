# Pitfall: better-sqlite3 native module ABI mismatch between Node.js and Electron

## Scope

Affects local development when switching between `npm test` (system Node.js) and `npm run dev:electron` (Electron runtime). Does NOT affect production packaging — electron-builder handles native module rebuilds automatically.

## Problem

`better-sqlite3` is a native C++ addon compiled against a specific Node.js ABI (NODE_MODULE_VERSION). System Node.js and Electron embed different Node.js versions with different ABIs, so a binary compiled for one cannot load in the other.

The error appears at runtime when `require('better-sqlite3')` tries to load the `.node` binary:

```
Error: The module '.../better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 145.
```

## Root Cause

A single `node_modules/better-sqlite3/build/Release/better_sqlite3.node` binary serves both runtimes. Whichever compiled it last wins:

| Runtime | Node.js version | MODULE_VERSION | Compiled by |
|---------|----------------|----------------|-------------|
| System Node (v22.x) | 22.16.0 | 127 | `npm rebuild better-sqlite3` |
| Electron (v41.x) | 32.x (embedded) | 145 | `node-gyp rebuild --runtime=electron` |

Running `npm install` or `npm rebuild` compiles for system Node. Running Electron's rebuild compiles for Electron. They overwrite the same file.

## Solution

The npm scripts auto-rebuild before each workflow:

```bash
npm test              # rebuilds for system Node, then runs vitest
npm run dev:electron  # rebuilds for Electron, then builds + launches app
```

Implementation:

- `rebuild:node` → `npm rebuild better-sqlite3` (compiles for system Node)
- `rebuild:electron` → `node scripts/rebuild-electron.mjs` (compiles for Electron via node-gyp with `--runtime=electron --target=<version> --dist-url=https://electronjs.org/headers`)

## Why not @electron/rebuild CLI?

The `@electron/rebuild` CLI (v4.0.4, bundled with electron-builder) has compatibility issues:

1. **CLI import failure**: The CLI module imports `styleText` from `node:util`, which is unavailable on Node.js <20.12.0 — crashes before any rebuild logic runs.
2. **API path errors**: The programmatic `rebuild()` API throws `ERR_INVALID_ARG_TYPE` for `paths[0]` being undefined inside `node-gyp.js` on some configurations.

The `scripts/rebuild-electron.mjs` script bypasses both by calling `node-gyp rebuild` directly with the Electron headers URL, reading the Electron version from `node_modules/electron/package.json`.

## Gotchas

- **CI/CD**: Not an issue. electron-builder's `npm run dist:mac` runs its own native module rebuild internally.
- **Fresh install**: `npm install` compiles for system Node. Run `npm run rebuild:electron` before `npx electron .` if you skip the `dev:electron` script.
- **Rebuild is fast**: ~5 seconds on Apple Silicon. The scripts don't cache — they rebuild unconditionally every time, which is the safest approach since there's no reliable way to detect which ABI the current binary targets.
