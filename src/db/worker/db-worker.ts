/// <reference lib="webworker" />

import { initSQLite, resetDatabase } from './sqlite-engine';
import { runMigrations } from './migrations';
import { executeQuery, executeExec } from './query-executor';
import * as nodeQueries from './queries/node-queries';
import * as edgeQueries from './queries/edge-queries';
import * as nodeTypeQueries from './queries/node-type-queries';
import * as sourceContentQueries from './queries/source-content-queries';
import * as entityResolutionQueries from './queries/entity-resolution-queries';
import * as indexedFileQueries from './queries/indexed-file-queries';
import * as stressTestQueries from './queries/stress-test-queries';
import * as spatialQueries from './queries/spatial-queries';
import * as readingListQueries from './queries/reading-list-queries';
import * as tagQueries from './queries/tag-queries';
import * as entitySourceQueries from './queries/entity-source-queries';
import * as edgeSourceQueries from './queries/edge-source-queries';
import * as noteFolderQueries from './queries/note-folder-queries';
import * as chatQueries from './queries/chat-queries';
import * as noteAttachmentQueries from './queries/note-attachment-queries';
import { executeGraphQuery, executeGraphMutation } from './query-engine';
import type { SyncEvent } from '../../shared/sync-events';

type WorkerRequest = {
  requestId: string;
  action: string;
  params?: unknown;
};

type WorkerResponse = {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  syncEvent?: SyncEvent;
};

let isInitialized = false;

function ensureInit(): void {
  if (!isInitialized) {
    throw new Error('Database not initialized. Call init first.');
  }
}

async function handleAction(action: string, params: unknown): Promise<{ result: unknown; syncEvent?: SyncEvent }> {
  switch (action) {
    case 'init': {
      if (!isInitialized) {
        await initSQLite();
        await runMigrations();
        isInitialized = true;
      }
      return { result: { ready: true } };
    }

    case 'ping': {
      return { result: { alive: true } };
    }

    case 'reset': {
      await resetDatabase();
      await runMigrations();
      isInitialized = true;
      return { result: { ready: true }, syncEvent: { type: 'reset' } };
    }

    case 'clearAll': {
      ensureInit();
      await executeExec('DELETE FROM edges');
      await executeExec('DELETE FROM nodes');
      await executeExec('DELETE FROM chat_messages');
      await executeExec('DELETE FROM chat_sessions');
      return { result: { success: true }, syncEvent: { type: 'reset' } };
    }

    case 'exec': {
      ensureInit();
      const p = params as { sql: string; params?: unknown[] };
      const { changes } = await executeExec(p.sql, p.params);
      return { result: { changes } };
    }

    case 'query': {
      ensureInit();
      const p = params as { sql: string; params?: unknown[] };
      const { rows } = await executeQuery(p.sql, p.params);
      return { result: { rows } };
    }

    // Bulk graph load — single round-trip, slim columns
    case 'loadGraph': {
      ensureInit();
      const [nodes, edges] = await Promise.all([
        nodeQueries.getAllNodesSlim(),
        edgeQueries.getAllEdgesSlim(),
      ]);
      return { result: { nodes, edges } };
    }

    // Node operations
    case 'nodes.getAll': {
      ensureInit();
      return { result: await nodeQueries.getAllNodes() };
    }

    case 'nodes.getById': {
      ensureInit();
      return { result: await nodeQueries.getNodeById(params as string) };
    }

    case 'nodes.create': {
      ensureInit();
      const node = await nodeQueries.createNode(params as any);
      return { result: node, syncEvent: { type: 'node_created', node } };
    }

    case 'nodes.update': {
      ensureInit();
      const node = await nodeQueries.updateNode(params as any);
      return { result: node, syncEvent: node ? { type: 'node_updated', node } : undefined };
    }

    case 'nodes.delete': {
      ensureInit();
      const success = await nodeQueries.deleteNode(params as string);
      return {
        result: success,
        syncEvent: success ? { type: 'node_deleted', id: params as string } : undefined,
      };
    }

    case 'nodes.search': {
      ensureInit();
      const p = params as { query: string; limit?: number };
      return { result: await nodeQueries.searchNodes(p.query, p.limit) };
    }

    case 'nodes.getTypes': {
      ensureInit();
      return { result: await nodeQueries.getNodeTypes() };
    }

    case 'nodes.matchTerms': {
      ensureInit();
      const p = params as { terms: string[]; limit?: number };
      return { result: await nodeQueries.matchTerms(p.terms, p.limit) };
    }

    case 'nodes.getNeighborhood': {
      ensureInit();
      const p = params as { nodeId: string; hops?: number };
      return { result: await nodeQueries.getNeighborhood(p.nodeId, p.hops) };
    }

    // Edge operations
    case 'edges.getAll': {
      ensureInit();
      return { result: await edgeQueries.getAllEdges() };
    }

    case 'edges.getById': {
      ensureInit();
      return { result: await edgeQueries.getEdgeById(params as string) };
    }

    case 'edges.getForNode': {
      ensureInit();
      return { result: await edgeQueries.getEdgesForNode(params as string) };
    }

    case 'edges.create': {
      ensureInit();
      const edge = await edgeQueries.createEdge(params as any);
      return { result: edge, syncEvent: { type: 'edge_created', edge } };
    }

    case 'edges.update': {
      ensureInit();
      const edge = await edgeQueries.updateEdge(params as any);
      return { result: edge, syncEvent: edge ? { type: 'edge_updated', edge } : undefined };
    }

    case 'edges.delete': {
      ensureInit();
      const success = await edgeQueries.deleteEdge(params as string);
      return {
        result: success,
        syncEvent: success ? { type: 'edge_deleted', id: params as string } : undefined,
      };
    }

    case 'edges.getTypes': {
      ensureInit();
      return { result: await edgeQueries.getEdgeTypes() };
    }

    case 'edges.getBetween': {
      ensureInit();
      return { result: await edgeQueries.getEdgesBetween(params as string[]) };
    }

    case 'edges.search': {
      ensureInit();
      const p = params as { query: string; limit?: number };
      return { result: await edgeQueries.searchEdges(p.query, p.limit) };
    }

    // Node type operations
    case 'nodeTypes.getAll': {
      ensureInit();
      return { result: await nodeTypeQueries.getAllNodeTypes() };
    }

    case 'nodeTypes.create': {
      ensureInit();
      const nodeType = await nodeTypeQueries.createNodeType(params as any);
      return { result: nodeType, syncEvent: { type: 'node_type_created', nodeType } };
    }

    case 'nodeTypes.delete': {
      ensureInit();
      const success = await nodeTypeQueries.deleteNodeType(params as string);
      return {
        result: success,
        syncEvent: success ? { type: 'node_type_deleted', nodeTypeId: params as string } : undefined,
      };
    }

    // Source content operations
    case 'sourceContent.save': {
      ensureInit();
      return { result: await sourceContentQueries.saveSourceContent(params as any) };
    }

    case 'sourceContent.getByNodeId': {
      ensureInit();
      return { result: await sourceContentQueries.getByNodeId(params as string) };
    }

    case 'sourceContent.getByUrl': {
      ensureInit();
      return { result: await sourceContentQueries.getByUrl(params as string) };
    }

    case 'sourceContent.search': {
      ensureInit();
      const p = params as { query: string; limit?: number };
      return { result: await sourceContentQueries.searchContent(p.query, p.limit) };
    }

    case 'sourceContent.delete': {
      ensureInit();
      return { result: await sourceContentQueries.deleteByNodeId(params as string) };
    }

    case 'sourceContent.getAll': {
      ensureInit();
      return { result: await sourceContentQueries.getAllSourceContent() };
    }

    // Entity resolution operations
    case 'entityResolution.findMatches': {
      ensureInit();
      const p = params as { name: string; fuzzyThreshold?: number };
      return { result: await entityResolutionQueries.findMatches(p.name, p.fuzzyThreshold) };
    }

    case 'entityResolution.addAlias': {
      ensureInit();
      const p = params as { nodeId: string; alias: string };
      return { result: await entityResolutionQueries.addAlias(p.nodeId, p.alias) };
    }

    case 'entityResolution.getAliases': {
      ensureInit();
      return { result: await entityResolutionQueries.getAliases(params as string) };
    }

    case 'entityResolution.removeAlias': {
      ensureInit();
      return { result: await entityResolutionQueries.removeAlias(params as string) };
    }

    // Tag operations
    case 'tags.getForNode': {
      ensureInit();
      return { result: await tagQueries.getTagsForNode(params as string) };
    }
    case 'tags.setForNode': {
      ensureInit();
      const p = params as { nodeId: string; tags: string[] };
      await tagQueries.setTagsForNode(p.nodeId, p.tags);
      return { result: { success: true } };
    }
    case 'tags.getAllTags': {
      ensureInit();
      return { result: await tagQueries.getAllTags() };
    }

    // Entity source operations (entity_sources table — denormalized provenance cache)
    case 'entitySources.getForEntity': {
      ensureInit();
      return { result: await entitySourceQueries.getSourcesForEntity(params as string) };
    }
    case 'entitySources.add': {
      ensureInit();
      const p = params as {
        entityId: string;
        resourceId: string;
        relationType?: 'about' | 'mention';
      };
      await entitySourceQueries.addEntitySource(p.entityId, p.resourceId, p.relationType);
      return { result: { success: true } };
    }
    case 'entitySources.remove': {
      ensureInit();
      const p = params as {
        entityId: string;
        resourceId: string;
        relationType?: 'about' | 'mention';
      };
      return {
        result: await entitySourceQueries.removeEntitySource(p.entityId, p.resourceId, p.relationType),
      };
    }
    case 'entitySources.removeAllForResource': {
      ensureInit();
      return { result: await entitySourceQueries.removeAllForResource(params as string) };
    }
    case 'entitySources.getEntitiesForResource': {
      ensureInit();
      return { result: await entitySourceQueries.getEntitiesForResource(params as string) };
    }

    // Edge source operations (edge_sources table — provenance tracking)
    case 'edgeSources.add': {
      ensureInit();
      await edgeSourceQueries.addEdgeSource(params as any);
      return { result: { success: true } };
    }
    case 'edgeSources.getForEdge': {
      ensureInit();
      return { result: await edgeSourceQueries.getSourcesForEdge(params as string) };
    }
    case 'edgeSources.removeForNote': {
      ensureInit();
      return { result: await edgeSourceQueries.removeSourcesForNote(params as string) };
    }
    case 'edgeSources.getEdgesFromNote': {
      ensureInit();
      return { result: await edgeSourceQueries.getEdgesFromNote(params as string) };
    }

    // Note folder operations (S3-style hierarchy for note organization)
    case 'noteFolders.getAll': {
      ensureInit();
      return { result: await noteFolderQueries.getAllFolders() };
    }
    case 'noteFolders.create': {
      ensureInit();
      await noteFolderQueries.createFolder(params as string);
      return { result: { success: true } };
    }
    case 'noteFolders.rename': {
      ensureInit();
      const p = params as { oldPath: string; newPath: string };
      await noteFolderQueries.renameFolder(p.oldPath, p.newPath);
      return { result: { success: true } };
    }
    case 'noteFolders.delete': {
      ensureInit();
      await noteFolderQueries.deleteFolder(params as string);
      return { result: { success: true } };
    }
    case 'noteFolders.moveNote': {
      ensureInit();
      const p = params as { nodeId: string; folderPath: string };
      await noteFolderQueries.moveNote(p.nodeId, p.folderPath);
      return { result: { success: true } };
    }
    case 'noteFolders.getNotesInFolder': {
      ensureInit();
      return { result: await noteFolderQueries.getNotesInFolder(params as string) };
    }
    case 'noteFolders.getNotesRecursive': {
      ensureInit();
      return { result: await noteFolderQueries.getNotesRecursive(params as string) };
    }

    // Indexed file operations
    case 'indexedFiles.save': {
      ensureInit();
      return { result: await indexedFileQueries.saveIndexedFile(params as any) };
    }

    case 'indexedFiles.getByPath': {
      ensureInit();
      return { result: await indexedFileQueries.getByPath(params as string) };
    }

    case 'indexedFiles.getAll': {
      ensureInit();
      return { result: await indexedFileQueries.getAllIndexedFiles() };
    }

    case 'indexedFiles.delete': {
      ensureInit();
      return { result: await indexedFileQueries.deleteByPath(params as string) };
    }

    case 'indexedFiles.deleteByNodeId': {
      ensureInit();
      return { result: await indexedFileQueries.deleteByNodeId(params as string) };
    }

    case 'indexedFiles.getByNodeId': {
      ensureInit();
      return { result: await indexedFileQueries.getByNodeId(params as string) };
    }

    // Spatial queries
    case 'spatial.nodesInBounds': {
      ensureInit();
      const p = params as { minX: number; minY: number; maxX: number; maxY: number; limit?: number };
      return { result: await spatialQueries.getNodesInBounds(p.minX, p.minY, p.maxX, p.maxY, p.limit) };
    }

    case 'spatial.edgesForNodes': {
      ensureInit();
      return { result: await spatialQueries.getEdgesForVisibleNodes(params as string[]) };
    }

    case 'spatial.clusterSummary': {
      ensureInit();
      return { result: await spatialQueries.getClusterSummary() };
    }

    case 'spatial.interClusterEdges': {
      ensureInit();
      return { result: await spatialQueries.getInterClusterEdges() };
    }

    case 'spatial.batchUpdatePositions': {
      ensureInit();
      await spatialQueries.batchUpdatePositions(params as Array<{ id: string; x: number; y: number }>);
      return { result: { success: true } };
    }

    case 'spatial.nodeCountInBounds': {
      ensureInit();
      const p = params as { minX: number; minY: number; maxX: number; maxY: number };
      return { result: await spatialQueries.getNodeCountInBounds(p.minX, p.minY, p.maxX, p.maxY) };
    }

    case 'spatial.totalNodeCount': {
      ensureInit();
      return { result: await spatialQueries.getTotalNodeCount() };
    }

    // Reading list history operations
    case 'readingList.save': {
      ensureInit();
      return { result: await readingListQueries.saveHistory(params as any) };
    }

    case 'readingList.getAll': {
      ensureInit();
      return { result: await readingListQueries.getAll() };
    }

    case 'readingList.getByUrl': {
      ensureInit();
      return { result: await readingListQueries.getByUrl(params as string) };
    }

    case 'readingList.getRecent': {
      ensureInit();
      return { result: await readingListQueries.getRecent(params as number) };
    }

    // Stress test
    case 'stressTest.generate': {
      ensureInit();
      const p = params as { nodeCount: number };
      const result = await stressTestQueries.generateStressTestData(p.nodeCount);
      return { result, syncEvent: { type: 'reset' } };
    }

    // Query engine operations
    case 'query.execute': {
      ensureInit();
      return { result: await executeGraphQuery(params) };
    }

    case 'mutation.execute': {
      ensureInit();
      return { result: await executeGraphMutation(params) };
    }

    // Chat session operations
    case 'chat.getActiveSession': {
      ensureInit();
      return { result: await chatQueries.getActiveSession() };
    }
    case 'chat.createSession': {
      ensureInit();
      const p = params as { id: string; title: string };
      return { result: await chatQueries.createSession(p.id, p.title) };
    }
    case 'chat.expireSession': {
      ensureInit();
      await chatQueries.expireSession(params as string);
      return { result: { success: true } };
    }
    case 'chat.expireStale': {
      ensureInit();
      await chatQueries.expireAllStaleSessions();
      return { result: { success: true } };
    }
    case 'chat.touchSession': {
      ensureInit();
      await chatQueries.touchSession(params as string);
      return { result: { success: true } };
    }
    case 'chat.pruneSessions': {
      ensureInit();
      await chatQueries.pruneSessions();
      return { result: { success: true } };
    }
    case 'chat.saveMessage': {
      ensureInit();
      return { result: await chatQueries.saveMessage(params as any) };
    }
    case 'chat.getMessages': {
      ensureInit();
      return { result: await chatQueries.getSessionMessages(params as string) };
    }
    case 'chat.getAllSessions': {
      ensureInit();
      return { result: await chatQueries.getAllSessions() };
    }
    case 'chat.getRecentMessages': {
      ensureInit();
      const p = params as { sessionId: string; limit?: number };
      return { result: await chatQueries.getRecentMessages(p.sessionId, p.limit) };
    }

    // Note attachment operations
    case 'noteAttachments.create': {
      ensureInit();
      const p = params as { noteId: string; filename: string; mimeType: string; data: Uint8Array };
      return { result: await noteAttachmentQueries.createAttachment(p.noteId, p.filename, p.mimeType, p.data) };
    }
    case 'noteAttachments.get': {
      ensureInit();
      return { result: await noteAttachmentQueries.getAttachment(params as string) };
    }
    case 'noteAttachments.getForNote': {
      ensureInit();
      return { result: await noteAttachmentQueries.getAttachmentsForNote(params as string) };
    }
    case 'noteAttachments.delete': {
      ensureInit();
      return { result: await noteAttachmentQueries.deleteAttachment(params as string) };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

let messageTarget: { postMessage: (msg: any) => void } = self;

async function handleMessage(event: MessageEvent<WorkerRequest>) {
  const { requestId, action, params } = event.data;

  try {
    const outcome = await handleAction(action, params);

    const response: WorkerResponse = {
      requestId,
      success: true,
      data: outcome.result,
      syncEvent: outcome.syncEvent,
    };
    messageTarget.postMessage(response);
  } catch (error: any) {
    console.error(`[DB Worker] Error handling ${action}:`, error);
    const response: WorkerResponse = {
      requestId,
      success: false,
      error: error.message ?? String(error),
    };
    messageTarget.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent) => {
  // Check for coordinator port attachment
  if (event.data?.action === '__attach_port__' && event.ports?.length > 0) {
    const coordinatorPort = event.ports[0];
    messageTarget = coordinatorPort;
    coordinatorPort.onmessage = handleMessage;
    coordinatorPort.start();
    console.log('[DB Worker] Coordinator port attached');
    return;
  }

  // Default: handle as normal request
  handleMessage(event);
};

// Signal that the worker script has loaded
self.postMessage({ requestId: '__init__', success: true, data: 'worker-loaded' });
