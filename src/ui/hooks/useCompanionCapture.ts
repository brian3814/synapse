import { useEffect } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useUIStore } from '../../graph/store/ui-store';
import { browser } from '@platform';

export function useCompanionCapture() {
  useEffect(() => {
    const cleanup = browser.onPageCapture((data) => {
      console.log(`[Companion] Received page capture: ${data.url} (${data.content.length} chars)`);
      useLLMStore.getState().setPendingCapture({ url: data.url, content: data.content });
      useUIStore.getState().forceActivePanel('llm');
    });

    return cleanup;
  }, []);
}
