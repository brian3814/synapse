/**
 * DataStore — abstract interface for the database layer.
 *
 * Every method returns a Promise so implementations can be sync (better-sqlite3)
 * or async (wa-sqlite / OPFS, future Postgres). The 16 repository sub-interfaces
 * mirror the existing query modules 1:1.
 */

import type {
  DbNode,
  DbNodeSlim,
  DbEdge,
  DbEdgeSlim,
  DbEntityAlias,
  DbSourceContent,
  DbEdgeSource,
  DbIndexedFile,
  DbNoteAttachment,
  NodeType,
} from '../shared/types';

// Types defined locally in query modules — re-exported here so consumers
// can import from a single location.

export type { ResolvedEntity } from './worker/queries/entity-resolution-queries';
export type { NoteSearchResult } from './worker/queries/note-search-queries';
export type { ClusterSummary, InterClusterEdge } from './worker/queries/spatial-queries';
export type { EdgeProvenanceType } from './worker/queries/edge-source-queries';
export type { EntityRelationType } from './worker/queries/entity-source-queries';
export type { EpisodicMemory } from './worker/queries/memory-queries';

// Import for use in interface signatures
import type { ResolvedEntity } from './worker/queries/entity-resolution-queries';
import type { NoteSearchResult } from './worker/queries/note-search-queries';
import type { ClusterSummary, InterClusterEdge } from './worker/queries/spatial-queries';
import type { EdgeProvenanceType } from './worker/queries/edge-source-queries';
import type { QueryResult, MutationResult } from './worker/query-engine/types';

// ── Repository Sub-interfaces ─────────────────────────────────────────

export interface NodeRepository {
  getAll(): Promise<DbNode[]>;
  getAllSlim(): Promise<DbNodeSlim[]>;
  getById(id: string): Promise<DbNode | null>;
  create(input: {
    name: string;
    type?: string;
    label?: string;
    folderPath?: string;
    identifier?: string;
    properties?: string;
    color?: string;
    size?: number;
    sourceUrl?: string;
    vaultPath?: string;
    contentType?: string;
  }): Promise<DbNode>;
  update(input: {
    id: string;
    name?: string;
    type?: string;
    label?: string;
    summary?: string;
    folderPath?: string;
    properties?: string;
    x?: number;
    y?: number;
    z?: number;
    color?: string;
    size?: number;
  }): Promise<DbNode | null>;
  delete(id: string): Promise<boolean>;
  search(queryText: string, limit?: number): Promise<DbNode[]>;
  getTypes(): Promise<string[]>;
  matchTerms(terms: string[], limit?: number): Promise<DbNode[]>;
  getNeighborhood(nodeId: string, hops?: number): Promise<{ nodeIds: string[] }>;
}

export interface EdgeRepository {
  getAll(): Promise<DbEdge[]>;
  getAllSlim(): Promise<DbEdgeSlim[]>;
  getById(id: string): Promise<DbEdge | null>;
  getForNode(nodeId: string): Promise<DbEdge[]>;
  create(input: {
    sourceId: string;
    targetId: string;
    label: string;
    type?: string;
    properties?: string;
    weight?: number;
    directed?: boolean;
    sourceUrl?: string;
  }): Promise<DbEdge>;
  update(input: {
    id: string;
    label?: string;
    type?: string;
    properties?: string;
    weight?: number;
  }): Promise<DbEdge | null>;
  delete(id: string): Promise<boolean>;
  getTypes(): Promise<string[]>;
  search(queryText: string, limit?: number): Promise<(DbEdge & { source_name: string; target_name: string })[]>;
  getBetween(nodeIds: string[]): Promise<DbEdge[]>;
}

export interface NodeTypeRepository {
  getAll(): Promise<NodeType[]>;
  create(input: {
    type: string;
    description?: string;
    color?: string;
    category?: 'structural' | 'entity_label';
  }): Promise<NodeType>;
  delete(type: string): Promise<boolean>;
}

export interface SourceContentRepository {
  save(input: {
    nodeId?: string;
    url: string;
    title?: string;
    content: string;
  }): Promise<DbSourceContent>;
  getByNodeId(nodeId: string): Promise<DbSourceContent | null>;
  getByUrl(url: string): Promise<DbSourceContent | null>;
  search(queryText: string, limit?: number): Promise<DbSourceContent[]>;
  deleteByNodeId(nodeId: string): Promise<boolean>;
  getAll(): Promise<DbSourceContent[]>;
}

export interface EntityResolutionRepository {
  findMatches(name: string, fuzzyThreshold?: number): Promise<ResolvedEntity[]>;
  addAlias(nodeId: string, alias: string): Promise<DbEntityAlias>;
  getAliases(nodeId: string): Promise<DbEntityAlias[]>;
  removeAlias(aliasId: string): Promise<boolean>;
}

export interface TagRepository {
  getForNode(nodeId: string): Promise<string[]>;
  setForNode(nodeId: string, tags: string[]): Promise<void>;
  getAllTags(): Promise<string[]>;
}

export interface EdgeSourceRepository {
  add(input: {
    edgeId: string;
    sourceType: EdgeProvenanceType;
    sourceId?: string | null;
    resourceId?: string | null;
    location?: string | null;
  }): Promise<void>;
  getForEdge(edgeId: string): Promise<DbEdgeSource[]>;
  removeForNote(noteId: string): Promise<number>;
  getEdgesFromNote(noteId: string): Promise<string[]>;
}

export interface EntitySourceRepository {
  getForEntity(entityId: string): Promise<Array<{ resourceId: string; relationType: string; createdAt: string; location?: string }>>;
  add(entityId: string, resourceId: string, relationType?: string, location?: string): Promise<void>;
  remove(entityId: string, resourceId: string, relationType?: string): Promise<boolean>;
  removeAllForResource(resourceId: string): Promise<number>;
  getEntitiesForResource(resourceId: string): Promise<Array<{ entityId: string; relationType: string }>>;
}

export interface IndexedFileRepository {
  save(input: {
    filePath: string;
    fileName: string;
    lastModified: number;
    contentHash?: string;
    nodeId?: string;
  }): Promise<DbIndexedFile>;
  getByPath(filePath: string): Promise<DbIndexedFile | null>;
  getAll(): Promise<DbIndexedFile[]>;
  deleteByPath(filePath: string): Promise<boolean>;
  deleteByNodeId(nodeId: string): Promise<boolean>;
  getByNodeId(nodeId: string): Promise<DbIndexedFile | null>;
}

export interface SpatialRepository {
  batchUpdatePositions(updates: Array<{ id: string; x: number; y: number }>): Promise<void>;
  nodesInBounds(minX: number, minY: number, maxX: number, maxY: number, limit?: number): Promise<DbNodeSlim[]>;
  edgesForNodes(nodeIds: string[]): Promise<DbEdgeSlim[]>;
  clusterSummary(): Promise<ClusterSummary[]>;
  interClusterEdges(): Promise<InterClusterEdge[]>;
  nodeCountInBounds(minX: number, minY: number, maxX: number, maxY: number): Promise<number>;
  totalNodeCount(): Promise<number>;
}

export interface ReadingListRepository {
  save(input: { url: string; title: string; summary: string; keyTopics: string[]; nodeIds: string[] }): Promise<any>;
  getAll(): Promise<any[]>;
  getByUrl(url: string): Promise<any | null>;
  getRecent(limit: number): Promise<any[]>;
}

export interface ChatRepository {
  getActiveSession(): Promise<any | null>;
  createSession(id: string, title: string): Promise<any>;
  expireSession(id: string): Promise<void>;
  expireStale(): Promise<void>;
  touchSession(id: string): Promise<void>;
  pruneSessions(maxSessions?: number): Promise<void>;
  saveMessage(input: {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    ragContext?: string | null;
    status: 'complete' | 'error';
  }): Promise<any>;
  getMessages(sessionId: string): Promise<any[]>;
  getRecentMessages(sessionId: string, limit?: number): Promise<any[]>;
  getAllSessions(): Promise<any[]>;
}

export interface NoteAttachmentRepository {
  create(noteId: string, filename: string, mimeType: string, data: Uint8Array): Promise<DbNoteAttachment>;
  get(id: string): Promise<DbNoteAttachment | null>;
  getForNote(noteId: string): Promise<Omit<DbNoteAttachment, 'data'>[]>;
  delete(id: string): Promise<boolean>;
}

export interface NoteSearchRepository {
  upsert(nodeId: string, title: string, body: string): Promise<void>;
  delete(nodeId: string): Promise<boolean>;
  search(queryText: string, limit?: number): Promise<NoteSearchResult[]>;
  getEntry(nodeId: string): Promise<{ title: string; body: string } | null>;
  getAll(): Promise<Array<{ node_id: string; title: string }>>;
}

export interface StressTestRepository {
  generate(nodeCount: number): Promise<{ nodes: number; edges: number }>;
}

export interface MemoryRepository {
  addEpisodic(input: { sessionId: string; summary: string; keyTopics?: string[] }): Promise<any>;
  getRecentEpisodic(limit?: number): Promise<any[]>;
  clearAllEpisodic(): Promise<number>;
}

// ── Top-level DataStore ───────────────────────────────────────────────

export interface DataStore {
  /** Initialize the database engine and run migrations. */
  init(): Promise<void>;

  /** Reset the database (drop + recreate). */
  reset(): Promise<void>;

  // Repository accessors
  nodes: NodeRepository;
  edges: EdgeRepository;
  nodeTypes: NodeTypeRepository;
  sourceContent: SourceContentRepository;
  entityResolution: EntityResolutionRepository;
  tags: TagRepository;
  edgeSources: EdgeSourceRepository;
  entitySources: EntitySourceRepository;
  indexedFiles: IndexedFileRepository;
  spatial: SpatialRepository;
  readingList: ReadingListRepository;
  chat: ChatRepository;
  noteAttachments: NoteAttachmentRepository;
  noteSearch: NoteSearchRepository;
  stressTest: StressTestRepository;
  memory: MemoryRepository;

  /** Load the full graph (slim projections) in a single round-trip. */
  loadGraph(): Promise<{ nodes: DbNodeSlim[]; edges: DbEdgeSlim[] }>;

  /** Delete all nodes, edges, and chat data. */
  clearAll(): Promise<void>;

  /** Execute a graph DSL query (planner + SQL). */
  graphQuery(input: unknown): Promise<QueryResult>;

  /** Execute a graph DSL mutation (collision resolution + SQL). */
  graphMutate(input: unknown): Promise<MutationResult>;

  /** Raw SQL query — escape hatch. */
  rawQuery<T>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Raw SQL exec — escape hatch. Returns number of changed rows. */
  rawExec(sql: string, params?: unknown[]): Promise<number>;
}
