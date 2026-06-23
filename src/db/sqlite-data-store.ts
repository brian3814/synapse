/**
 * SqliteDataStore — wraps existing query modules behind the DataStore interface.
 *
 * No SQL or query logic changes — this is purely a delegation layer that maps
 * DataStore repository methods to the corresponding query module functions.
 */

import * as nodeQueries from './worker/queries/node-queries';
import * as edgeQueries from './worker/queries/edge-queries';
import * as nodeTypeQueries from './worker/queries/node-type-queries';
import * as sourceContentQueries from './worker/queries/source-content-queries';
import * as entityResolutionQueries from './worker/queries/entity-resolution-queries';
import * as tagQueries from './worker/queries/tag-queries';
import * as edgeSourceQueries from './worker/queries/edge-source-queries';
import * as entitySourceQueries from './worker/queries/entity-source-queries';
import * as spatialQueries from './worker/queries/spatial-queries';
import * as readingListQueries from './worker/queries/reading-list-queries';
import * as chatQueries from './worker/queries/chat-queries';
import * as noteAttachmentQueries from './worker/queries/note-attachment-queries';
import * as noteSearchQueries from './worker/queries/note-search-queries';
import * as stressTestQueries from './worker/queries/stress-test-queries';
import { executeQuery, executeExec } from './worker/query-executor';
import { executeGraphQuery, executeGraphMutation } from './worker/query-engine/index';
import { runMigrations } from './worker/migrations';
import type { DataStore } from './data-store';

export function createSqliteDataStore(
  initEngine: () => Promise<void>,
  resetEngine: () => Promise<void>,
): DataStore {
  return {
    // ── Lifecycle ───────────────────────────────────────────────────

    async init() {
      await initEngine();
      await runMigrations();
    },

    async reset() {
      await resetEngine();
      await runMigrations();
    },

    // ── Node Repository ─────────────────────────────────────────────

    nodes: {
      getAll: () => nodeQueries.getAllNodes(),
      getAllSlim: () => nodeQueries.getAllNodesSlim(),
      getById: (id) => nodeQueries.getNodeById(id),
      create: (input) => nodeQueries.createNode(input),
      update: (input) => nodeQueries.updateNode(input),
      delete: (id) => nodeQueries.deleteNode(id),
      search: (q, limit) => nodeQueries.searchNodes(q, limit),
      getTypes: () => nodeQueries.getNodeTypes(),
      matchTerms: (terms, limit) => nodeQueries.matchTerms(terms, limit),
      getNeighborhood: (id, hops) => nodeQueries.getNeighborhood(id, hops),
    },

    // ── Edge Repository ─────────────────────────────────────────────

    edges: {
      getAll: () => edgeQueries.getAllEdges(),
      getAllSlim: () => edgeQueries.getAllEdgesSlim(),
      getById: (id) => edgeQueries.getEdgeById(id),
      getForNode: (nodeId) => edgeQueries.getEdgesForNode(nodeId),
      create: (input) => edgeQueries.createEdge(input),
      update: (input) => edgeQueries.updateEdge(input),
      delete: (id) => edgeQueries.deleteEdge(id),
      getTypes: () => edgeQueries.getEdgeTypes(),
      search: (q, limit) => edgeQueries.searchEdges(q, limit),
      getBetween: (nodeIds) => edgeQueries.getEdgesBetween(nodeIds),
      getOntologyEdgeTypes: () => edgeQueries.getAllOntologyEdgeTypes(),
      getDistinctEdgeLabels: () => edgeQueries.getDistinctEdgeLabels(),
      createOntologyEdgeType: (input) => edgeQueries.createOntologyEdgeType(input),
    },

    // ── Node Type Repository ────────────────────────────────────────

    nodeTypes: {
      getAll: () => nodeTypeQueries.getAllNodeTypes(),
      create: (input) => nodeTypeQueries.createNodeType(input),
      delete: (type) => nodeTypeQueries.deleteNodeType(type),
      getDistinctEntityLabels: () => nodeTypeQueries.getDistinctEntityLabels(),
    },

    // ── Source Content Repository ───────────────────────────────────

    sourceContent: {
      save: (input) => sourceContentQueries.saveSourceContent(input),
      getByNodeId: (nodeId) => sourceContentQueries.getByNodeId(nodeId),
      getByUrl: (url) => sourceContentQueries.getByUrl(url),
      search: (q, limit) => sourceContentQueries.searchContent(q, limit),
      deleteByNodeId: (nodeId) => sourceContentQueries.deleteByNodeId(nodeId),
      getAll: () => sourceContentQueries.getAllSourceContent(),
    },

    // ── Entity Resolution Repository ────────────────────────────────

    entityResolution: {
      findMatches: (name, fuzzyThreshold) => entityResolutionQueries.findMatches(name, fuzzyThreshold),
      addAlias: (nodeId, alias) => entityResolutionQueries.addAlias(nodeId, alias),
      getAliases: (nodeId) => entityResolutionQueries.getAliases(nodeId),
      removeAlias: (aliasId) => entityResolutionQueries.removeAlias(aliasId),
    },

    // ── Tag Repository ──────────────────────────────────────────────

    tags: {
      getForNode: (nodeId) => tagQueries.getTagsForNode(nodeId),
      setForNode: (nodeId, tags) => tagQueries.setTagsForNode(nodeId, tags),
      getAllTags: () => tagQueries.getAllTags(),
    },


    // ── Edge Source Repository ──────────────────────────────────────

    edgeSources: {
      add: (input) => edgeSourceQueries.addEdgeSource(input),
      getForEdge: (edgeId) => edgeSourceQueries.getSourcesForEdge(edgeId),
      removeForNote: (noteId) => edgeSourceQueries.removeSourcesForNote(noteId),
      getEdgesFromNote: (noteId) => edgeSourceQueries.getEdgesFromNote(noteId),
    },

    // ── Entity Source Repository ────────────────────────────────────

    entitySources: {
      getForEntity: (entityId) => entitySourceQueries.getSourcesForEntity(entityId),
      add: (entityId, resourceId, relationType, location) =>
        entitySourceQueries.addEntitySource(entityId, resourceId, relationType as any, location),
      remove: (entityId, resourceId, relationType) =>
        entitySourceQueries.removeEntitySource(entityId, resourceId, relationType as any),
      removeAllForResource: (resourceId) => entitySourceQueries.removeAllForResource(resourceId),
      getEntitiesForResource: (resourceId) => entitySourceQueries.getEntitiesForResource(resourceId),
    },

    // ── Spatial Repository ──────────────────────────────────────────

    spatial: {
      batchUpdatePositions: (updates) => spatialQueries.batchUpdatePositions(updates),
      nodesInBounds: (minX, minY, maxX, maxY, limit) =>
        spatialQueries.getNodesInBounds(minX, minY, maxX, maxY, limit),
      edgesForNodes: (nodeIds) => spatialQueries.getEdgesForVisibleNodes(nodeIds),
      clusterSummary: () => spatialQueries.getClusterSummary(),
      interClusterEdges: () => spatialQueries.getInterClusterEdges(),
      nodeCountInBounds: (minX, minY, maxX, maxY) =>
        spatialQueries.getNodeCountInBounds(minX, minY, maxX, maxY),
      totalNodeCount: () => spatialQueries.getTotalNodeCount(),
      nodeDegrees: () => spatialQueries.getNodeDegrees(),
    },

    // ── Reading List Repository ─────────────────────────────────────

    readingList: {
      save: (input) => readingListQueries.saveHistory(input),
      getAll: () => readingListQueries.getAll(),
      getByUrl: (url) => readingListQueries.getByUrl(url),
      getRecent: (limit) => readingListQueries.getRecent(limit),
    },

    // ── Chat Repository ─────────────────────────────────────────────

    chat: {
      getActiveSession: () => chatQueries.getActiveSession(),
      createSession: (id, title) => chatQueries.createSession(id, title),
      expireSession: (id) => chatQueries.expireSession(id),
      expireStale: () => chatQueries.expireAllStaleSessions(),
      touchSession: (id) => chatQueries.touchSession(id),
      pruneSessions: (maxSessions) => chatQueries.pruneSessions(maxSessions),
      saveMessage: (input) => chatQueries.saveMessage(input),
      getMessages: (sessionId) => chatQueries.getSessionMessages(sessionId),
      getRecentMessages: (sessionId, limit) => chatQueries.getRecentMessages(sessionId, limit),
      getAllSessions: () => chatQueries.getAllSessions(),
    },

    // ── Note Attachment Repository ──────────────────────────────────

    noteAttachments: {
      create: (noteId, filename, mimeType, data) =>
        noteAttachmentQueries.createAttachment(noteId, filename, mimeType, data),
      get: (id) => noteAttachmentQueries.getAttachment(id),
      getForNote: (noteId) => noteAttachmentQueries.getAttachmentsForNote(noteId),
      delete: (id) => noteAttachmentQueries.deleteAttachment(id),
    },

    // ── Note Search Repository ──────────────────────────────────────

    noteSearch: {
      upsert: (nodeId, title, body) => noteSearchQueries.upsertNoteSearch(nodeId, title, body),
      delete: (nodeId) => noteSearchQueries.deleteNoteSearch(nodeId),
      search: (q, limit) => noteSearchQueries.searchNotes(q, limit),
      getEntry: (nodeId) => noteSearchQueries.getNoteSearchEntry(nodeId),
      getAll: () => noteSearchQueries.getAllNoteSearchEntries(),
    },

    // ── Stress Test Repository ──────────────────────────────────────

    stressTest: {
      generate: (nodeCount) => stressTestQueries.generateStressTestData(nodeCount),
    },

    // ── Top-level operations ────────────────────────────────────────

    async loadGraph() {
      const [nodes, edges] = await Promise.all([
        nodeQueries.getAllNodesSlim(),
        edgeQueries.getAllEdgesSlim(),
      ]);
      return { nodes, edges };
    },

    async clearAll() {
      await executeExec('DELETE FROM edges');
      await executeExec('DELETE FROM nodes');
      await executeExec('DELETE FROM chat_messages');
      await executeExec('DELETE FROM chat_sessions');
    },

    graphQuery: (input) => executeGraphQuery(input),
    graphMutate: (input) => executeGraphMutation(input),

    async rawQuery<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const { rows } = await executeQuery<T>(sql, params);
      return rows;
    },

    async rawExec(sql: string, params?: unknown[]): Promise<number> {
      const { changes } = await executeExec(sql, params);
      return changes;
    },
  };
}
