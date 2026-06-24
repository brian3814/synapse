import { useEffect } from 'react';
import { useReadingListStore } from '../../graph/store/reading-list-store';
import { browser, storage, platformId, vaultWorkspace } from '@platform';
import type { ReadingListResource } from '../../shared/reading-list-types';

export function useCompanionCapture() {
  useEffect(() => {
    const cleanupCapture = browser.onPageCapture(async (data) => {
      console.log(`[Companion] Received page capture: ${data.url} (${data.content.length} chars)`);
      const store = useReadingListStore.getState();
      await store.addResource(
        { kind: 'url', url: data.url },
        data.title,
        { prefetchedContent: data.content },
      );
      const id = data.url.trim();
      if (store.items[id] || useReadingListStore.getState().items[id]) {
        useReadingListStore.getState().retryResource(id);
      }
    });

    const cleanupQueue = browser.onReadingQueue(async (data) => {
      console.log(`[Companion] Reading queue add: ${data.url}`);
      try {
        const result = await storage.get('readingListItems') as Record<string, any>;
        const items: Record<string, ReadingListResource> = result.readingListItems ?? {};
        const vault = platformId === 'electron' ? await vaultWorkspace.getStatus() : null;
        items[data.url] = {
          id: data.url,
          source: { kind: 'url', url: data.url },
          title: data.title,
          addedAt: Date.now(),
          status: 'pending',
          targetVaultPath: vault?.path,
          targetVaultName: vault?.name,
        };
        await storage.set({ readingListItems: items });
        useReadingListStore.getState().loadFromStorage();
      } catch (e) {
        console.error('[Companion] Failed to save to reading queue:', e);
      }
    });

    return () => {
      cleanupCapture();
      cleanupQueue();
    };
  }, []);
}
