import React, { useEffect } from 'react';
import { useDbInit } from '../db/client/db-hooks';
import { useGraphStore } from '../graph/store/graph-store';
import { useNodeTypeStore } from '../graph/store/node-type-store';
import { useUIStore } from '../graph/store/ui-store';
import { useReadingListStore } from '../graph/store/reading-list-store';
import { useDisplayMode } from './hooks/useDisplayMode';
import { registerQueryMessageHandler } from '../db/client/query-message-handler';
import { SidePanelLayout } from './layouts/SidePanelLayout';
import { TabLayout } from './layouts/TabLayout';

export default function App() {
  const { ready, error: dbError } = useDbInit();
  const { displayMode } = useDisplayMode();
  const loadAll = useGraphStore((s) => s.loadAll);
  const startSyncListener = useGraphStore((s) => s.startSyncListener);
  const loadTypes = useNodeTypeStore((s) => s.loadTypes);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);

  useEffect(() => {
    setDisplayMode(displayMode);
  }, [displayMode, setDisplayMode]);

  // Initialize reading list store (loads from chrome.storage.local, independent of DB)
  useEffect(() => {
    useReadingListStore.getState().loadFromStorage();
    const cleanup = useReadingListStore.getState().startSyncListener();
    return cleanup;
  }, []);

  useEffect(() => {
    if (ready) {
      loadAll();
      loadTypes();
      const cleanupSync = startSyncListener();
      const cleanupQuery = registerQueryMessageHandler();
      return () => {
        cleanupSync();
        cleanupQuery();
      };
    }
  }, [ready, loadAll, loadTypes, startSyncListener]);

  if (dbError) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <p className="text-red-400 text-lg font-medium">Database Error</p>
          <p className="text-zinc-400 mt-2 text-sm">{dbError}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 mt-3 text-sm">Initializing database...</p>
        </div>
      </div>
    );
  }

  return displayMode === 'sidePanel' ? <SidePanelLayout /> : <TabLayout />;
}
