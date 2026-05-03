# Graph-to-Chat Context Selection Design Spec

## Problem

The graph and chat are currently decoupled. Users can multi-select nodes and ask questions in chat, but there's no way to say "ask about *these specific nodes*." The chat agent discovers context via RAG search and tool calls — it cannot receive user-curated context. Users want to select a subgraph, attach it to a chat message, and ask targeted questions (generate reports, compare entities, request updates) with the agent already knowing which nodes to focus on.

## Goal

Let users attach graph nodes as context to chat messages — like Cursor's `@file` references but for knowledge graph entities. Two entry points: right-click selected nodes on the graph, or @-autocomplete in the chat input. The agent sees lightweight node metadata and uses existing tools to drill deeper (progressive disclosure).

## Design Decisions

- **Context injection, not scoped sandbox.** Attached nodes are read-only background context. The agent is not restricted to the selection — it can search beyond it, create new nodes, etc.
- **Chips above input (Cursor-style).** Attached nodes render as removable chips in a bar above the chat text input. Clear visual separation between "what you're asking about" and "what you're asking."
- **Minimum critical context.** ~1 line per node in the serialized block (name, type, id, connection count, availability hints). No properties, summaries, or edge listings inline. Agent uses existing tools for deeper data.
- **No new tools, no system prompt changes.** The existing chat tools (`get_node_details`, `get_neighbors`, `read_note`, `get_source_content`) already cover all drill-down needs.
- **Platform-agnostic.** All changes are in the UI layer — works on both Chrome and Electron without platform-specific code.

---

## Architecture

```
Graph multi-select → Right-click "Send to Chat"
                          ↓
                    chatContextStore.addNodes(selectedNodes)
                          ↓
@-autocomplete → select → chatContextStore.addNodes([node])
                          ↓
                    ContextChipBar renders attachedNodes
                          ↓
                    User types question → hits Enter
                          ↓
                    serializeAttachedContext(nodeIds, graphSnapshot, metadata)
                          ↓
                    Prepend serialized block to user message
                          ↓
                    runChatAgent() sees context + question
                          ↓
                    Agent uses existing tools for deeper data (progressive disclosure)
```

### Progressive Disclosure Tiers

| Tier | Data | Delivery |
|------|------|----------|
| 1 (injected) | Name, type, id, connection count, note/source existence | Serialized into user message |
| 2 (hinted) | "has note (1.2k words)", "has source from url.com" | Availability hints in tier 1 |
| 3 (on-demand) | Full properties, edge details, note content, source text | Agent calls existing tools |

---

## 1. State Management

### New store: `src/graph/store/chat-context-store.ts`

```typescript
interface AttachedNode {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface ChatContextState {
  attachedNodes: AttachedNode[];
  addNodes(nodes: AttachedNode[]): void;
  removeNode(nodeId: string): void;
  clear(): void;
}
```

Lightweight — stores only chip display data. Full node data fetched at send time from graph store + DB.

Deduplication: `addNodes` skips nodes already in the list (by id).

---

## 2. Graph Context Menu

### Renderer changes

**`camera-controller.ts`** (line 107 currently: `if (e.button !== 0) return;`):
- Add `contextmenu` event listener on the canvas element. Prevent default browser context menu.
- Emit a new event with screen coordinates and whether a node was right-clicked.

**`graph-renderer.ts`** (events at lines 479-492):
- Add `contextMenu` to `GraphEventMap`:
  ```typescript
  contextMenu: { screenX: number; screenY: number; nodeId: string | null }
  ```
- Hit-test at the right-click position to determine if a node was targeted.

**`GraphCanvas.tsx`**:
- Forward `onContextMenu` prop from the renderer event, same pattern as `onNodeClick`.

### New component: `GraphContextMenu.tsx`

Rendered inside `KnowledgeGraph.tsx`. Positioned absolutely at click coordinates.

**Menu items (v1):**
- **"Send to Chat (N nodes)"** — visible when `selectedNodeIds.size > 0`. Reads selected nodes from graph store, calls `chatContextStore.addNodes()`. If the right-clicked node is not in the selection, add just that node instead.
- Divider
- **"Delete Selected"** — existing functionality, relocated from toolbar
- **"Generate Note"** — existing functionality, relocated from multi-select panel

**Behavior:**
- Dismiss on click-outside, Esc, or scroll.
- "Send to Chat" also opens the chat panel (`uiStore.setChatOpen(true)`) and focuses the chat input if the panel was closed.

---

## 3. @-Autocomplete

### New component: `NodeAutocomplete.tsx`

Triggered when user types `@` in the chat input. Shows a dropdown anchored to the input.

**Search behavior:**
- Fuzzy-matches against `graphStore.nodes` by name (client-side filter — no DB round-trip needed since nodes are already in memory).
- Each result row: type color dot + node name (match highlighted) + type label.
- Max 8 results shown.
- Keyboard navigation: ↑/↓ to select, Enter to confirm, Esc to dismiss.

**On select:**
- Add the node as a chip via `chatContextStore.addNodes([node])`.
- Remove the `@query` text from the input (the `@` plus any typed characters).
- Keep focus in the input.

**On dismiss (Esc / click-outside):**
- Close the dropdown. Leave the input text as-is (don't eat the `@` or partial query).

---

## 4. Chat Input Changes

### New component: `ContextChipBar.tsx`

Rendered above the text input in `ChatBot.tsx` when `attachedNodes.length > 0`.

**Each chip:** Type color dot + node name + × remove button.

**Overflow:** When > 5 chips, show first 4 + a "+N more" chip that expands to show all on click. Collapsed state shows the count; expanded state shows all chips with a "collapse" toggle.

**Styling:** Follows existing chat UI patterns. Chips use the node's type color as the accent (matching the graph). The chip bar has a subtle top border separating it from the input.

### ChatBot.tsx modifications

- Render `ContextChipBar` between the message list and the input form (lines 239-271).
- On form submit (`handleSubmit`, lines 23-29): if `attachedNodes.length > 0`, pass them alongside the input text to `sendMessage()`. Clear the context store after send.
- Integrate `NodeAutocomplete`: detect `@` in input value, show/hide the autocomplete dropdown.

---

## 5. Context Serialization

### New function: `serializeAttachedContext()`

Located in `src/ui/utils/chat-context-serializer.ts`. Moves to `src/commands/` when the agentic-first command layer lands.

**Input:** attached node IDs + graph snapshot (nodes + edges from store) + note/source metadata from DB.

**Output format:**

```
[Graph Context: 3 nodes attached]
- Anthropic (Organization, id:abc123) — 5 connections, has note, has source
- Claude (Product, id:def456) — 3 connections, has note
- GPT-4 (Product, id:ghi789) — 2 connections

Use get_node_details, get_neighbors, read_note, get_source_content to inspect these nodes.
```

~1 line per node. Connection count = number of edges where the node is source or target. "has note" = `noteSearch` entry exists for this node id. "has source" = `sourceContent` exists for this node id.

**Metadata fetching at send time:** Before serialization, batch-fetch note existence and source existence for all attached node IDs. Two DB calls total (not per-node):
- `db.noteSearch.getByNodeIds(nodeIds)` → which nodes have notes
- `db.sourceContent.getByNodeIds(nodeIds)` → which nodes have sources

If these batch lookups don't exist on the current DB client, use the existing per-node methods with `Promise.all()` — acceptable since this runs once at send time, not in a hot loop.

---

## 6. Agent Integration

### `useChatSession.ts` changes (line 75-218)

`sendMessage(input)` becomes `sendMessage(input, attachedNodes?)`:
1. If `attachedNodes` present, call `serializeAttachedContext()` to build the context block.
2. Pass the serialized context to `runChatAgent()`.

### `chat-agent-loop.ts` changes (lines 31-38, 49-55)

Add `attachedContext?: string` to `RunChatAgentParams`.

When assembling the message array (lines 49-55), if `attachedContext` is present, prepend it to `currentPrompt`:

```typescript
const userMessage = attachedContext
  ? `${attachedContext}\n\n${currentPrompt}`
  : currentPrompt;
```

The agent sees a single user message with context block + question. No system prompt changes needed.

---

## 7. Message Storage

### `ChatMessage` extension

Add to the existing `ChatMessage` interface:

```typescript
attachedContext?: {
  nodeIds: string[];
  serialized: string;  // the context block sent to the agent
}
```

Stored in the `chat_messages` table's existing properties/metadata JSON column — no schema migration needed.

### History display

When rendering a past message with `attachedContext`:
- Resolve `nodeIds` against current graph store for chip display (name + color).
- Nodes that no longer exist: show as dimmed chips with the name parsed from `serialized`.
- Clickable chips focus the node in the graph (same as `ChatReferencedEntities` behavior at `ChatMessage.tsx:65-67`).

---

## Components Summary

| Action | File | Description |
|--------|------|-------------|
| Create | `src/graph/store/chat-context-store.ts` | Zustand store for attached nodes |
| Create | `src/ui/components/graph/GraphContextMenu.tsx` | Right-click context menu on graph |
| Create | `src/ui/components/chat/NodeAutocomplete.tsx` | @-triggered node search dropdown |
| Create | `src/ui/components/chat/ContextChipBar.tsx` | Chip bar above chat input |
| Create | `src/ui/utils/chat-context-serializer.ts` | Serialize attached nodes to context block |
| Modify | `src/graph/renderer/camera-controller.ts` | Add contextmenu event listener |
| Modify | `src/graph/renderer/graph-renderer.ts` | Add contextMenu event type + emission |
| Modify | `src/graph/renderer/types.ts` | Add contextMenu to GraphEventMap |
| Modify | `src/ui/components/graph/GraphCanvas.tsx` | Forward onContextMenu prop |
| Modify | `src/ui/components/graph/KnowledgeGraph.tsx` | Render GraphContextMenu, wire actions |
| Modify | `src/ui/components/chat/ChatBot.tsx` | Add ContextChipBar + NodeAutocomplete |
| Modify | `src/ui/hooks/useChatSession.ts` | Accept + serialize attached context |
| Modify | `src/ui/hooks/chat-agent-loop.ts` | Prepend context to user message |
| Modify | `src/ui/components/chat/ChatMessage.tsx` | Render attached context chips in history |

---

## Verification

1. **Build clean**: `npm run build` + `npm run build:electron` — no errors.
2. **Right-click flow**: Multi-select 3 nodes → right-click → "Send to Chat" → chat panel opens with 3 chips → type question → send → agent response references the attached nodes.
3. **@-autocomplete flow**: Open chat → type `@Anth` → dropdown shows "Anthropic" → select → chip appears → type question → send → agent sees context.
4. **Chip management**: Add chips via both methods → remove individual chip via × → clear all on send.
5. **Overflow**: Attach 8+ nodes → chip bar shows 4 + "+4 more" → expand → all visible.
6. **History**: Scroll up to a past message with attached context → chips displayed → click chip → graph pans to node.
7. **Progressive disclosure**: Agent receives minimal context → calls `get_node_details` or `read_note` for specific nodes → returns detailed answer.
8. **Both platforms**: Test on Chrome extension (side panel) and Electron desktop app.

## Risks

| Risk | Mitigation |
|------|-----------|
| Context bloat with many nodes (20+) | ~1 line per node, no inline data. 20 nodes ≈ 20 lines. |
| @-autocomplete performance with large graphs | Client-side filter on in-memory nodes (already loaded). Debounce input. |
| Right-click conflicts with browser default menu | `e.preventDefault()` on contextmenu event. Extension CSP allows this. |
| Chat input complexity (@ detection + autocomplete state) | Isolated `NodeAutocomplete` component with clear trigger/dismiss lifecycle. |
| Stale chips after node deletion | Resolve from `serialized` fallback. Dimmed visual treatment for missing nodes. |
