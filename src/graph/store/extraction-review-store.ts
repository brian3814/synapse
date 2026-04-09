import { create } from 'zustand';

// --- Types ---

export type TempId = string; // `temp-${uuid}`

export interface ReviewNode {
  tempId: TempId;
  name: string;
  type: string; // structural layer: 'resource' | 'entity' | 'note'
  label?: string; // semantic entity label (concept, person, technology, ...)
  properties: Record<string, unknown>;
  tags?: string[];
  mergeRecommendation?: {
    existingNodeId: string;
    existingName: string;
    matchType: 'exact' | 'alias' | 'fuzzy';
    similarity: number;
    status: 'pending' | 'accepted' | 'dismissed';
  };
  removed: boolean;
}

export interface ReviewEdge {
  tempId: TempId;
  sourceTempId: TempId;
  targetTempId: TempId;
  label: string;
  type: string;
  removed: boolean;
}

export type ReviewCommand =
  | { type: 'edit-node'; tempId: TempId; before: Partial<ReviewNode>; after: Partial<ReviewNode> }
  | { type: 'edit-edge'; tempId: TempId; before: Partial<ReviewEdge>; after: Partial<ReviewEdge> }
  | { type: 'add-edge'; edge: ReviewEdge }
  | { type: 'remove-edge'; edge: ReviewEdge }
  | { type: 'remove-node'; node: ReviewNode; removedEdges: ReviewEdge[] }
  | {
      type: 'convert-to-property';
      node: ReviewNode;
      assignments: { tempId: TempId; key: string; value: string; beforeProps: Record<string, unknown> }[];
      removedEdges: ReviewEdge[];
    }
  | { type: 'accept-merge'; tempId: TempId; before: ReviewNode['mergeRecommendation'] }
  | { type: 'dismiss-merge'; tempId: TempId; before: ReviewNode['mergeRecommendation'] };

export interface PendingConversion {
  nodeTempId: TempId;
  nodeName: string;
  loading: boolean;
  assignments: Array<{
    adjacentTempId: TempId;
    adjacentName: string;
    suggestedKey: string;
    originalEdgeLabel: string;
    value: string;
  }>;
}

// --- Store ---

interface ExtractionReviewStore {
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  viewMode: 'extracted' | 'overlay';
  selectedTempId: TempId | null;
  selectedType: 'node' | 'edge' | null;
  undoStack: ReviewCommand[];
  redoStack: ReviewCommand[];
  sourceUrl: string | null;
  active: boolean;
  pendingConversion: PendingConversion | null;

  // Lifecycle
  initialize(nodes: ReviewNode[], edges: ReviewEdge[], sourceUrl: string | null): void;
  reset(): void;

  // View
  setViewMode(mode: 'extracted' | 'overlay'): void;
  select(tempId: TempId | null, type: 'node' | 'edge' | null): void;

  // Edits
  editNode(
    tempId: TempId,
    changes: Partial<Pick<ReviewNode, 'name' | 'type' | 'label' | 'properties' | 'tags'>>
  ): void;
  editEdge(tempId: TempId, changes: Partial<Pick<ReviewEdge, 'label' | 'type'>>): void;
  addEdge(sourceTempId: TempId, targetTempId: TempId, label: string, type?: string): void;
  removeEdge(tempId: TempId): void;
  removeNode(tempId: TempId): void;

  // Convert-to-property (two-step)
  prepareConvertToProperty(nodeTempId: TempId): Promise<void>;
  updateConversionKey(index: number, newKey: string): void;
  confirmConvertToProperty(): void;
  cancelConvertToProperty(): void;

  // Merge
  acceptMerge(tempId: TempId): void;
  dismissMerge(tempId: TempId): void;

  // Undo/redo
  undo(): void;
  redo(): void;

  // Computed helpers
  activeNodes(): ReviewNode[];
  activeEdges(): ReviewEdge[];
}

function findNode(nodes: ReviewNode[], tempId: TempId): ReviewNode | undefined {
  return nodes.find((n) => n.tempId === tempId);
}

function findEdge(edges: ReviewEdge[], tempId: TempId): ReviewEdge | undefined {
  return edges.find((e) => e.tempId === tempId);
}

function updateNode(nodes: ReviewNode[], tempId: TempId, patch: Partial<ReviewNode>): ReviewNode[] {
  return nodes.map((n) => (n.tempId === tempId ? { ...n, ...patch } : n));
}

function updateEdge(edges: ReviewEdge[], tempId: TempId, patch: Partial<ReviewEdge>): ReviewEdge[] {
  return edges.map((e) => (e.tempId === tempId ? { ...e, ...patch } : e));
}

function getConnectedEdges(edges: ReviewEdge[], nodeTempId: TempId): ReviewEdge[] {
  return edges.filter(
    (e) => !e.removed && (e.sourceTempId === nodeTempId || e.targetTempId === nodeTempId)
  );
}

function applyCommand(state: Pick<ExtractionReviewStore, 'nodes' | 'edges'>, cmd: ReviewCommand): Pick<ExtractionReviewStore, 'nodes' | 'edges'> {
  switch (cmd.type) {
    case 'edit-node':
      return { ...state, nodes: updateNode(state.nodes, cmd.tempId, cmd.after) };

    case 'edit-edge':
      return { ...state, edges: updateEdge(state.edges, cmd.tempId, cmd.after) };

    case 'add-edge':
      return { ...state, edges: [...state.edges, cmd.edge] };

    case 'remove-edge':
      return { ...state, edges: updateEdge(state.edges, cmd.edge.tempId, { removed: true }) };

    case 'remove-node': {
      let { nodes, edges } = state;
      nodes = updateNode(nodes, cmd.node.tempId, { removed: true });
      for (const re of cmd.removedEdges) {
        edges = updateEdge(edges, re.tempId, { removed: true });
      }
      return { nodes, edges };
    }

    case 'convert-to-property': {
      let { nodes, edges } = state;
      // Mark the node as removed
      nodes = updateNode(nodes, cmd.node.tempId, { removed: true });
      // Mark connected edges as removed
      for (const re of cmd.removedEdges) {
        edges = updateEdge(edges, re.tempId, { removed: true });
      }
      // Add properties to adjacent nodes
      for (const assignment of cmd.assignments) {
        const target = nodes.find((n) => n.tempId === assignment.tempId);
        if (target) {
          const existingValue = target.properties[assignment.key];
          const newValue = existingValue != null
            ? Array.isArray(existingValue)
              ? [...existingValue, assignment.value]
              : [existingValue, assignment.value]
            : assignment.value;
          nodes = updateNode(nodes, assignment.tempId, {
            properties: { ...target.properties, [assignment.key]: newValue },
          });
        }
      }
      return { nodes, edges };
    }

    case 'accept-merge':
      return {
        ...state,
        nodes: updateNode(state.nodes, cmd.tempId, {
          mergeRecommendation: {
            ...findNode(state.nodes, cmd.tempId)!.mergeRecommendation!,
            status: 'accepted',
          },
        }),
      };

    case 'dismiss-merge':
      return {
        ...state,
        nodes: updateNode(state.nodes, cmd.tempId, {
          mergeRecommendation: {
            ...findNode(state.nodes, cmd.tempId)!.mergeRecommendation!,
            status: 'dismissed',
          },
        }),
      };

    default:
      return state;
  }
}

function reverseCommand(state: Pick<ExtractionReviewStore, 'nodes' | 'edges'>, cmd: ReviewCommand): Pick<ExtractionReviewStore, 'nodes' | 'edges'> {
  switch (cmd.type) {
    case 'edit-node':
      return { ...state, nodes: updateNode(state.nodes, cmd.tempId, cmd.before) };

    case 'edit-edge':
      return { ...state, edges: updateEdge(state.edges, cmd.tempId, cmd.before) };

    case 'add-edge':
      return { ...state, edges: state.edges.filter((e) => e.tempId !== cmd.edge.tempId) };

    case 'remove-edge':
      return { ...state, edges: updateEdge(state.edges, cmd.edge.tempId, { removed: false }) };

    case 'remove-node': {
      let { nodes, edges } = state;
      nodes = updateNode(nodes, cmd.node.tempId, { removed: false });
      for (const re of cmd.removedEdges) {
        edges = updateEdge(edges, re.tempId, { removed: false });
      }
      return { nodes, edges };
    }

    case 'convert-to-property': {
      let { nodes, edges } = state;
      // Restore the node
      nodes = updateNode(nodes, cmd.node.tempId, { removed: false });
      // Restore edges
      for (const re of cmd.removedEdges) {
        edges = updateEdge(edges, re.tempId, { removed: false });
      }
      // Restore original properties on adjacent nodes
      for (const assignment of cmd.assignments) {
        nodes = updateNode(nodes, assignment.tempId, {
          properties: { ...assignment.beforeProps },
        });
      }
      return { nodes, edges };
    }

    case 'accept-merge':
      return {
        ...state,
        nodes: updateNode(state.nodes, cmd.tempId, {
          mergeRecommendation: cmd.before ? { ...cmd.before } : undefined,
        }),
      };

    case 'dismiss-merge':
      return {
        ...state,
        nodes: updateNode(state.nodes, cmd.tempId, {
          mergeRecommendation: cmd.before ? { ...cmd.before } : undefined,
        }),
      };

    default:
      return state;
  }
}

export const useExtractionReviewStore = create<ExtractionReviewStore>((set, get) => ({
  nodes: [],
  edges: [],
  viewMode: 'extracted',
  selectedTempId: null,
  selectedType: null,
  undoStack: [],
  redoStack: [],
  sourceUrl: null,
  active: false,
  pendingConversion: null,

  initialize: (nodes, edges, sourceUrl) =>
    set({
      nodes,
      edges,
      viewMode: 'extracted',
      selectedTempId: null,
      selectedType: null,
      undoStack: [],
      redoStack: [],
      sourceUrl,
      active: true,
      pendingConversion: null,
    }),

  reset: () =>
    set({
      nodes: [],
      edges: [],
      viewMode: 'extracted',
      selectedTempId: null,
      selectedType: null,
      undoStack: [],
      redoStack: [],
      sourceUrl: null,
      active: false,
      pendingConversion: null,
    }),

  setViewMode: (mode) => set({ viewMode: mode }),

  select: (tempId, type) => set({ selectedTempId: tempId, selectedType: type }),

  editNode: (tempId, changes) => {
    const node = findNode(get().nodes, tempId);
    if (!node) return;

    const before: Partial<ReviewNode> = {};
    const after: Partial<ReviewNode> = {};
    for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
      (before as any)[key] = node[key];
      (after as any)[key] = changes[key];
    }

    const cmd: ReviewCommand = { type: 'edit-node', tempId, before, after };
    const result = applyCommand(get(), cmd);
    set({ ...result, undoStack: [...get().undoStack, cmd], redoStack: [] });
  },

  editEdge: (tempId, changes) => {
    const edge = findEdge(get().edges, tempId);
    if (!edge) return;

    const before: Partial<ReviewEdge> = {};
    const after: Partial<ReviewEdge> = {};
    for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
      (before as any)[key] = edge[key];
      (after as any)[key] = changes[key];
    }

    const cmd: ReviewCommand = { type: 'edit-edge', tempId, before, after };
    const result = applyCommand(get(), cmd);
    set({ ...result, undoStack: [...get().undoStack, cmd], redoStack: [] });
  },

  addEdge: (sourceTempId, targetTempId, label, type) => {
    const edge: ReviewEdge = {
      tempId: `temp-${crypto.randomUUID()}`,
      sourceTempId,
      targetTempId,
      label,
      type: type ?? 'related_to',
      removed: false,
    };
    const cmd: ReviewCommand = { type: 'add-edge', edge };
    const result = applyCommand(get(), cmd);
    set({ ...result, undoStack: [...get().undoStack, cmd], redoStack: [] });
  },

  removeEdge: (tempId) => {
    const edge = findEdge(get().edges, tempId);
    if (!edge || edge.removed) return;

    const cmd: ReviewCommand = { type: 'remove-edge', edge: { ...edge } };
    const result = applyCommand(get(), cmd);
    set({ ...result, undoStack: [...get().undoStack, cmd], redoStack: [] });
  },

  removeNode: (tempId) => {
    const node = findNode(get().nodes, tempId);
    if (!node || node.removed) return;

    const connectedEdges = getConnectedEdges(get().edges, tempId);
    const cmd: ReviewCommand = {
      type: 'remove-node',
      node: { ...node },
      removedEdges: connectedEdges.map((e) => ({ ...e })),
    };
    const result = applyCommand(get(), cmd);
    set({
      ...result,
      undoStack: [...get().undoStack, cmd],
      redoStack: [],
      selectedTempId: get().selectedTempId === tempId ? null : get().selectedTempId,
      selectedType: get().selectedTempId === tempId ? null : get().selectedType,
    });
  },

  prepareConvertToProperty: async (nodeTempId) => {
    const state = get();
    const node = findNode(state.nodes, nodeTempId);
    if (!node) return;

    const connectedEdges = getConnectedEdges(state.edges, nodeTempId);
    if (connectedEdges.length === 0) return;

    // Set loading state
    set({
      pendingConversion: {
        nodeTempId,
        nodeName: node.name,
        loading: true,
        assignments: [],
      },
    });

    // Build edge info for LLM
    const edgeInfos = connectedEdges.map((e) => {
      const isSource = e.sourceTempId === nodeTempId;
      const adjacentTempId = isSource ? e.targetTempId : e.sourceTempId;
      const adjacentNode = findNode(state.nodes, adjacentTempId);
      return {
        edgeLabel: e.label,
        direction: isSource ? 'outgoing' : 'incoming',
        adjacentTempId,
        adjacentName: adjacentNode?.name ?? 'Unknown',
      };
    });

    try {
      // Try LLM for inverse key suggestions
      const config = await chrome.storage.local.get('llmConfig') as Record<string, any>;
      const llmConfig = config.llmConfig;

      let suggestedKeys: Record<string, string> = {};

      if (llmConfig?.apiKey) {
        const requestId = crypto.randomUUID();

        const prompt = `Given these relationships from the perspective of "${node.name}", suggest the property key name from each adjacent node's perspective. Return ONLY a JSON object mapping each edge label to the suggested property key.

Relationships:
${edgeInfos.map((e) => `- ${e.direction === 'outgoing' ? `${node.name} --[${e.edgeLabel}]--> ${e.adjacentName}` : `${e.adjacentName} --[${e.edgeLabel}]--> ${node.name}`}`).join('\n')}

Example: if Python --[has_framework]--> Django, and Python is being converted, Django should get property key "language" or "written_in".

Return JSON like: {"has_framework": "written_in"}`;

        chrome.runtime.sendMessage({
          type: 'LLM_REQUEST',
          requestId,
          payload: {
            provider: llmConfig.provider,
            model: llmConfig.model,
            prompt,
          },
        });

        try {
          const result = await new Promise<{ content?: string; error?: string }>((resolve, reject) => {
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error('Timeout'));
            }, 30_000);

            const listener = (message: any) => {
              if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
              const { done, content, error } = message.payload;
              if (done) {
                cleanup();
                resolve({ content, error });
              }
            };

            const cleanup = () => {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(listener);
            };

            chrome.runtime.onMessage.addListener(listener);
          });

          if (result.content) {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              suggestedKeys = JSON.parse(jsonMatch[0]);
            }
          }
        } catch {
          // LLM failed, fall back to edge labels
        }
      }

      // Build assignments
      const assignments = edgeInfos.map((e) => ({
        adjacentTempId: e.adjacentTempId,
        adjacentName: e.adjacentName,
        suggestedKey: suggestedKeys[e.edgeLabel] ?? e.edgeLabel,
        originalEdgeLabel: e.edgeLabel,
        value: node.name,
      }));

      set({
        pendingConversion: {
          nodeTempId,
          nodeName: node.name,
          loading: false,
          assignments,
        },
      });
    } catch {
      // On any error, fall back to edge labels as keys
      const assignments = edgeInfos.map((e) => ({
        adjacentTempId: e.adjacentTempId,
        adjacentName: e.adjacentName,
        suggestedKey: e.edgeLabel,
        originalEdgeLabel: e.edgeLabel,
        value: node.name,
      }));

      set({
        pendingConversion: {
          nodeTempId,
          nodeName: node.name,
          loading: false,
          assignments,
        },
      });
    }
  },

  updateConversionKey: (index, newKey) => {
    const pc = get().pendingConversion;
    if (!pc) return;
    const assignments = [...pc.assignments];
    assignments[index] = { ...assignments[index], suggestedKey: newKey };
    set({ pendingConversion: { ...pc, assignments } });
  },

  confirmConvertToProperty: () => {
    const state = get();
    const pc = state.pendingConversion;
    if (!pc) return;

    const node = findNode(state.nodes, pc.nodeTempId);
    if (!node) return;

    const connectedEdges = getConnectedEdges(state.edges, pc.nodeTempId);

    // Build command assignments with before-properties for undo
    const cmdAssignments = pc.assignments.map((a) => {
      const adjacentNode = findNode(state.nodes, a.adjacentTempId);
      return {
        tempId: a.adjacentTempId,
        key: a.suggestedKey,
        value: a.value,
        beforeProps: { ...(adjacentNode?.properties ?? {}) },
      };
    });

    const cmd: ReviewCommand = {
      type: 'convert-to-property',
      node: { ...node },
      assignments: cmdAssignments,
      removedEdges: connectedEdges.map((e) => ({ ...e })),
    };

    const result = applyCommand(state, cmd);
    set({
      ...result,
      undoStack: [...state.undoStack, cmd],
      redoStack: [],
      pendingConversion: null,
      selectedTempId: null,
      selectedType: null,
    });
  },

  cancelConvertToProperty: () => set({ pendingConversion: null }),

  acceptMerge: (tempId) => {
    const node = findNode(get().nodes, tempId);
    if (!node?.mergeRecommendation) return;

    const before = { ...node.mergeRecommendation };
    const cmd: ReviewCommand = { type: 'accept-merge', tempId, before };
    const result = applyCommand(get(), cmd);
    set({ ...result, undoStack: [...get().undoStack, cmd], redoStack: [] });
  },

  dismissMerge: (tempId) => {
    const node = findNode(get().nodes, tempId);
    if (!node?.mergeRecommendation) return;

    const before = { ...node.mergeRecommendation };
    const cmd: ReviewCommand = { type: 'dismiss-merge', tempId, before };
    const result = applyCommand(get(), cmd);
    set({ ...result, undoStack: [...get().undoStack, cmd], redoStack: [] });
  },

  undo: () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return;

    const cmd = undoStack[undoStack.length - 1];
    const result = reverseCommand(get(), cmd);
    set({
      ...result,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, cmd],
    });
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return;

    const cmd = redoStack[redoStack.length - 1];
    const result = applyCommand(get(), cmd);
    set({
      ...result,
      undoStack: [...undoStack, cmd],
      redoStack: redoStack.slice(0, -1),
    });
  },

  activeNodes: () => get().nodes.filter((n) => !n.removed),

  activeEdges: () => {
    const { nodes, edges } = get();
    const activeReviewIds = new Set(nodes.filter((n) => !n.removed).map((n) => n.tempId));
    const allReviewIds = new Set(nodes.map((n) => n.tempId));
    return edges.filter((e) => {
      if (e.removed) return false;
      // Each endpoint is valid if: it's an active review node, OR it's not a review node at all (existing graph node)
      const sourceOk = activeReviewIds.has(e.sourceTempId) || !allReviewIds.has(e.sourceTempId);
      const targetOk = activeReviewIds.has(e.targetTempId) || !allReviewIds.has(e.targetTempId);
      return sourceOk && targetOk;
    });
  },
}));
