import { useCallback, useEffect, useRef } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useUIStore } from '../../graph/store/ui-store';
import { useReadingListStore } from '../../graph/store/reading-list-store';
import { useLLMExtraction, buildDiffItems } from './useLLMExtraction';
import { readingList as readingListDb, sourceContent } from '../../db/client/db-client';
import type { ReadingListItem } from '../../shared/types';
import { browser } from '@platform';

export function useReadingListMerge() {
  const { proceedToReview, applyReview } = useLLMExtraction();
  const mergingUrlRef = useRef<string | null>(null);

  const startMerge = useCallback(async (item: ReadingListItem) => {
    if (!item.extractedNodes || !item.extractedEdges) return;

    const llm = useLLMStore.getState();

    // Track which item we're merging
    mergingUrlRef.current = item.url;

    // Set source context on LLM store
    llm.setSourceUrl(item.url);
    llm.setInputText(item.pageContent ?? '');

    // Build diff items using existing entity resolution
    const validated = {
      nodes: item.extractedNodes,
      edges: item.extractedEdges,
    };
    const { items, notes } = await buildDiffItems(validated);

    // Set diff and advance to extracted status
    llm.setDiff({ items, notes });
    llm.setStatus('extracted');

    // Advance to review and open the extraction review tab
    await proceedToReview();
    useUIStore.getState().openContentTab({ kind: 'extractionReview' }, 'Extraction');
  }, [proceedToReview]);

  // Watch for review completion — when LLM store resets to 'idle' after we started a merge
  useEffect(() => {
    const unsubscribe = useLLMStore.subscribe(async (state, prevState) => {
      // Detect: was merging/reviewing, now idle → review was applied
      if (
        mergingUrlRef.current &&
        prevState.status === 'merging' &&
        state.status === 'idle'
      ) {
        const url = mergingUrlRef.current;
        mergingUrlRef.current = null;

        // Post-merge cleanup
        const readingListItems = useReadingListStore.getState().items;
        const item = readingListItems[url];

        try {
          // 1. Save to reading list history in SQLite
          if (item) {
            await readingListDb.save({
              url,
              title: item.pageTitle || item.title,
              summary: item.summary ?? '',
              keyTopics: item.keyTopics ?? [],
            });
          }

          // 2. Source content is already saved by applyReview (it checks llm.sourceUrl + llm.inputText)

          // 3. Remove from Chrome reading list via service worker
          await (browser as any).sendReadingListRemove(url);

          // 4. Soft-delete: mark as complete in reading list store
          await useReadingListStore.getState().markComplete(url);

          // 5. Switch back to reading list panel
          useUIStore.getState().forceActivePanel('readingList');
        } catch (e) {
          console.error('[ReadingListMerge] Post-merge cleanup failed:', e);
        }
      }
    });

    return unsubscribe;
  }, []);

  return { startMerge };
}
