# Search System

## Overview

`SearchPanel` provides node search via the SQLite database layer. Queries go through FTS5 full-text search when available, falling back to `LIKE`-based matching otherwise.

## Architecture

```
SearchPanel (UI)
  │
  ├─ 300ms debounce (setTimeout)
  ├─ Stale-request cancellation (searchIdRef)
  ├─ MIN_QUERY_LENGTH = 2
  │
  └─ dbNodes.search(query)
       │
       └─ DB Worker: searchNodes()
            │
            ├─ FTS5 path (if available)
            │   1. sanitizeFTS5Query(raw) → quoted prefix tokens
            │   2. MATCH against nodes_fts
            │   3. try/catch → fall through on failure
            │
            └─ LIKE fallback
                WHERE label LIKE ? OR type LIKE ?
```

## FTS5 Query Sanitization

`sanitizeFTS5Query(raw: string): string | null`

FTS5 has its own query syntax with special characters that can cause parse errors or unexpected behavior when passed through from user input. The sanitizer:

1. Splits input on whitespace into tokens
2. Strips special characters: `"`, `*`, `(`, `)`, `-`, `+`, `^`, `:`, `{`, `}`, `~`, `|`
3. Filters out empty tokens
4. Returns `null` if no tokens remain (skips FTS5 entirely)
5. Wraps each token: `"token"*` (quoted literal + prefix wildcard)

### Examples

| Input | Sanitized FTS5 Query |
|---|---|
| `javascript` | `"javascript"*` |
| `java-script` | `"javascript"*` |
| `multi word` | `"multi"* "word"*` |
| `"quoted"` | `"quoted"*` |
| `***` | `null` (skips FTS5) |
| `node.js` | `"node.js"*` |

### Why quote each token?

FTS5 interprets bare tokens as column references or operators. Quoting ensures the token is treated as a literal string match. The trailing `*` enables prefix matching (typing "jav" finds "javascript").

## LIKE Fallback

When FTS5 is unavailable or the query fails FTS5 parsing:

```sql
SELECT * FROM nodes
WHERE label LIKE ? OR type LIKE ?
ORDER BY label
LIMIT ?;
```

The `properties` JSON column is intentionally excluded — scanning JSON blobs is slow and rarely produces useful results for the user.

## UI Debounce & Stale Cancellation

### Problem

Without debounce, every keystroke fires a DB query that serializes through the single-threaded SQLite promise queue. Typing "javascript" fires 10 queries, each waiting for the previous to complete.

### Solution

**Debounce (300ms):** Input updates `query` state immediately (responsive typing), but the DB call is delayed. Each new keystroke resets the timer, so only the final value triggers a query.

**Stale-request cancellation:** A monotonic `searchIdRef` increments on each input change. When the DB response arrives, it's discarded if `searchIdRef` has moved on. This prevents older, slower queries from overwriting newer results.

**Minimum query length:** Queries shorter than 2 characters are skipped entirely — single characters match too many nodes and waste DB time.

### No `allNodes` subscription

The previous implementation subscribed to `graph-store.nodes` for an in-memory fallback filter. This caused `handleSearch` to be recreated on every graph mutation (node add/delete/update), which is unnecessary since the DB layer handles all fallback logic internally.

## Key Files

| File | Role |
|---|---|
| `src/ui/components/search/SearchPanel.tsx` | React UI with debounce + stale cancellation |
| `src/db/worker/queries/node-queries.ts` | `searchNodes()` + `sanitizeFTS5Query()` |
| `src/db/client/db-client.ts` | `nodes.search()` — UI-thread client wrapper |
| `src/db/worker/migrations/` | Migration 002 creates FTS5 virtual table (optional) |
