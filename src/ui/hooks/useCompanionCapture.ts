import { useEffect } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';

export function useCompanionCapture() {
  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === 'COMPANION_PAGE_CAPTURED') {
        const { url, content } = message.payload;
        const llm = useLLMStore.getState();
        llm.setInputText(content);
        llm.setSourceUrl(url);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}
