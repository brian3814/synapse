import { graph } from './db-client';
import { platformId } from '@platform';

export function registerQueryMessageHandler(): () => void {
  if (platformId !== 'chrome') return () => {};

  const listener = (
    message: { type: string; payload?: unknown },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (message.type === 'QUERY_EXECUTE') {
      const payload = message.payload as { query: unknown };
      graph.query(payload.query).then(sendResponse).catch((e: Error) => {
        sendResponse({ error: e.message });
      });
      return true;
    }

    if (message.type === 'MUTATION_EXECUTE') {
      const payload = message.payload as { mutation: unknown };
      graph.mutate(payload.mutation).then(sendResponse).catch((e: Error) => {
        sendResponse({ error: e.message });
      });
      return true;
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
