import React, { useState } from 'react';
import { useNLQuery } from '../../hooks/useNLQuery';
import { QueryResults } from './QueryResults';

interface NLQueryInputProps {
  onEditAsRaw: (json: string) => void;
}

export function NLQueryInput({ onEditAsRaw }: NLQueryInputProps) {
  const [input, setInput] = useState('');
  const { status, streamText, generatedJson, results, error, execute, reset } = useNLQuery();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'streaming' || status === 'executing') return;
    execute(input.trim());
  };

  const isLoading = status === 'streaming' || status === 'executing';

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your graph..."
          className="flex-1 bg-zinc-800 text-sm text-zinc-100 px-3 py-1.5 rounded border border-zinc-700 focus:border-indigo-500 focus:outline-none"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Working...' : 'Ask'}
        </button>
      </form>

      {/* Streaming preview */}
      {status === 'streaming' && streamText && (
        <details open className="text-xs">
          <summary className="text-zinc-500 cursor-pointer">Generating query...</summary>
          <pre className="mt-1 p-2 bg-zinc-900 rounded text-zinc-400 overflow-auto max-h-32 font-mono text-[11px]">
            {streamText}
          </pre>
        </details>
      )}

      {status === 'executing' && (
        <p className="text-xs text-zinc-400">Executing query...</p>
      )}

      {/* Error */}
      {error && (
        <div className="space-y-1">
          <p className="text-xs text-red-400">{error}</p>
          {generatedJson && (
            <button
              onClick={() => onEditAsRaw(generatedJson)}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              Edit as Raw JSON
            </button>
          )}
        </div>
      )}

      {/* Success: show generated DSL + results */}
      {(status === 'done' || (status === 'error' && generatedJson)) && generatedJson && !error && (
        <details className="text-xs">
          <summary className="text-zinc-500 cursor-pointer">
            Generated DSL
          </summary>
          <div className="mt-1 relative">
            <pre className="p-2 bg-zinc-900 rounded text-zinc-400 overflow-auto max-h-40 font-mono text-[11px]">
              {JSON.stringify(JSON.parse(generatedJson), null, 2)}
            </pre>
            <button
              onClick={() => onEditAsRaw(generatedJson)}
              className="absolute top-1 right-1 text-[10px] text-indigo-400 hover:text-indigo-300 bg-zinc-800 px-1.5 py-0.5 rounded"
            >
              Edit
            </button>
          </div>
        </details>
      )}

      {results && <QueryResults results={results} />}
    </div>
  );
}
