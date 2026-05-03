import { useEffect } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useUIStore } from '../../graph/store/ui-store';
import { browser } from '@platform';
import { readingList } from '../../db/client/db-client';

export function useCompanionCapture() {
  useEffect(() => {
    const cleanupCapture = browser.onPageCapture((data) => {
      console.log(`[Companion] Received page capture: ${data.url} (${data.content.length} chars)`);
      useLLMStore.getState().setPendingCapture({ url: data.url, content: data.content });
      useUIStore.getState().forceActivePanel('llm');
    });

    const cleanupQueue = browser.onReadingQueue((data) => {
      console.log(`[Companion] Reading queue add: ${data.url}`);
      readingList.save({
        url: data.url,
        title: data.title,
        summary: '',
        keyTopics: [],
        nodeIds: [],
      }).catch((e) => console.error('[Companion] Failed to save to reading queue:', e));
    });

    return () => {
      cleanupCapture();
      cleanupQueue();
    };
  }, []);
}
