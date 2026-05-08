import React, { useState, useRef, useCallback } from 'react';
import { graph } from '../../../db/client/db-client';
import { QueryBuilder, parseBuilderState } from './QueryBuilder';
import { RawQueryEditor } from './RawQueryEditor';
import { QueryResults } from './QueryResults';
import type { BuilderState } from './QueryBuilder';
import type { QueryResult } from '../../../db/worker/query-engine/types';
import { PanelHeader } from '../shared/PanelHeader';

type Mode = 'builder' | 'raw';

export function QueryPanel() {
  const [mode, setMode] = useState<Mode>('builder');
  const [results, setResults] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current query JSON from whichever mode is active
  const currentJson = useRef<string | null>(null);
  // Cached builder state when switching from builder to raw
  const builderState = useRef<BuilderState | null>(null);
  // JSON to pre-fill raw editor when switching from builder
  const [rawInitialJson, setRawInitialJson] = useState<string | undefined>(undefined);

  const handleQueryReady = useCallback((json: string | null) => {
    currentJson.current = json;
  }, []);

  const switchMode = (next: Mode) => {
    if (next === mode) return;

    if (mode === 'builder' && next === 'raw') {
      setRawInitialJson(currentJson.current ?? undefined);
    } else if (mode === 'raw' && next === 'builder') {
      if (currentJson.current) {
        builderState.current = parseBuilderState(currentJson.current);
      }
    }

    setMode(next);
  };

  const runQuery = async () => {
    const json = currentJson.current;
    if (!json) {
      setError('Invalid query JSON');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const parsed = JSON.parse(json);
      const result = await graph.query(parsed) as QueryResult;
      setResults(result);
    } catch (e: any) {
      setError(e.message || 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <PanelHeader title="Query" />
      {/* Mode toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => switchMode('builder')}
          className={`text-xs px-3 py-1.5 rounded ${
            mode === 'builder'
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Builder
        </button>
        <button
          onClick={() => switchMode('raw')}
          className={`text-xs px-3 py-1.5 rounded ${
            mode === 'raw'
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Raw JSON
        </button>
      </div>

      {/* Active editor */}
      {mode === 'builder' ? (
        <QueryBuilder
          onQueryReady={handleQueryReady}
          initialState={builderState.current}
        />
      ) : (
        <RawQueryEditor
          initialJson={rawInitialJson}
          onQueryReady={handleQueryReady}
        />
      )}

      {/* Run button */}
      <button
        onClick={runQuery}
        disabled={loading}
        className="w-full bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Running...' : 'Run Query'}
      </button>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Results */}
      {results && <QueryResults results={results} />}
    </div>
  );
}
