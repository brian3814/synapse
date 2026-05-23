# Test Synapse with Playwright MCP + Synapse MCP

## Context

Synapse has no test infrastructure. We'll set up **Playwright MCP** (UI automation via CDP) alongside the existing **Synapse MCP** (direct graph data access) to interactively test all critical workflows. Playwright MCP connects to the running Electron app via `--cdp-endpoint`, and Synapse MCP connects directly to the vault SQLite DB. Together they enable: **UI action -> data verification** and **data action -> UI verification**.

## Setup (3 changes)

### 1. Add test launch script to `package.json`

```json
"dev:electron:test": "npm run build:electron && electron . --remote-debugging-port=9222"
```

Exposes CDP on port 9222 for Playwright MCP. No changes to `electron/main.ts` needed — `--remote-debugging-port` is a Chromium flag Electron inherits.

### 2. Add Playwright MCP to `.mcp.json`

```json
"playwright": {
  "command": "npx",
  "args": [
    "@playwright/mcp",
    "--cdp-endpoint", "ws://127.0.0.1:9222",
    "--caps", "vision"
  ]
}
```

`--caps vision` enables screenshots for graph visualization testing.

### 3. Add permissions to `.claude/settings.local.json`

Add Playwright MCP tools (`mcp__playwright__browser_*`) and missing Synapse MCP tools (`delete_node`, `delete_edge`, `update_node`, `create_note`, `read_note`, `list_notes`, `search_notes`, `get_neighbors`, `get_subgraph`, `get_nodes_by_type`, `merge_nodes`, `open_vault`, `close_vault`) to the `allow` list. Also add `"playwright"` to `enabledMcpjsonServers`.

## Test Vault Strategy

Use a fresh disposable vault at `/tmp/synapse-test-vault`. Initialize it via Synapse MCP `open_vault` before launching Electron, then pass it via `--vault`:
```
electron . --remote-debugging-port=9222 --vault /tmp/synapse-test-vault
```

The `--vault` flag is already handled at `electron/main.ts:402-407`. Real data at `/Users/brian/Desktop/notes` is untouched. Delete `/tmp/synapse-test-vault` after testing.

## Critical Workflows & Test Cases

### Suite 1: App Bootstrap & Navigation
- **Playwright**: `browser_snapshot` — verify app loaded (no VaultSetupScreen, graph canvas present, header with search/settings/notes icons)
- **Synapse MCP**: `list_vaults` confirms test vault open, `get_graph_overview` returns valid counts

### Suite 2: Node CRUD (Cross-Validation)

**2A — Create via UI, verify via MCP:**
1. Playwright: navigate to Create panel, fill name + type, click "Create Node"
2. Synapse MCP: `search_nodes` for the name — should find 1 result
3. Synapse MCP: `get_node_details` — verify properties match

**2B — Create via MCP, verify in UI:**
1. Synapse MCP: `create_node` name="MCP Test Entity" type="entity"
2. Wait ~1s for `notifyApp()` sync (MCP → companion server port 19876 → `db:sync` IPC → graph store reload)
3. Playwright: type "MCP Test Entity" in header search → verify dropdown shows it
4. Playwright: click result → verify NodeDetailPanel renders with correct name

**2C — Edit & Delete:**
1. Playwright: click Edit in NodeDetailPanel, change name, Save
2. Synapse MCP: `search_nodes` with new name — verify
3. Synapse MCP: `delete_node` (use MCP to avoid native `confirm()` dialog limitation)
4. Playwright: verify node disappears from search

### Suite 3: Edge CRUD
1. Synapse MCP: seed 2 nodes (`create_node` x2)
2. Playwright: open Create panel → Edge tab → select source/target → fill label → "Create Edge"
3. Synapse MCP: `get_neighbors` on source → verify edge exists
4. Synapse MCP: `create_edge` with different label between same nodes
5. Playwright: navigate to NodeDetailPanel → verify both edges listed
6. Synapse MCP: cleanup (`delete_node` x2 cascades edges)

### Suite 4: Search Cross-Validation
1. Synapse MCP: seed 5 nodes with names containing "SearchTest"
2. Playwright: type "SearchTest" in header search → verify all 5 appear in dropdown
3. Playwright: click one result → verify NodeDetailPanel
4. Synapse MCP: `search_nodes` "SearchTest" → verify returns 5
5. Cleanup via MCP

### Suite 5: Notes
1. Playwright: click Notes icon → "+ New Note" → fill title + markdown content → "Create Note"
2. Synapse MCP: `search_nodes` for note title → `read_note` → verify content
3. Synapse MCP: `create_note` title="MCP Note" content="Created via MCP"
4. Playwright: search for "MCP Note" → verify visible in Notes panel
5. Cleanup via MCP

### Suite 6: Graph Visualization (Vision)
1. Synapse MCP: seed 10 nodes + 8 edges (connected subgraph)
2. Wait for graph render sync
3. Playwright: `browser_take_screenshot` — capture the Three.js canvas
4. Visual inspection: nodes (colored circles) and edges (lines) should be visible
5. Playwright: use header search to select a seeded node → screenshot showing selection highlight
6. Cleanup via MCP

**Limitation:** Three.js canvas renders to `<canvas>` — Playwright can't inspect individual nodes in the canvas DOM. Use search-driven selection instead of canvas clicks. Screenshots are for visual verification only.

### Suite 7: Settings Modal
1. Playwright: click Settings gear → verify modal with tabs (General, Model, Agent, Billing, About)
2. Playwright: click each tab → verify content renders
3. Playwright: press Escape → verify modal closes

### Suite 8: LLM Extraction
1. Playwright: verify API key configured in Settings → Model tab
2. Playwright: open LLM Extract → paste sample text (e.g. "Albert Einstein was a physicist born in Ulm, Germany. He developed the theory of relativity at the Swiss Patent Office in Bern.")
3. Playwright: click Extract → wait for extraction review UI to appear
4. Playwright: verify review shows extracted entities (Einstein, Ulm, etc.) and relationships
5. Playwright: click "Add to Graph" to merge
6. Synapse MCP: `search_nodes` for "Einstein" — verify entity created with correct type
7. Synapse MCP: `get_neighbors` — verify relationships (born_in Ulm, etc.)
8. Cleanup: delete extracted entities via MCP

### Suite 9: Agent Chat
1. Synapse MCP: seed 3 nodes + 2 edges so the agent has data to query
2. Playwright: open chat panel → type "What entities are in this graph? List them."
3. Playwright: verify agent responds with text referencing the seeded entities (polls snapshot until response appears)
4. Playwright: send "Create a new entity called 'Test Agent Entity' of type 'concept'"
5. Synapse MCP: `search_nodes` "Test Agent Entity" — verify the agent created it via tool use
6. Cleanup via MCP

## Known Limitations & Workarounds

| Issue | Workaround |
|---|---|
| Native `confirm()` dialog (node delete) | Delete via Synapse MCP instead of UI; or add `--init-script` to override `confirm` |
| Three.js canvas can't be DOM-inspected | Use search to select nodes; screenshots for visual verification |
| Graph sync delay (MCP write → UI update) | Wait 1-2s after MCP writes, or poll with `browser_snapshot` |
| DevTools window opens by default | Playwright MCP targets the main window page, not devtools |
| `app://` custom protocol | No issue — CDP connects to the loaded page regardless of URL scheme |

## Execution Order

1. Build Electron app (`npm run build:electron`)
2. Create/verify test vault
3. Launch Electron with `--remote-debugging-port=9222 --vault <path>`
4. Connect Playwright MCP via `/mcp` reconnect
5. Run suites 1-9 sequentially (each suite cleans up after itself)
6. Take final screenshot of empty graph as baseline

## Verification

After all suites pass:
- `get_graph_overview` should show the graph in its original state (clean if using test vault)
- All screenshots captured for visual review
- Any failing suite noted with specific failure point and reproduction steps
