# Graph-to-Chat Context Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach graph nodes as context to chat messages via right-click context menu or @-autocomplete, with progressive disclosure so the agent sees minimal metadata and drills deeper via existing tools.

**Architecture:** New `ChatContextStore` (Zustand) bridges graph selection and chat input. Two entry points (context menu + @-autocomplete) write to the store; the chat send flow reads from it, serializes ~1 line per node, and prepends the block to the user message. No new tools, no system prompt changes, no platform-specific code.

**Tech Stack:** React 19, Zustand, Three.js (renderer events), TypeScript

**No test framework configured.** Verification = `npm run build` + `npm run build:electron` clean + manual smoke test.

---

### Task 1: ChatContext Zustand Store

**Files:**
- Create: `src/graph/store/chat-context-store.ts`

- [ ] **Step 1: Create the store**

```typescript
// src/graph/store/chat-context-store.ts
import { create } from 'zustand';

export interface AttachedNode {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface ChatContextState {
  attachedNodes: AttachedNode[];
  addNodes: (nodes: AttachedNode[]) => void;
  removeNode: (nodeId: string) => void;
  clear: () => void;
}

export const useChatContextStore = create<ChatContextState>((set) => ({
  attachedNodes: [],
  addNodes: (nodes) =>
    set((state) => {
      const existingIds = new Set(state.attachedNodes.map((n) => n.id));
      const newNodes = nodes.filter((n) => !existingIds.has(n.id));
      if (newNodes.length === 0) return state;
      return { attachedNodes: [...state.attachedNodes, ...newNodes] };
    }),
  removeNode: (nodeId) =>
    set((state) => ({
      attachedNodes: state.attachedNodes.filter((n) => n.id !== nodeId),
    })),
  clear: () => set({ attachedNodes: [] }),
}));
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/graph/store/chat-context-store.ts
git commit -m "feat(chat-context): add ChatContext Zustand store for attached nodes"
```

---

### Task 2: Renderer Context Menu Event

**Files:**
- Modify: `src/graph/renderer/types.ts:81-96`
- Modify: `src/graph/renderer/camera-controller.ts:48-64,106-107`
- Modify: `src/graph/renderer/graph-renderer.ts:74-131,340-366,478-492`

This task adds a `contextMenu` event to the graph renderer so right-clicking on the canvas emits screen coordinates + the node under the cursor (if any). The React layer will use this to show a context menu component.

- [ ] **Step 1: Add contextMenu to GraphEventMap**

In `src/graph/renderer/types.ts`, add the new event type:

```typescript
// types.ts — update GraphEventType (line 81)
export type GraphEventType = 'nodeClick' | 'edgeClick' | 'canvasClick' | 'nodeHover' | 'nodeDragStart' | 'nodeDragEnd' | 'lassoSelect' | 'contextMenu';

// types.ts — add to GraphEventMap (line 88-96)
export interface GraphEventMap {
  nodeClick: { nodeId: string; modifiers: Modifiers };
  edgeClick: { edgeId: string };
  canvasClick: { modifiers: Modifiers };
  nodeHover: { nodeId: string | null };
  nodeDragStart: { nodeId: string };
  nodeDragEnd: { nodeId: string; x: number; y: number };
  lassoSelect: { nodeIds: Set<string>; additive: boolean };
  contextMenu: { screenX: number; screenY: number; nodeId: string | null };
}
```

- [ ] **Step 2: Add contextmenu listener in CameraController**

In `src/graph/renderer/camera-controller.ts`:

Add a new callback property and bound handler alongside the existing ones (after line 46):

```typescript
// After existing callback declarations (line 46):
onContextMenu?: (screenX: number, screenY: number) => void;

// New bound handler (add after line 34):
private onContextMenuBound: (e: MouseEvent) => void;
```

In the constructor (lines 48-64), bind and register the listener:

```typescript
// In constructor, after existing bindings (line 58):
this.onContextMenuBound = this.handleContextMenu.bind(this);

// After existing addEventListener calls (line 64):
canvas.addEventListener('contextmenu', this.onContextMenuBound);
```

Add the handler method (after the existing `onPointerUp` method):

```typescript
private handleContextMenu(e: MouseEvent) {
  e.preventDefault();
  this.onContextMenu?.(e.clientX, e.clientY);
}
```

In the `dispose()` method, remove the listener:

```typescript
// In dispose(), add alongside existing removeEventListener calls:
this.canvas.removeEventListener('contextmenu', this.onContextMenuBound);
```

- [ ] **Step 3: Wire context menu event in GraphRenderer**

In `src/graph/renderer/graph-renderer.ts`, in the constructor where camera controller callbacks are wired (around line 125):

```typescript
// After this.cameraController.onClick = ... (line 125):
this.cameraController.onContextMenu = (sx, sy) => {
  const result = hitTest(sx, sy, this.nodes, this.edges, this.nodeMap,
    this.cameraController.camera, this.renderer.domElement, this.spatialHash);
  const nodeId = (result.type === 'node' && result.id) ? result.id : null;
  this.emit('contextMenu', { screenX: sx, screenY: sy, nodeId });
};
```

- [ ] **Step 4: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/graph/renderer/types.ts src/graph/renderer/camera-controller.ts src/graph/renderer/graph-renderer.ts
git commit -m "feat(renderer): add contextMenu event on right-click with hit-test"
```

---

### Task 3: Forward Context Menu Event Through GraphCanvas

**Files:**
- Modify: `src/ui/components/graph/GraphCanvas.tsx:8-22,52-73`

- [ ] **Step 1: Add onContextMenu prop and wire event**

In `src/ui/components/graph/GraphCanvas.tsx`:

Add the prop to the interface (after line 19, `onLassoSelect`):

```typescript
onContextMenu?: (screenX: number, screenY: number, nodeId: string | null) => void;
```

Wire the event in the renderer setup block (after the `lassoSelect` handler, around line 64):

```typescript
renderer.on('contextMenu', ({ screenX, screenY, nodeId }) => {
  propsRef.current.onContextMenu?.(screenX, screenY, nodeId);
});
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/graph/GraphCanvas.tsx
git commit -m "feat(graph-canvas): forward contextMenu event to parent"
```

---

### Task 4: GraphContextMenu Component

**Files:**
- Create: `src/ui/components/graph/GraphContextMenu.tsx`
- Modify: `src/ui/components/graph/KnowledgeGraph.tsx`

- [ ] **Step 1: Create GraphContextMenu component**

```typescript
// src/ui/components/graph/GraphContextMenu.tsx
import React, { useEffect, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useChatContextStore } from '../../../graph/store/chat-context-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { useUIStore } from '../../../graph/store/ui-store';
import type { AttachedNode } from '../../../graph/store/chat-context-store';

interface GraphContextMenuProps {
  screenX: number;
  screenY: number;
  nodeId: string | null;
  onClose: () => void;
}

export function GraphContextMenu({ screenX, screenY, nodeId, onClose }: GraphContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const setChatOpen = useUIStore((s) => s.setChatOpen);

  // Determine which nodes to send: if right-clicked node is in selection, send selection.
  // Otherwise send just the right-clicked node.
  const targetNodeIds = nodeId && selectedNodeIds.has(nodeId)
    ? selectedNodeIds
    : nodeId
      ? new Set([nodeId])
      : selectedNodeIds;

  const targetCount = targetNodeIds.size;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Clamp menu position to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: screenX,
    top: screenY,
    zIndex: 100,
  };

  const handleSendToChat = () => {
    const attached: AttachedNode[] = [];
    for (const id of targetNodeIds) {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        attached.push({
          id: node.id,
          name: node.name,
          type: node.type,
          color: node.color ?? getColorForType(node.type),
        });
      }
    }
    addNodes(attached);
    setChatOpen(true);
    onClose();
  };

  return (
    <div ref={menuRef} style={style}>
      <div className="bg-zinc-800 border border-zinc-600 rounded-md shadow-xl min-w-[180px] py-1 text-sm">
        {targetCount > 0 && (
          <button
            onClick={handleSendToChat}
            className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700 flex items-center justify-between"
          >
            <span>Send to Chat</span>
            <span className="text-zinc-500 text-xs">{targetCount} {targetCount === 1 ? 'node' : 'nodes'}</span>
          </button>
        )}
        {targetCount === 0 && (
          <div className="px-3 py-1.5 text-zinc-500">No nodes selected</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire GraphContextMenu into KnowledgeGraph**

In `src/ui/components/graph/KnowledgeGraph.tsx`:

Add imports at top:

```typescript
import { GraphContextMenu } from './GraphContextMenu';
```

Add state for context menu (after the existing `windowed` state, around line 35):

```typescript
const [contextMenu, setContextMenu] = useState<{
  screenX: number;
  screenY: number;
  nodeId: string | null;
} | null>(null);
```

Add a context menu handler (after `handleLassoSelect`, around line 118):

```typescript
const handleContextMenu = useCallback(
  (screenX: number, screenY: number, nodeId: string | null) => {
    setContextMenu({ screenX, screenY, nodeId });
  },
  []
);
```

Pass `onContextMenu` to `GraphCanvas` (add after `onLassoSelect` prop, around line 166):

```typescript
onContextMenu={handleContextMenu}
```

Render `GraphContextMenu` inside the return JSX (after `GraphControls`, around line 169):

```typescript
{contextMenu && (
  <GraphContextMenu
    screenX={contextMenu.screenX}
    screenY={contextMenu.screenY}
    nodeId={contextMenu.nodeId}
    onClose={() => setContextMenu(null)}
  />
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/graph/GraphContextMenu.tsx src/ui/components/graph/KnowledgeGraph.tsx
git commit -m "feat(graph): add right-click context menu with Send to Chat action"
```

---

### Task 5: Context Chip Bar Component

**Files:**
- Create: `src/ui/components/chat/ContextChipBar.tsx`

- [ ] **Step 1: Create ContextChipBar**

```typescript
// src/ui/components/chat/ContextChipBar.tsx
import React, { useState } from 'react';
import { useChatContextStore, type AttachedNode } from '../../../graph/store/chat-context-store';

const MAX_VISIBLE = 4;

export function ContextChipBar() {
  const attachedNodes = useChatContextStore((s) => s.attachedNodes);
  const removeNode = useChatContextStore((s) => s.removeNode);
  const [expanded, setExpanded] = useState(false);

  if (attachedNodes.length === 0) return null;

  const overflow = attachedNodes.length > MAX_VISIBLE + 1;
  const visible = overflow && !expanded
    ? attachedNodes.slice(0, MAX_VISIBLE)
    : attachedNodes;
  const hiddenCount = attachedNodes.length - MAX_VISIBLE;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-zinc-700">
      {visible.map((node) => (
        <Chip key={node.id} node={node} onRemove={() => removeNode(node.id)} />
      ))}
      {overflow && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          +{hiddenCount} more
        </button>
      )}
      {overflow && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          show less
        </button>
      )}
    </div>
  );
}

function Chip({ node, onRemove }: { node: AttachedNode; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors"
      style={{
        backgroundColor: node.color + '20',
        borderColor: node.color + '44',
        color: node.color + 'cc',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: node.color }}
      />
      <span className="truncate" style={{ maxWidth: '100px' }}>{node.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="ml-0.5 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/chat/ContextChipBar.tsx
git commit -m "feat(chat): add ContextChipBar component for attached node chips"
```

---

### Task 6: @-Autocomplete Component

**Files:**
- Create: `src/ui/components/chat/NodeAutocomplete.tsx`

- [ ] **Step 1: Create NodeAutocomplete**

```typescript
// src/ui/components/chat/NodeAutocomplete.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { useChatContextStore } from '../../../graph/store/chat-context-store';

interface NodeAutocompleteProps {
  query: string;  // the text after '@'
  onSelect: () => void;  // called after adding node, so parent can clear @-query from input
  onDismiss: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const MAX_RESULTS = 8;

export function NodeAutocomplete({ query, onSelect, onDismiss, anchorRef }: NodeAutocompleteProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const lowerQuery = query.toLowerCase();
  const results = nodes
    .filter((n) => n.name.toLowerCase().includes(lowerQuery))
    .slice(0, MAX_RESULTS);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      const node = results[selectedIndex];
      if (node) {
        addNodes([{
          id: node.id,
          name: node.name,
          type: node.type,
          color: node.color ?? getColorForType(node.type),
        }]);
        onSelect();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  }, [results, selectedIndex, addNodes, getColorForType, onSelect, onDismiss]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Click outside to dismiss
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onDismiss]);

  if (results.length === 0) return null;

  const handleItemClick = (node: typeof results[0]) => {
    addNodes([{
      id: node.id,
      name: node.name,
      type: node.type,
      color: node.color ?? getColorForType(node.type),
    }]);
    onSelect();
  };

  // Highlight matching substring
  const highlight = (name: string) => {
    const idx = name.toLowerCase().indexOf(lowerQuery);
    if (idx === -1) return <span>{name}</span>;
    return (
      <>
        {name.slice(0, idx)}
        <strong className="text-zinc-100">{name.slice(idx, idx + query.length)}</strong>
        {name.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-1 w-full max-h-64 overflow-y-auto bg-zinc-800 border border-zinc-600 rounded-md shadow-xl z-50"
    >
      {results.map((node, i) => (
        <button
          key={node.id}
          onClick={() => handleItemClick(node)}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
            i === selectedIndex ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'
          }`}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: node.color ?? getColorForType(node.type) }}
          />
          <span className="truncate">{highlight(node.name)}</span>
          <span className="ml-auto text-zinc-600 text-xs flex-shrink-0">
            {node.label ?? node.type}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/chat/NodeAutocomplete.tsx
git commit -m "feat(chat): add NodeAutocomplete component for @-mention node search"
```

---

### Task 7: Context Serialization

**Files:**
- Create: `src/ui/utils/chat-context-serializer.ts`

- [ ] **Step 1: Create serializer**

```typescript
// src/ui/utils/chat-context-serializer.ts
import type { GraphEdge } from '../../shared/types';

interface SerializableNode {
  id: string;
  name: string;
  type: string;
}

interface NodeMetadata {
  hasNote: boolean;
  hasSource: boolean;
}

export function serializeAttachedContext(
  nodeIds: string[],
  edges: GraphEdge[],
  metadata: Map<string, NodeMetadata>,
  nodeMap: Map<string, SerializableNode>,
): string {
  if (nodeIds.length === 0) return '';

  const idSet = new Set(nodeIds);
  const lines: string[] = [`[Graph Context: ${nodeIds.length} nodes attached]`];

  for (const nodeId of nodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    let connectionCount = 0;
    for (const edge of edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) connectionCount++;
    }

    const meta = metadata.get(nodeId);
    const hints: string[] = [];
    if (connectionCount > 0) hints.push(`${connectionCount} connections`);
    if (meta?.hasNote) hints.push('has note');
    if (meta?.hasSource) hints.push('has source');

    const hintsStr = hints.length > 0 ? ` — ${hints.join(', ')}` : '';
    lines.push(`- ${node.name} (${node.type}, id:${node.id})${hintsStr}`);
  }

  lines.push('');
  lines.push('Use get_node_details, get_neighbors, read_note, get_source_content to inspect these nodes.');

  return lines.join('\n');
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/utils/chat-context-serializer.ts
git commit -m "feat(chat): add context serializer for attached node metadata"
```

---

### Task 8: Integrate Chip Bar + Autocomplete into ChatBot

**Files:**
- Modify: `src/ui/components/chat/ChatBot.tsx`

This is the main wiring task — adds the chip bar above the input, @-autocomplete trigger, and passes attached nodes to `sendMessage`.

- [ ] **Step 1: Add imports and autocomplete state to ChatBot**

In `src/ui/components/chat/ChatBot.tsx`, add imports at the top (after existing imports, line 8):

```typescript
import { ContextChipBar } from './ContextChipBar';
import { NodeAutocomplete } from './NodeAutocomplete';
import { useChatContextStore } from '../../../graph/store/chat-context-store';
```

- [ ] **Step 2: Wire store access and clear-on-send into ChatBot**

In the `ChatBot` function body, add store access (after line 17, `const history = useInputHistory();`):

```typescript
const clearAttached = useChatContextStore((s) => s.clear);
```

Update `handleSubmit` (lines 23-29) to clear attached context after send (the actual context passing happens in Task 9):

```typescript
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (!input.trim() || isProcessing) return;
  history.push(input.trim());
  sendMessage(input.trim());
  setInput('');
  clearAttached();
};
```

- [ ] **Step 3: Update ChatInput to include chip bar and autocomplete**

Replace the `ChatInput` function (lines 239-271) with:

```typescript
function ChatInput({
  input,
  setInput,
  onSubmit,
  isProcessing,
  onKeyDown,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isProcessing: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handleInputChange = (value: string) => {
    setInput(value);

    // Detect @-trigger: find the last '@' and extract query after it
    const atIdx = value.lastIndexOf('@');
    if (atIdx !== -1 && (atIdx === 0 || value[atIdx - 1] === ' ')) {
      const query = value.slice(atIdx + 1);
      // Only show autocomplete if no space after @ (still typing the query)
      if (!query.includes(' ')) {
        setAutocompleteQuery(query);
        setShowAutocomplete(true);
        return;
      }
    }
    setShowAutocomplete(false);
  };

  const handleAutocompleteSelect = () => {
    // Remove the @query from input
    const atIdx = input.lastIndexOf('@');
    if (atIdx !== -1) {
      setInput(input.slice(0, atIdx));
    }
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const handleAutocompleteDismiss = () => {
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const handleKeyDownWrapped = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let autocomplete handle arrow keys and Enter when visible
    if (showAutocomplete && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape')) {
      return; // NodeAutocomplete's document-level listener handles these
    }
    onKeyDown(e);
  };

  return (
    <div className="shrink-0 border-t border-zinc-700">
      <ContextChipBar />
      <form ref={formRef} onSubmit={onSubmit} className="relative flex gap-2 p-3">
        {showAutocomplete && (
          <NodeAutocomplete
            query={autocompleteQuery}
            onSelect={handleAutocompleteSelect}
            onDismiss={handleAutocompleteDismiss}
            anchorRef={inputRef}
          />
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDownWrapped}
          placeholder="Ask about your knowledge graph... (@ to mention nodes)"
          className="flex-1 bg-zinc-800 text-sm text-zinc-100 px-3 py-1.5 rounded border border-zinc-700 focus:border-indigo-500 focus:outline-none"
          disabled={isProcessing}
        />
        <button
          type="submit"
          disabled={isProcessing || !input.trim()}
          className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? '...' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
```

Note: `ChatInput` now wraps the chip bar + form in a single `<div>` with the border-top. Remove the `border-t border-zinc-700` from the old `<form>` since it moved to the wrapper. Also add `useState` and `useRef` to the top-level React import if not already there (line 1 already has both).

- [ ] **Step 4: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/chat/ChatBot.tsx
git commit -m "feat(chat): integrate ContextChipBar and NodeAutocomplete into ChatInput"
```

---

### Task 9: Agent Integration — Wire Attached Context Through Send Path

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts:13-21,75,95,142-144`
- Modify: `src/ui/hooks/chat-agent-loop.ts:31-38,49-55`
- Modify: `src/ui/components/chat/ChatBot.tsx` (update handleSubmit)

- [ ] **Step 1: Add attachedContext to ChatMessage type**

In `src/ui/hooks/useChatSession.ts`, update the `ChatMessage` interface (lines 13-21):

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentTurns?: ChatAgentTurn[];
  subgraph?: ChatSubgraphData;
  attachedContext?: { nodeIds: string[]; serialized: string };
  error?: string;
  status: MessageStatus;
}
```

- [ ] **Step 2: Update sendMessage to accept and serialize attached context**

In `src/ui/hooks/useChatSession.ts`, add imports at the top:

```typescript
import { type AttachedNode } from '../../graph/store/chat-context-store';
import { useGraphStore } from '../../graph/store/graph-store';
import { serializeAttachedContext } from '../utils/chat-context-serializer';
import { noteSearch, sourceContent } from '../../db/client/db-client';
```

Update `sendMessage` signature (line 75):

```typescript
const sendMessage = useCallback(async (input: string, attached?: AttachedNode[]) => {
```

After `setMessages((prev) => [...prev, userMsg, assistantMsg]);` (line 95), add context serialization:

```typescript
// Serialize attached node context
let serializedContext: string | undefined;
let attachedContextData: { nodeIds: string[]; serialized: string } | undefined;
if (attached && attached.length > 0) {
  const { nodes: graphNodes, edges: graphEdges } = useGraphStore.getState();
  const nodeMap = new Map(graphNodes.map((n) => [n.id, { id: n.id, name: n.name, type: n.type }]));
  const nodeIds = attached.map((n) => n.id);

  // Batch-fetch metadata
  const [allNoteEntries, allSources] = await Promise.all([
    noteSearch.getAll().catch(() => [] as Array<{ node_id: string }>),
    sourceContent.getAll().catch(() => [] as Array<{ node_id: string }>),
  ]);
  const noteNodeIds = new Set(allNoteEntries.map((e: any) => e.node_id));
  const sourceNodeIds = new Set(allSources.map((e: any) => e.node_id));

  const metadata = new Map<string, { hasNote: boolean; hasSource: boolean }>();
  for (const id of nodeIds) {
    metadata.set(id, {
      hasNote: noteNodeIds.has(id),
      hasSource: sourceNodeIds.has(id),
    });
  }

  serializedContext = serializeAttachedContext(nodeIds, graphEdges, metadata, nodeMap);
  attachedContextData = { nodeIds, serialized: serializedContext };
}

// Update user message with attached context if present
if (attachedContextData) {
  updateMessage(userMsgId, { attachedContext: attachedContextData });
}
```

Pass `serializedContext` to `runChatAgent` (around line 142):

```typescript
const finalText = await runChatAgent({
  conversationHistory: historyForLLM,
  currentPrompt: input,
  attachedContext: serializedContext,
  provider: config.provider,
  model: config.model,
  systemPrompt,
  onProgress: (event: ChatAgentProgress) => {
```

Update the dependency array at the end of `sendMessage` to keep `isProcessing` and `ensureSession`:

```typescript
}, [isProcessing, ensureSession]);
```

- [ ] **Step 3: Update RunChatAgentParams and message assembly**

In `src/ui/hooks/chat-agent-loop.ts`, update the interface (lines 31-38):

```typescript
interface RunChatAgentParams {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPrompt: string;
  attachedContext?: string;
  provider: string;
  model: string;
  systemPrompt: string;
  onProgress: (event: ChatAgentProgress) => void;
}
```

Update the function signature and message assembly (lines 40-55):

```typescript
export async function runChatAgent({
  conversationHistory,
  currentPrompt,
  attachedContext,
  provider,
  model,
  systemPrompt,
  onProgress,
}: RunChatAgentParams): Promise<string> {
  // Build initial messages: prior turns + current user message
  const userMessage = attachedContext
    ? `${attachedContext}\n\n${currentPrompt}`
    : currentPrompt;

  const messages: AnthropicMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: userMessage },
  ];
```

- [ ] **Step 4: Update ChatBot handleSubmit to pass attached nodes**

In `src/ui/components/chat/ChatBot.tsx`, update `handleSubmit`:

```typescript
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (!input.trim() || isProcessing) return;
  history.push(input.trim());
  const currentAttached = useChatContextStore.getState().attachedNodes;
  sendMessage(input.trim(), currentAttached.length > 0 ? currentAttached : undefined);
  setInput('');
  clearAttached();
};
```

- [ ] **Step 5: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/hooks/useChatSession.ts src/ui/hooks/chat-agent-loop.ts src/ui/components/chat/ChatBot.tsx
git commit -m "feat(chat): wire attached context through send path to agent loop"
```

---

### Task 10: Display Attached Context in Message History

**Files:**
- Modify: `src/ui/components/chat/ChatMessage.tsx:12-21`

- [ ] **Step 1: Render attached context chips on user messages**

In `src/ui/components/chat/ChatMessage.tsx`, add imports:

```typescript
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
```

Replace the user message rendering block (lines 13-21):

```typescript
if (message.role === 'user') {
  return (
    <div className="flex justify-end" style={{ marginBottom: '0.75rem' }}>
      <div className="group relative max-w-[85%] bg-indigo-600/20 border border-indigo-500/30 text-zinc-200 text-sm px-3 py-2 rounded-lg">
        {message.attachedContext && message.attachedContext.nodeIds.length > 0 && (
          <AttachedContextChips
            nodeIds={message.attachedContext.nodeIds}
            onNodeClick={onNodeClick}
          />
        )}
        {message.content}
        <CopyButton text={message.content} position="bottom-1 right-1" />
      </div>
    </div>
  );
}
```

Add the `AttachedContextChips` sub-component at the bottom of the file (before the closing):

```typescript
function AttachedContextChips({
  nodeIds,
  onNodeClick,
}: {
  nodeIds: string[];
  onNodeClick?: (nodeId: string) => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const resolved = nodeIds.map((id) => {
    const node = nodes.find((n) => n.id === id);
    return node
      ? { id, name: node.name, type: node.type, color: node.color ?? getColorForType(node.type), exists: true }
      : { id, name: id.slice(0, 8), type: '', color: '#666', exists: false };
  });

  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {resolved.map((node) => (
        <button
          key={node.id}
          onClick={() => node.exists && onNodeClick?.(node.id)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
            node.exists ? 'cursor-pointer hover:brightness-125' : 'opacity-50 cursor-default'
          }`}
          style={{
            backgroundColor: node.color + '20',
            borderColor: node.color + '33',
            color: node.color + 'cc',
            border: '1px solid',
          }}
          title={node.exists ? `${node.type}: ${node.name}` : 'Node no longer exists'}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: node.color }}
          />
          <span className="truncate" style={{ maxWidth: '80px' }}>{node.name}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/chat/ChatMessage.tsx
git commit -m "feat(chat): render attached context chips in message history"
```

---

### Task 11: Final Build Verification + Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Clean build both platforms**

Run: `npm run build && npm run build:electron`
Expected: Clean build, zero errors on both.

- [ ] **Step 2: Manual smoke test checklist**

Load the Chrome extension (`dist/`) in `chrome://extensions` developer mode OR run `npx electron .`:

1. **Right-click context menu:**
   - Ctrl-click to select 2-3 nodes in the graph
   - Right-click on one of the selected nodes
   - Verify context menu appears at cursor with "Send to Chat (N nodes)"
   - Click "Send to Chat" → chat panel opens with N chips above input

2. **@-autocomplete:**
   - Open chat panel
   - Type `@` followed by a few characters of a node name
   - Verify dropdown appears with matching nodes (color dot + name + type)
   - Select a node → chip appears in chip bar, `@query` removed from input

3. **Chip management:**
   - Verify × button removes individual chips
   - Add chips via both methods → verify no duplicates

4. **Send with context:**
   - With chips attached, type a question and send
   - Verify the agent response acknowledges the attached nodes
   - Verify chips appear on the sent user message in history

5. **Overflow:**
   - Add 6+ nodes via right-click → verify "show more" / "show less" toggle

6. **Context menu on empty area:**
   - Right-click on empty canvas with no selection → "No nodes selected" shown

- [ ] **Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address smoke test issues for graph-to-chat context"
```
