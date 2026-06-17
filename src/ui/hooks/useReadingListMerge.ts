import { useCallback, useEffect, useRef } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useUIStore } from '../../graph/store/ui-store';
import { useReadingListStore } from '../../graph/store/reading-list-store';
import { useLLMExtraction, buildDiffItems } from './useLLMExtraction';
import { readingList as readingListDb } from '../../db/client/db-client';
import type { ReadingListResource } from '../../shared/reading-list-types';
import { browser } from '@platform';

export function useReadingListMerge() {
  const { proceedToReview } = useLLMExtraction();
  const mergingIdRef = useRef<string | null>(null);

  const startMerge = useCallback(async (item: ReadingListResource) => {
    if (!item.extraction?.nodes || !item.extraction?.edges) return;

    const llm = useLLMStore.getState();

    // Track which item we're merging
    mergingIdRef.current = item.id;

    // Set source context on LLM store
    llm.setSourceUrl(item.source.kind === 'url' ? item.source.url : item.id);
    llm.setInputText(item.extraction?.pageContent ?? '');

    // Build diff items using existing entity resolution + similarity matches (populated during extraction pipeline)
    const validated = {
      nodes: item.extraction.nodes,
      edges: item.extraction.edges,
    };
    const { items, notes } = await buildDiffItems(validated, item.similarityMatches);

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
        mergingIdRef.current &&
        prevState.status === 'merging' &&
        state.status === 'idle'
      ) {
        const id = mergingIdRef.current;
        mergingIdRef.current = null;

        // Post-merge cleanup
        const readingListItems = useReadingListStore.getState().items;
        const item = readingListItems[id] as ReadingListResource | undefined;

        try {
          // 1. Save to reading list history in SQLite
          if (item) {
            const url = item.source.kind === 'url' ? item.source.url : item.id;
            await readingListDb.save({
              url,
              title: item.title,
              summary: item.extraction?.summary ?? '',
              keyTopics: item.extraction?.keyTopics ?? [],
            });
          }

          // 2. Source content is already saved by applyReview (it checks llm.sourceUrl + llm.inputText)

          // 3. Remove from Chrome reading list via service worker (URL resources only)
          if (item?.source.kind === 'url') {
            await (browser as any).sendReadingListRemove(item.source.url);
          }

          // 4. Soft-delete: mark as complete in reading list store
          useReadingListStore.getState().markComplete(id);

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
