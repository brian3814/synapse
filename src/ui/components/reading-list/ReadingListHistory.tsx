import { useState, useEffect } from 'react';
import { readingList as readingListDb } from '../../../db/client/db-client';

interface HistoryItem {
  id: string;
  url: string;
  title: string;
  summary: string;
  key_topics: string;
  merged_at: string;
  node_ids: string;
}

export function ReadingListHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    readingListDb.getAll()
      .then((rows: any) => {
        setItems(rows ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-4 text-zinc-400 text-sm">Loading history...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-zinc-500 text-sm text-center">
        No merged items yet. Review & merge reading list items to build your knowledge graph.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map(item => {
        const topics = (() => { try { return JSON.parse(item.key_topics); } catch { return []; } })();
        const mergedDate = new Date(item.merged_at).toLocaleDateString();
        return (
          <div key={item.id} className="px-3 py-2.5 border-b border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-200 line-clamp-1">{item.title}</h3>
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{item.summary}</p>
            {topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {topics.slice(0, 5).map((t: string, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 text-xs bg-zinc-700/50 text-zinc-400 rounded">{t}</span>
                ))}
              </div>
            )}
            <div className="text-xs text-zinc-600 mt-1">Merged {mergedDate}</div>
          </div>
        );
      })}
    </div>
  );
}
