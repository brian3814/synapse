import { useState, useCallback } from 'react';
import type { DisplayMode } from '../../shared/types';
import { DISPLAY_MODE_STORAGE_KEY } from '../../shared/constants';
import { storage, db, browser, platformId } from '@platform';

function getDisplayMode(): DisplayMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'tab' || mode === 'sidePanel') return mode;
  return platformId === 'electron' ? 'tab' : 'sidePanel';
}

export function useDisplayMode() {
  const [displayMode] = useState<DisplayMode>(getDisplayMode);

  const toggleMode = useCallback(async () => {
    const newMode: DisplayMode =
      displayMode === 'sidePanel' ? 'tab' : 'sidePanel';

    // Persist preference
    try {
      await storage.set({ [DISPLAY_MODE_STORAGE_KEY]: newMode });
    } catch (e) {
      // Not in extension context
    }

    // Ask service worker to open the new view, then close this one
    try {
      await (browser as any).toggleDisplayMode(displayMode);
      // Tell SharedWorker the DedicatedWorker is about to die so surviving
      // tabs can spawn a replacement before requests start timing out.
      (db as any).notifyWorkerDying?.();
      // New view is open — close current view (side panel or tab)
      window.close();
    } catch (e) {
      // Not in extension context
    }
  }, [displayMode]);

  return { displayMode, toggleMode };
}
