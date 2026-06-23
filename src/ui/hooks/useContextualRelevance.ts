import { useState, useEffect, useCallback } from 'react';
import { nodes as nodesApi } from '../../db/client/db-client';
import type { DbNode } from '../../shared/types';
import { storage, browser, platformId } from '@platform';

export interface RelatedMatch {
  node: DbNode;
  matchedTerm: string;
}

const RELEVANCE_STORAGE_KEY = 'contextualRelevanceEnabled';

export function useContextualRelevance() {
  const [relatedNodes, setRelatedNodes] = useState<RelatedMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);

  // Load preference
  useEffect(() => {
    storage.get(RELEVANCE_STORAGE_KEY).then((result: Record<string, any>) => {
      if (result[RELEVANCE_STORAGE_KEY] !== undefined) {
        setEnabled(result[RELEVANCE_STORAGE_KEY]);
      }
    }).catch(() => {});
  }, []);

  const toggleEnabled = useCallback(async (value: boolean) => {
    setEnabled(value);
    try {
      await storage.set({ [RELEVANCE_STORAGE_KEY]: value });
    } catch {}
    if (!value) {
      setRelatedNodes([]);
    }
  }, []);

  // Listen for PAGE_TERMS messages from content script (Chrome-only)
  useEffect(() => {
    if (!enabled || platformId !== 'chrome') return;

    const listener = async (message: any) => {
      if (message.type !== 'PAGE_TERMS') return;

      const { url, terms } = message.payload;
      if (!terms || terms.length === 0) return;

      setCurrentUrl(url);
      setLoading(true);

      try {
        const matched: DbNode[] = await nodesApi.matchTerms(terms, 15);

        if (matched.length > 0) {
          // Map nodes to the terms they matched
          const results: RelatedMatch[] = matched.map((node) => {
            const matchedTerm = terms.find(
              (t: string) => node.name.toLowerCase().includes(t.toLowerCase())
            ) ?? terms[0];
            return { node, matchedTerm };
          });

          setRelatedNodes(results);
        } else {
          setRelatedNodes([]);
        }
      } catch (e) {
        console.warn('[Relevance] Term matching failed:', e);
        setRelatedNodes([]);
      } finally {
        setLoading(false);
      }
    };

    const cleanup = (browser as any).onRuntimeMessage(listener);
    return cleanup;
  }, [enabled]);

  // Trigger extraction when active tab changes (Chrome-only)
  useEffect(() => {
    if (!enabled || platformId !== 'chrome') return;

    const triggerExtraction = async () => {
      try {
        const tab = await browser.getActiveTab();
        if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
          return;
        }
        // Ensure content script is available, then request terms
        try {
          await (browser as any).extractPageTerms(tab.id);
        } catch {
          // Content script not injected — try injecting first
          try {
            await (browser as any).ensureContentScript(tab.id);
            await (browser as any).extractPageTerms(tab.id);
          } catch {
            // Cannot inject (e.g. chrome:// pages)
          }
        }
      } catch {
        // Tabs API may not be available
      }
    };

    // Trigger on mount
    triggerExtraction();

    // Trigger on tab activation
    const cleanupTabListener = (browser as any).onTabActivated(() => {
      triggerExtraction();
    });

    return cleanupTabListener;
  }, [enabled]);

  return { relatedNodes, loading, currentUrl, enabled, toggleEnabled };
}
