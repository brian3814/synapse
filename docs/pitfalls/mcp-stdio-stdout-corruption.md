# Pitfall: MCP stdio transport corrupted by console.log on stdout

## Scope

**This only applies to the stdio transport** — where the MCP client spawns the server as a subprocess and communicates over stdin/stdout. It does NOT apply to Streamable HTTP transport, where MCP messages travel over HTTP request/response bodies and the server's stdout/stderr are irrelevant to the protocol.

In Synapse: affects `synapse-mcp` CLI (stdio) and headless Electron mode (stdio). Does NOT affect the companion HTTP server on port 19876.

## Problem

The MCP protocol's stdio transport uses **stdout exclusively** for JSON-RPC messages between client and server. Any other output written to stdout — `console.log()`, debug prints, Node.js warnings, unhandled error stack traces — corrupts the protocol stream and causes the MCP client to disconnect or error with a parse failure.

This is invisible during development because the corruption only manifests when the process is spawned by an MCP client (Claude Code, Cursor, Claude Desktop), not when run interactively in a terminal.

## Error Behaviour

- MCP client receives a malformed JSON-RPC message and disconnects
- Error messages vary by client: "Parse error", "Invalid JSON", "Connection reset"
- The offending log line is invisible to the developer — it's mixed into the binary protocol stream
- Intermittent: only triggers when a code path that logs happens to execute during an MCP session

## Root Cause

MCP's `StdioServerTransport` reads from stdin and writes JSON-RPC to stdout. This is the standard stdio convention for subprocess-based tools (also used by LSP). Node.js `console.log()` writes to `process.stdout` — the same file descriptor.

Common sources of accidental stdout pollution:
- `console.log()` debug statements anywhere in the codebase
- Electron's internal logging (GPU process, renderer warnings)
- Node.js deprecation warnings (`[DEP0XXX]`)
- Unhandled promise rejection default handler
- Third-party libraries that call `console.log` (e.g., `@huggingface/transformers` download progress)

## Solution

In headless/MCP mode, redirect **all** console output to stderr before any other code runs:

```typescript
if (process.argv.includes('--headless')) {
  console.log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');
  console.warn = (...args: unknown[]) => process.stderr.write('[WARN] ' + args.join(' ') + '\n');
  console.error = (...args: unknown[]) => process.stderr.write('[ERROR] ' + args.join(' ') + '\n');
  console.debug = (...args: unknown[]) => process.stderr.write('[DEBUG] ' + args.join(' ') + '\n');
}
```

This must be the **first thing** in the entry point — before imports that trigger side effects.

MCP clients read stderr for diagnostics (Claude Code shows it in the MCP server logs panel), so redirected logs remain visible for debugging.

## Where this applies in the codebase

- `electron/main.ts` — headless mode console override (when `--headless` flag is present)
- `packages/synapse-mcp/src/index.ts` — standalone MCP server already uses stderr for its own logging via `process.stderr.write()`
- Any new code that runs during an MCP session must avoid `process.stdout.write()` directly

## Prevention checklist

- Never use `console.log` for operational logging in code that runs during MCP sessions — use `process.stderr.write` or a logger that targets stderr
- When adding dependencies, check if they log to stdout on import or initialization
- Test MCP integration by spawning the server via an MCP client, not by running it interactively (interactive terminals mask the problem because stdout is visible to the developer)

## Specification References

From the [MCP specification (2025-03-26) — Transports § stdio](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#stdio):

> The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message.

> The server **MAY** write UTF-8 strings to its standard error (`stderr`) for logging purposes. Clients **MAY** capture, forward, or ignore this logging.

> The client **MUST NOT** write anything to the server's `stdin` that is not a valid MCP message.

The LSP specification has the same convention: [LSP 3.17 — Base Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol).
