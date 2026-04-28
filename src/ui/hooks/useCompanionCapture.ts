import { useEffect } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useUIStore } from '../../graph/store/ui-store';

export function useCompanionCapture() {
  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === 'COMPANION_PAGE_CAPTURED') {
        const { url, content } = message.payload;
        console.log(`[Companion] Received page capture: ${url} (${content.length} chars)`);
        useLLMStore.getState().setPendingCapture({ url, content });
        useUIStore.getState().forceActivePanel('llm');
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}
