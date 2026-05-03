import type { DataStore } from '../data-store';
import type { SyncEvent } from '../../shared/sync-events';

export type ActionResult = { result: unknown; syncEvent?: SyncEvent };

export function createActionHandler(dataStore: DataStore) {
  let isInitialized = false;

  function ensureInit(): void {
    if (!isInitialized) {
      throw new Error('Database not initialized. Call init first.');
    }
  }

  return async function handleAction(action: string, params: unknown): Promise<ActionResult> {
    switch (action) {
      case 'init': {
        if (!isInitialized) {
          await dataStore.init();
          isInitialized = true;
        }
        return { result: { ready: true } };
      }

      case 'ping': {
        return { result: { alive: true } };
      }

      case 'reset': {
        await dataStore.reset();
        isInitialized = true;
        return { result: { ready: true }, syncEvent: { type: 'reset' } };
      }

      case 'clearAll': {
        ensureInit();
        await dataStore.clearAll();
        return { result: { success: true }, syncEvent: { type: 'reset' } };
      }

      case 'exec': {
        ensureInit();
        const p = params as { sql: string; params?: unknown[] };
        const changes = await dataStore.rawExec(p.sql, p.params);
        return { result: { changes } };
      }

      case 'query': {
        ensureInit();
        const p = params as { sql: string; params?: unknown[] };
        const rows = await dataStore.rawQuery(p.sql, p.params);
        return { result: { rows } };
      }

      // Bulk graph load — single round-trip, slim columns
      case 'loadGraph': {
        ensureInit();
        const { nodes, edges } = await dataStore.loadGraph();
        return { result: { nodes, edges } };
      }

      // Node operations
      case 'nodes.getAll': {
        ensureInit();
        return { result: await dataStore.nodes.getAll() };
      }

      case 'nodes.getById': {
        ensureInit();
        return { result: await dataStore.nodes.getById(params as string) };
      }

      case 'nodes.create': {
        ensureInit();
        const node = await dataStore.nodes.create(params as any);
        return { result: node, syncEvent: { type: 'node_created', node } };
      }

      case 'nodes.update': {
        ensureInit();
        const node = await dataStore.nodes.update(params as any);
        return { result: node, syncEvent: node ? { type: 'node_updated', node } : undefined };
      }

      case 'nodes.delete': {
        ensureInit();
        const success = await dataStore.nodes.delete(params as string);
        return {
          result: success,
          syncEvent: success ? { type: 'node_deleted', id: params as string } : undefined,
        };
      }

      case 'nodes.search': {
        ensureInit();
        const p = params as { query: string; limit?: number };
        return { result: await dataStore.nodes.search(p.query, p.limit) };
      }

      case 'nodes.getTypes': {
        ensureInit();
        return { result: await dataStore.nodes.getTypes() };
      }

      case 'nodes.matchTerms': {
        ensureInit();
        const p = params as { terms: string[]; limit?: number };
        return { result: await dataStore.nodes.matchTerms(p.terms, p.limit) };
      }

      case 'nodes.getNeighborhood': {
        ensureInit();
        const p = params as { nodeId: string; hops?: number };
        return { result: await dataStore.nodes.getNeighborhood(p.nodeId, p.hops) };
      }

      // Edge operations
      case 'edges.getAll': {
        ensureInit();
        return { result: await dataStore.edges.getAll() };
      }

      case 'edges.getById': {
        ensureInit();
        return { result: await dataStore.edges.getById(params as string) };
      }

      case 'edges.getForNode': {
        ensureInit();
        return { result: await dataStore.edges.getForNode(params as string) };
      }

      case 'edges.create': {
        ensureInit();
        const edge = await dataStore.edges.create(params as any);
        return { result: edge, syncEvent: { type: 'edge_created', edge } };
      }

      case 'edges.update': {
        ensureInit();
        const edge = await dataStore.edges.update(params as any);
        return { result: edge, syncEvent: edge ? { type: 'edge_updated', edge } : undefined };
      }

      case 'edges.delete': {
        ensureInit();
        const success = await dataStore.edges.delete(params as string);
        return {
          result: success,
          syncEvent: success ? { type: 'edge_deleted', id: params as string } : undefined,
        };
      }

      case 'edges.getTypes': {
        ensureInit();
        return { result: await dataStore.edges.getTypes() };
      }

      case 'edges.getBetween': {
        ensureInit();
        return { result: await dataStore.edges.getBetween(params as string[]) };
      }

      case 'edges.search': {
        ensureInit();
        const p = params as { query: string; limit?: number };
        return { result: await dataStore.edges.search(p.query, p.limit) };
      }

      // Node type operations
      case 'nodeTypes.getAll': {
        ensureInit();
        return { result: await dataStore.nodeTypes.getAll() };
      }

      case 'nodeTypes.create': {
        ensureInit();
        const nodeType = await dataStore.nodeTypes.create(params as any);
        return { result: nodeType, syncEvent: { type: 'node_type_created', nodeType } };
      }

      case 'nodeTypes.delete': {
        ensureInit();
        const success = await dataStore.nodeTypes.delete(params as string);
        return {
          result: success,
          syncEvent: success ? { type: 'node_type_deleted', nodeTypeId: params as string } : undefined,
        };
      }

      // Source content operations
      case 'sourceContent.save': {
        ensureInit();
        return { result: await dataStore.sourceContent.save(params as any) };
      }

      case 'sourceContent.getByNodeId': {
        ensureInit();
        return { result: await dataStore.sourceContent.getByNodeId(params as string) };
      }

      case 'sourceContent.getByUrl': {
        ensureInit();
        return { result: await dataStore.sourceContent.getByUrl(params as string) };
      }

      case 'sourceContent.search': {
        ensureInit();
        const p = params as { query: string; limit?: number };
        return { result: await dataStore.sourceContent.search(p.query, p.limit) };
      }

      case 'sourceContent.delete': {
        ensureInit();
        return { result: await dataStore.sourceContent.deleteByNodeId(params as string) };
      }

      case 'sourceContent.getAll': {
        ensureInit();
        return { result: await dataStore.sourceContent.getAll() };
      }

      // Entity resolution operations
      case 'entityResolution.findMatches': {
        ensureInit();
        const p = params as { name: string; fuzzyThreshold?: number };
        return { result: await dataStore.entityResolution.findMatches(p.name, p.fuzzyThreshold) };
      }

      case 'entityResolution.addAlias': {
        ensureInit();
        const p = params as { nodeId: string; alias: string };
        return { result: await dataStore.entityResolution.addAlias(p.nodeId, p.alias) };
      }

      case 'entityResolution.getAliases': {
        ensureInit();
        return { result: await dataStore.entityResolution.getAliases(params as string) };
      }

      case 'entityResolution.removeAlias': {
        ensureInit();
        return { result: await dataStore.entityResolution.removeAlias(params as string) };
      }

      // Tag operations
      case 'tags.getForNode': {
        ensureInit();
        return { result: await dataStore.tags.getForNode(params as string) };
      }
      case 'tags.setForNode': {
        ensureInit();
        const p = params as { nodeId: string; tags: string[] };
        await dataStore.tags.setForNode(p.nodeId, p.tags);
        return { result: { success: true } };
      }
      case 'tags.getAllTags': {
        ensureInit();
        return { result: await dataStore.tags.getAllTags() };
      }

      // Entity source operations (entity_sources table — denormalized provenance cache)
      case 'entitySources.getForEntity': {
        ensureInit();
        return { result: await dataStore.entitySources.getForEntity(params as string) };
      }
      case 'entitySources.add': {
        ensureInit();
        const p = params as {
          entityId: string;
          resourceId: string;
          relationType?: 'about' | 'mention';
        };
        await dataStore.entitySources.add(p.entityId, p.resourceId, p.relationType);
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
          result: await dataStore.entitySources.remove(p.entityId, p.resourceId, p.relationType),
        };
      }
      case 'entitySources.removeAllForResource': {
        ensureInit();
        return { result: await dataStore.entitySources.removeAllForResource(params as string) };
      }
      case 'entitySources.getEntitiesForResource': {
        ensureInit();
        return { result: await dataStore.entitySources.getEntitiesForResource(params as string) };
      }

      // Edge source operations (edge_sources table — provenance tracking)
      case 'edgeSources.add': {
        ensureInit();
        await dataStore.edgeSources.add(params as any);
        return { result: { success: true } };
      }
      case 'edgeSources.getForEdge': {
        ensureInit();
        return { result: await dataStore.edgeSources.getForEdge(params as string) };
      }
      case 'edgeSources.removeForNote': {
        ensureInit();
        return { result: await dataStore.edgeSources.removeForNote(params as string) };
      }
      case 'edgeSources.getEdgesFromNote': {
        ensureInit();
        return { result: await dataStore.edgeSources.getEdgesFromNote(params as string) };
      }

      // Note folder operations (S3-style hierarchy for note organization)
      case 'noteFolders.getAll': {
        ensureInit();
        return { result: await dataStore.noteFolders.getAll() };
      }
      case 'noteFolders.create': {
        ensureInit();
        await dataStore.noteFolders.create(params as string);
        return { result: { success: true } };
      }
      case 'noteFolders.rename': {
        ensureInit();
        const p = params as { oldPath: string; newPath: string };
        await dataStore.noteFolders.rename(p.oldPath, p.newPath);
        return { result: { success: true } };
      }
      case 'noteFolders.delete': {
        ensureInit();
        await dataStore.noteFolders.delete(params as string);
        return { result: { success: true } };
      }
      case 'noteFolders.moveNote': {
        ensureInit();
        const p = params as { nodeId: string; folderPath: string };
        await dataStore.noteFolders.moveNote(p.nodeId, p.folderPath);
        return { result: { success: true } };
      }
      case 'noteFolders.getNotesInFolder': {
        ensureInit();
        return { result: await dataStore.noteFolders.getNotesInFolder(params as string) };
      }
      case 'noteFolders.getNotesRecursive': {
        ensureInit();
        return { result: await dataStore.noteFolders.getNotesRecursive(params as string) };
      }

      // Indexed file operations
      case 'indexedFiles.save': {
        ensureInit();
        return { result: await dataStore.indexedFiles.save(params as any) };
      }

      case 'indexedFiles.getByPath': {
        ensureInit();
        return { result: await dataStore.indexedFiles.getByPath(params as string) };
      }

      case 'indexedFiles.getAll': {
        ensureInit();
        return { result: await dataStore.indexedFiles.getAll() };
      }

      case 'indexedFiles.delete': {
        ensureInit();
        return { result: await dataStore.indexedFiles.deleteByPath(params as string) };
      }

      case 'indexedFiles.deleteByNodeId': {
        ensureInit();
        return { result: await dataStore.indexedFiles.deleteByNodeId(params as string) };
      }

      case 'indexedFiles.getByNodeId': {
        ensureInit();
        return { result: await dataStore.indexedFiles.getByNodeId(params as string) };
      }

      // Spatial queries
      case 'spatial.nodesInBounds': {
        ensureInit();
        const p = params as { minX: number; minY: number; maxX: number; maxY: number; limit?: number };
        return { result: await dataStore.spatial.nodesInBounds(p.minX, p.minY, p.maxX, p.maxY, p.limit) };
      }

      case 'spatial.edgesForNodes': {
        ensureInit();
        return { result: await dataStore.spatial.edgesForNodes(params as string[]) };
      }

      case 'spatial.clusterSummary': {
        ensureInit();
        return { result: await dataStore.spatial.clusterSummary() };
      }

      case 'spatial.interClusterEdges': {
        ensureInit();
        return { result: await dataStore.spatial.interClusterEdges() };
      }

      case 'spatial.batchUpdatePositions': {
        ensureInit();
        await dataStore.spatial.batchUpdatePositions(params as Array<{ id: string; x: number; y: number }>);
        return { result: { success: true } };
      }

      case 'spatial.nodeCountInBounds': {
        ensureInit();
        const p = params as { minX: number; minY: number; maxX: number; maxY: number };
        return { result: await dataStore.spatial.nodeCountInBounds(p.minX, p.minY, p.maxX, p.maxY) };
      }

      case 'spatial.totalNodeCount': {
        ensureInit();
        return { result: await dataStore.spatial.totalNodeCount() };
      }

      // Reading list history operations
      case 'readingList.save': {
        ensureInit();
        return { result: await dataStore.readingList.save(params as any) };
      }

      case 'readingList.getAll': {
        ensureInit();
        return { result: await dataStore.readingList.getAll() };
      }

      case 'readingList.getByUrl': {
        ensureInit();
        return { result: await dataStore.readingList.getByUrl(params as string) };
      }

      case 'readingList.getRecent': {
        ensureInit();
        return { result: await dataStore.readingList.getRecent(params as number) };
      }

      // Stress test
      case 'stressTest.generate': {
        ensureInit();
        const p = params as { nodeCount: number };
        const result = await dataStore.stressTest.generate(p.nodeCount);
        return { result, syncEvent: { type: 'reset' } };
      }

      // Query engine operations
      case 'query.execute': {
        ensureInit();
        return { result: await dataStore.graphQuery(params) };
      }

      case 'mutation.execute': {
        ensureInit();
        return { result: await dataStore.graphMutate(params) };
      }

      // Chat session operations
      case 'chat.getActiveSession': {
        ensureInit();
        return { result: await dataStore.chat.getActiveSession() };
      }
      case 'chat.createSession': {
        ensureInit();
        const p = params as { id: string; title: string };
        return { result: await dataStore.chat.createSession(p.id, p.title) };
      }
      case 'chat.expireSession': {
        ensureInit();
        await dataStore.chat.expireSession(params as string);
        return { result: { success: true } };
      }
      case 'chat.expireStale': {
        ensureInit();
        await dataStore.chat.expireStale();
        return { result: { success: true } };
      }
      case 'chat.touchSession': {
        ensureInit();
        await dataStore.chat.touchSession(params as string);
        return { result: { success: true } };
      }
      case 'chat.pruneSessions': {
        ensureInit();
        await dataStore.chat.pruneSessions();
        return { result: { success: true } };
      }
      case 'chat.saveMessage': {
        ensureInit();
        return { result: await dataStore.chat.saveMessage(params as any) };
      }
      case 'chat.getMessages': {
        ensureInit();
        return { result: await dataStore.chat.getMessages(params as string) };
      }
      case 'chat.getAllSessions': {
        ensureInit();
        return { result: await dataStore.chat.getAllSessions() };
      }
      case 'chat.getRecentMessages': {
        ensureInit();
        const p = params as { sessionId: string; limit?: number };
        return { result: await dataStore.chat.getRecentMessages(p.sessionId, p.limit) };
      }

      // Note attachment operations
      case 'noteAttachments.create': {
        ensureInit();
        const p = params as { noteId: string; filename: string; mimeType: string; data: Uint8Array };
        return { result: await dataStore.noteAttachments.create(p.noteId, p.filename, p.mimeType, p.data) };
      }
      case 'noteAttachments.get': {
        ensureInit();
        return { result: await dataStore.noteAttachments.get(params as string) };
      }
      case 'noteAttachments.getForNote': {
        ensureInit();
        return { result: await dataStore.noteAttachments.getForNote(params as string) };
      }
      case 'noteAttachments.delete': {
        ensureInit();
        return { result: await dataStore.noteAttachments.delete(params as string) };
      }

      // --- Note search (OPFS FTS5 index) ---
      case 'noteSearch.upsert': {
        ensureInit();
        const { nodeId, title, body } = params as { nodeId: string; title: string; body: string };
        await dataStore.noteSearch.upsert(nodeId, title, body);
        return { result: { success: true } };
      }
      case 'noteSearch.delete': {
        ensureInit();
        return { result: await dataStore.noteSearch.delete(params as string) };
      }
      case 'noteSearch.search': {
        ensureInit();
        const { query, limit } = params as { query: string; limit?: number };
        return { result: await dataStore.noteSearch.search(query, limit) };
      }
      case 'noteSearch.getEntry': {
        ensureInit();
        return { result: await dataStore.noteSearch.getEntry(params as string) };
      }
      case 'noteSearch.getAll': {
        ensureInit();
        return { result: await dataStore.noteSearch.getAll() };
      }

      // Memory operations (episodic only — semantic memory is file-based)
      case 'memory.addEpisodic':
        ensureInit();
        return { result: await dataStore.memory.addEpisodic(params as any) };
      case 'memory.getRecentEpisodic':
        ensureInit();
        return { result: await dataStore.memory.getRecentEpisodic((params as any)?.limit) };
      case 'memory.clearAllEpisodic':
        ensureInit();
        return { result: await dataStore.memory.clearAllEpisodic() };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  };
}
