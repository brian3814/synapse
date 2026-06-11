import { db } from '@platform';

let ready = false;

export async function initDbClient(): Promise<void> {
  if (ready) return;
  await db.init();
  ready = true;
}

export function isDbReady(): boolean {
  return ready;
}

function sendRequest(action: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
  const requestPromise = db.request(action, params);
  if (!timeoutMs) return requestPromise;
  return Promise.race([
    requestPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`DB request timed out: ${action}`)), timeoutMs)
    ),
  ]);
}

// Generic query/exec
export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = (await sendRequest('query', { sql, params })) as { rows: T[] };
  return result.rows;
}

export async function dbExec(sql: string, params?: unknown[]): Promise<number> {
  const result = (await sendRequest('exec', { sql, params })) as { changes: number };
  return result.changes;
}

// Bulk graph load — single round-trip with slim columns
export function loadGraph(): Promise<{ nodes: any[]; edges: any[] }> {
  return sendRequest('loadGraph') as Promise<{ nodes: any[]; edges: any[] }>;
}

// Typed node operations
export const nodes = {
  getAll: () => sendRequest('nodes.getAll') as Promise<any[]>,
  getById: (id: string) => sendRequest('nodes.getById', id) as Promise<any>,
  create: (input: any) => sendRequest('nodes.create', input) as Promise<any>,
  update: (input: any) => sendRequest('nodes.update', input) as Promise<any>,
  delete: (id: string) => sendRequest('nodes.delete', id) as Promise<boolean>,
  search: (query: string, limit?: number) =>
    sendRequest('nodes.search', { query, limit }, 30_000) as Promise<any[]>,
  getTypes: () => sendRequest('nodes.getTypes') as Promise<string[]>,
  getNeighborhood: (nodeId: string, hops?: number) =>
    sendRequest('nodes.getNeighborhood', { nodeId, hops }) as Promise<{ nodeIds: string[] }>,
  matchTerms: (terms: string[], limit?: number) =>
    sendRequest('nodes.matchTerms', { terms, limit }) as Promise<any[]>,
};

// Typed edge operations
export const edges = {
  getAll: () => sendRequest('edges.getAll') as Promise<any[]>,
  getById: (id: string) => sendRequest('edges.getById', id) as Promise<any>,
  getForNode: (nodeId: string) => sendRequest('edges.getForNode', nodeId) as Promise<any[]>,
  create: (input: any) => sendRequest('edges.create', input) as Promise<any>,
  update: (input: any) => sendRequest('edges.update', input) as Promise<any>,
  delete: (id: string) => sendRequest('edges.delete', id) as Promise<boolean>,
  getBetween: (nodeIds: string[]) => sendRequest('edges.getBetween', nodeIds) as Promise<any[]>,
  getTypes: () => sendRequest('edges.getTypes') as Promise<string[]>,
  search: (query: string, limit?: number) =>
    sendRequest('edges.search', { query, limit }, 30_000) as Promise<any[]>,
  getOntologyEdgeTypes: () =>
    sendRequest('edges.getOntologyEdgeTypes') as Promise<{ type: string; description: string | null; category: string }[]>,
  getDistinctEdgeLabels: () =>
    sendRequest('edges.getDistinctEdgeLabels') as Promise<string[]>,
  createOntologyEdgeType: (input: { type: string; description?: string; category?: string }) =>
    sendRequest('edges.createOntologyEdgeType', input) as Promise<boolean>,
};

// Node type operations
export const nodeTypes = {
  getAll: () => sendRequest('nodeTypes.getAll') as Promise<any[]>,
  create: (input: {
    type: string;
    description?: string;
    color?: string;
    category?: 'structural' | 'entity_label';
  }) => sendRequest('nodeTypes.create', input) as Promise<any>,
  delete: (type: string) => sendRequest('nodeTypes.delete', type) as Promise<boolean>,
  getDistinctEntityLabels: () =>
    sendRequest('nodeTypes.getDistinctEntityLabels') as Promise<string[]>,
};

// Source content operations
export const sourceContent = {
  save: (input: { nodeId?: string; url: string; title?: string; content: string }) =>
    sendRequest('sourceContent.save', input) as Promise<any>,
  getByNodeId: (nodeId: string) =>
    sendRequest('sourceContent.getByNodeId', nodeId) as Promise<any>,
  getByUrl: (url: string) =>
    sendRequest('sourceContent.getByUrl', url) as Promise<any>,
  search: (query: string, limit?: number) =>
    sendRequest('sourceContent.search', { query, limit }) as Promise<any[]>,
  delete: (nodeId: string) =>
    sendRequest('sourceContent.delete', nodeId) as Promise<boolean>,
  getAll: () =>
    sendRequest('sourceContent.getAll') as Promise<any[]>,
};

// Note attachment operations
export const noteAttachments = {
  create: (noteId: string, filename: string, mimeType: string, data: Uint8Array) =>
    sendRequest('noteAttachments.create', { noteId, filename, mimeType, data }) as Promise<any>,
  get: (id: string) =>
    sendRequest('noteAttachments.get', id) as Promise<any>,
  getForNote: (noteId: string) =>
    sendRequest('noteAttachments.getForNote', noteId) as Promise<any[]>,
  delete: (id: string) =>
    sendRequest('noteAttachments.delete', id) as Promise<boolean>,
};

// Note search operations (OPFS FTS5 index)
export const noteSearch = {
  upsert: (nodeId: string, title: string, body: string) =>
    sendRequest('noteSearch.upsert', { nodeId, title, body }) as Promise<{ success: boolean }>,
  delete: (nodeId: string) =>
    sendRequest('noteSearch.delete', nodeId) as Promise<boolean>,
  search: (query: string, limit?: number) =>
    sendRequest('noteSearch.search', { query, limit }, 30_000) as Promise<
      Array<{ node_id: string; title: string; snippet: string }>
    >,
  getEntry: (nodeId: string) =>
    sendRequest('noteSearch.getEntry', nodeId) as Promise<{ title: string; body: string } | null>,
  getAll: () =>
    sendRequest('noteSearch.getAll') as Promise<Array<{ node_id: string; title: string }>>,
};

// Entity resolution operations
export const entityResolution = {
  findMatches: (name: string, fuzzyThreshold?: number) =>
    sendRequest('entityResolution.findMatches', { name, fuzzyThreshold }) as Promise<any[]>,
  addAlias: (nodeId: string, alias: string) =>
    sendRequest('entityResolution.addAlias', { nodeId, alias }) as Promise<any>,
  getAliases: (nodeId: string) =>
    sendRequest('entityResolution.getAliases', nodeId) as Promise<any[]>,
  removeAlias: (aliasId: string) =>
    sendRequest('entityResolution.removeAlias', aliasId) as Promise<boolean>,
};

// Tag operations
export const tags = {
  getForNode: (nodeId: string) =>
    sendRequest('tags.getForNode', nodeId) as Promise<string[]>,
  setForNode: (nodeId: string, tags: string[]) =>
    sendRequest('tags.setForNode', { nodeId, tags }) as Promise<{ success: boolean }>,
  getAllTags: () =>
    sendRequest('tags.getAllTags') as Promise<string[]>,
};


// Edge provenance operations (edge_sources table).
// Edges can originate from three kinds of sources in the three-layer model:
//   - 'note':       the edge was inferred from a note's prose (source_id = note node ID)
//   - 'extraction': the edge was emitted directly by an LLM extraction (resource_id = resource node ID)
//   - 'user':       the edge was created manually in the UI
export type EdgeProvenanceType = 'note' | 'extraction' | 'user';

export const edgeSources = {
  add: (input: {
    edgeId: string;
    sourceType: EdgeProvenanceType;
    sourceId?: string | null;
    resourceId?: string | null;
  }) => sendRequest('edgeSources.add', input) as Promise<{ success: boolean }>,
  getForEdge: (edgeId: string) =>
    sendRequest('edgeSources.getForEdge', edgeId) as Promise<
      Array<{
        id: number;
        edge_id: string;
        source_type: EdgeProvenanceType;
        source_id: string | null;
        resource_id: string | null;
        created_at: string;
      }>
    >,
  removeForNote: (noteId: string) =>
    sendRequest('edgeSources.removeForNote', noteId) as Promise<number>,
  getEdgesFromNote: (noteId: string) =>
    sendRequest('edgeSources.getEdgesFromNote', noteId) as Promise<string[]>,
};

// Entity source operations (entity → resource provenance with about/mention distinction)
export type EntityRelationType = 'about' | 'mention';

export const entitySources = {
  getForEntity: (entityId: string) =>
    sendRequest('entitySources.getForEntity', entityId) as Promise<
      { resourceId: string; relationType: EntityRelationType; createdAt: string }[]
    >,
  add: (entityId: string, resourceId: string, relationType: EntityRelationType = 'about') =>
    sendRequest('entitySources.add', { entityId, resourceId, relationType }) as Promise<{
      success: boolean;
    }>,
  remove: (entityId: string, resourceId: string, relationType?: EntityRelationType) =>
    sendRequest('entitySources.remove', { entityId, resourceId, relationType }) as Promise<boolean>,
  removeAllForResource: (resourceId: string) =>
    sendRequest('entitySources.removeAllForResource', resourceId) as Promise<number>,
  getEntitiesForResource: (resourceId: string) =>
    sendRequest('entitySources.getEntitiesForResource', resourceId) as Promise<
      { entityId: string; relationType: EntityRelationType }[]
    >,
};

// Spatial queries
export const spatial = {
  nodesInBounds: (minX: number, minY: number, maxX: number, maxY: number, limit?: number) =>
    sendRequest('spatial.nodesInBounds', { minX, minY, maxX, maxY, limit }) as Promise<any[]>,
  edgesForNodes: (nodeIds: string[]) =>
    sendRequest('spatial.edgesForNodes', nodeIds) as Promise<any[]>,
  clusterSummary: () =>
    sendRequest('spatial.clusterSummary') as Promise<any[]>,
  interClusterEdges: () =>
    sendRequest('spatial.interClusterEdges', undefined, 30_000) as Promise<any[]>,
  batchUpdatePositions: (updates: Array<{ id: string; x: number; y: number }>) =>
    sendRequest('spatial.batchUpdatePositions', updates, 60_000) as Promise<{ success: boolean }>,
  nodeCountInBounds: (minX: number, minY: number, maxX: number, maxY: number) =>
    sendRequest('spatial.nodeCountInBounds', { minX, minY, maxX, maxY }) as Promise<number>,
  totalNodeCount: () =>
    sendRequest('spatial.totalNodeCount') as Promise<number>,
};

// Reading list history operations
export const readingList = {
  save: (input: { url: string; title: string; summary: string; keyTopics: string[]; nodeIds: string[] }) =>
    sendRequest('readingList.save', input) as Promise<any>,
  getAll: () =>
    sendRequest('readingList.getAll') as Promise<any[]>,
  getByUrl: (url: string) =>
    sendRequest('readingList.getByUrl', url) as Promise<any>,
  getRecent: (limit: number) =>
    sendRequest('readingList.getRecent', limit) as Promise<any[]>,
};

// Chat session operations
export const chat = {
  getActiveSession: () =>
    sendRequest('chat.getActiveSession') as Promise<any | null>,
  createSession: (id: string, title: string) =>
    sendRequest('chat.createSession', { id, title }) as Promise<any>,
  expireSession: (id: string) =>
    sendRequest('chat.expireSession', id) as Promise<{ success: boolean }>,
  expireStale: () =>
    sendRequest('chat.expireStale') as Promise<{ success: boolean }>,
  touchSession: (id: string) =>
    sendRequest('chat.touchSession', id) as Promise<{ success: boolean }>,
  pruneSessions: () =>
    sendRequest('chat.pruneSessions') as Promise<{ success: boolean }>,
  saveMessage: (input: {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'complete' | 'error';
  }) => sendRequest('chat.saveMessage', input) as Promise<any>,
  getMessages: (sessionId: string) =>
    sendRequest('chat.getMessages', sessionId) as Promise<any[]>,
  getRecentMessages: (sessionId: string, limit?: number) =>
    sendRequest('chat.getRecentMessages', { sessionId, limit }) as Promise<any[]>,
  getAllSessions: () =>
    sendRequest('chat.getAllSessions') as Promise<any[]>,
};

// Query engine operations
export const graph = {
  query: (graphQuery: unknown) => sendRequest('query.execute', graphQuery),
  mutate: (mutation: unknown) => sendRequest('mutation.execute', mutation),
};

export function clearAll(): Promise<{ success: boolean }> {
  return sendRequest('clearAll') as Promise<{ success: boolean }>;
}

export const stressTest = {
  generate: (nodeCount: number) =>
    sendRequest('stressTest.generate', { nodeCount }, 300_000) as Promise<{ nodes: number; edges: number }>,
};
