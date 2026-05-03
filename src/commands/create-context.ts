import * as dbClient from '../db/client/db-client';
import { storage, notes, llm, browser } from '@platform';
import { useGraphStore } from '../graph/store/graph-store';
import type { CommandContext } from './types';
import type { DataStore } from '../db/data-store';
import type { PlatformFiles } from '../platform/types';

function dbClientAsDataStore(): DataStore {
  return {
    init: () => dbClient.initDbClient(),
    reset: () => Promise.resolve(),
    nodes: dbClient.nodes as any,
    edges: dbClient.edges as any,
    nodeTypes: dbClient.nodeTypes as any,
    sourceContent: {
      ...dbClient.sourceContent,
      deleteByNodeId: dbClient.sourceContent.delete,
    } as any,
    entityResolution: dbClient.entityResolution as any,
    tags: dbClient.tags as any,
    noteFolders: dbClient.noteFolders as any,
    edgeSources: dbClient.edgeSources as any,
    entitySources: dbClient.entitySources as any,
    indexedFiles: dbClient.indexedFiles as any,
    spatial: dbClient.spatial as any,
    readingList: dbClient.readingList as any,
    chat: dbClient.chat as any,
    noteAttachments: dbClient.noteAttachments as any,
    noteSearch: dbClient.noteSearch as any,
    stressTest: dbClient.stressTest as any,
    memory: (dbClient as any).memory ?? ({} as any),
    loadGraph: dbClient.loadGraph as any,
    clearAll: dbClient.clearAll as any,
    graphQuery: (input: unknown) => dbClient.graph.query(input) as any,
    graphMutate: (input: unknown) => dbClient.graph.mutate(input) as any,
    rawQuery: dbClient.dbQuery as any,
    rawExec: dbClient.dbExec as any,
  };
}

const notImplementedFiles: PlatformFiles = {
  read: () => { throw new Error('PlatformFiles not implemented. Add Chrome/Electron implementation before using memoryCommands.'); },
  write: () => { throw new Error('PlatformFiles not implemented. Add Chrome/Electron implementation before using memoryCommands.'); },
  remove: () => { throw new Error('PlatformFiles not implemented. Add Chrome/Electron implementation before using memoryCommands.'); },
  list: () => { throw new Error('PlatformFiles not implemented. Add Chrome/Electron implementation before using memoryCommands.'); },
};

export function createUICommandContext(): CommandContext {
  return {
    db: dbClientAsDataStore(),
    storage,
    notes,
    files: notImplementedFiles,
    llm,
    browser,
    getGraphSnapshot: () => {
      const state = useGraphStore.getState();
      return Promise.resolve({ nodes: state.nodes, edges: state.edges });
    },
  };
}
