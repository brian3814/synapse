import { useCallback, useEffect, useState } from 'react';
import { useDbInit } from '../db/client/db-hooks';
import { useGraphStore } from '../graph/store/graph-store';
import { useNodeTypeStore } from '../graph/store/node-type-store';
import { useUIStore } from '../graph/store/ui-store';
import { useReadingListStore } from '../graph/store/reading-list-store';
import { useAuthStore } from '../graph/store/auth-store';
import { useDisplayMode } from './hooks/useDisplayMode';
import { useCompanionCapture } from './hooks/useCompanionCapture';
import { useLLMExtraction } from './hooks/useLLMExtraction';
import { useLLMStore } from '../graph/store/llm-store';
import { registerQueryMessageHandler } from '../db/client/query-message-handler';
import { SidePanelLayout } from './layouts/SidePanelLayout';
import { TabLayout } from './layouts/TabLayout';
import { SettingsModal } from './components/settings/SettingsModal';
import { LLMModal } from './components/llm/LLMModal';
import { DropZone } from './components/ingestion/DropZone';
import { ProcessingModePrompt } from './components/ingestion/ProcessingModePrompt';
import { getProcessor } from '../ingestion/processor-factory';
import { createIngestionSourceFromFile } from '../ingestion/ingestion-pipeline';
import { platformId } from '@platform';
import { VaultSetupScreen } from './components/VaultSetupScreen';
import { useVaultStatus } from './hooks/useVaultStatus';
import type { IngestionSource, ProcessingMode, ModePromptResult } from '../ingestion/types';

export default function App() {
  const { vaultOpen, checking: vaultChecking, refresh: refreshVault } = useVaultStatus();

  // Gate: Electron requires vault setup before anything else
  if (platformId === 'electron' && vaultChecking) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-900">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (platformId === 'electron' && !vaultOpen) {
    return <VaultSetupScreen onVaultReady={refreshVault} />;
  }

  return <AppMain />;
}

function AppMain() {
  const { ready, error: dbError } = useDbInit();
  const { displayMode } = useDisplayMode();
  useCompanionCapture();
  const loadAll = useGraphStore((s) => s.loadAll);
  const startSyncListener = useGraphStore((s) => s.startSyncListener);
  const loadTypes = useNodeTypeStore((s) => s.loadTypes);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  // Ingestion state
  const { startIngestion } = useLLMExtraction();
  const [pendingSource, setPendingSource] = useState<IngestionSource | null>(null);
  const [modePromptInfo, setModePromptInfo] = useState<ModePromptResult | null>(null);

  const handleIngest = useCallback((source: IngestionSource, _mode: ProcessingMode) => {
    const processor = getProcessor(source);
    if (!processor) return;
    const modeCheck = processor.shouldPromptMode(source);
    if (modeCheck.prompt) {
      setPendingSource(source);
      setModePromptInfo(modeCheck);
    } else {
      startIngestion(source, 'full');
    }
  }, [startIngestion]);

  const handleModeSelect = useCallback((mode: ProcessingMode) => {
    if (pendingSource) {
      startIngestion(pendingSource, mode);
      setPendingSource(null);
      setModePromptInfo(null);
    }
  }, [pendingSource, startIngestion]);

  const handleModeCancel = useCallback(() => {
    setPendingSource(null);
    setModePromptInfo(null);
  }, []);

  // Clipboard paste handler — intercept pasted images for ingestion
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const source = await createIngestionSourceFromFile(file);
          handleIngest(source, 'full');
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleIngest]);

  useEffect(() => {
    setDisplayMode(displayMode);
  }, [displayMode, setDisplayMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('openSettings') === '1') {
      setSettingsOpen(true);
      params.delete('openSettings');
      const clean = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (clean ? '?' + clean : ''));
    }
  }, [setSettingsOpen]);

  // Initialize reading list store (loads from chrome.storage.local, independent of DB)
  useEffect(() => {
    useReadingListStore.getState().loadFromStorage();
    const cleanup = useReadingListStore.getState().startSyncListener();
    return cleanup;
  }, []);

  // Initialize auth store (check OAuth status, listen for changes)
  useEffect(() => {
    useAuthStore.getState().checkAuth();
    const cleanupAuth = useAuthStore.getState().startAuthListener();
    return cleanupAuth;
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

  useEffect(() => {
    const extractionStates = new Set(['extracting', 'agent-running']);
    return useLLMStore.subscribe((state, prev) => {
      if (extractionStates.has(state.status) && prev.status === 'idle') {
        useUIStore.getState().setLLMModalOpen(false);
        useUIStore.getState().openContentTab({ kind: 'extractionReview' }, 'Extraction');
      }
    });
  }, []);

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

  return (
    <>
      {displayMode === 'sidePanel' ? <SidePanelLayout onIngest={handleIngest} /> : <TabLayout onIngest={handleIngest} />}
      <SettingsModal />
      <LLMModal />
      <DropZone onIngest={handleIngest} />
      {pendingSource && modePromptInfo && (
        <ProcessingModePrompt
          filename={pendingSource.name}
          modeInfo={modePromptInfo}
          onSelect={handleModeSelect}
          onCancel={handleModeCancel}
        />
      )}
    </>
  );
}
