import React, { useState, useEffect, useCallback } from 'react';

const STARTER_TEMPLATE = JSON.stringify(
  { query: [{ type: 'entity', var: 'n' }], return: ['n'], limit: 25 },
  null,
  2,
);

interface RawQueryEditorProps {
  initialJson?: string;
  onQueryReady: (json: string | null) => void;
}

export function RawQueryEditor({ initialJson, onQueryReady }: RawQueryEditorProps) {
  const [text, setText] = useState(initialJson || STARTER_TEMPLATE);
  const [parseError, setParseError] = useState<string | null>(null);

  const validate = useCallback((value: string) => {
    try {
      JSON.parse(value);
      setParseError(null);
      return true;
    } catch (e: any) {
      setParseError(e.message);
      return false;
    }
  }, []);

  useEffect(() => {
    if (validate(text)) {
      onQueryReady(text);
    } else {
      onQueryReady(null);
    }
  }, [text, validate, onQueryReady]);

  // Sync when initialJson changes (e.g. from builder mode switch)
  useEffect(() => {
    if (initialJson !== undefined && initialJson !== text) {
      setText(initialJson);
    }
    // Only re-sync when initialJson prop changes, not text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className={`w-full bg-zinc-800 border rounded px-3 py-2 font-mono text-xs text-zinc-100 outline-none resize-y min-h-[200px] ${
          parseError ? 'border-red-500' : 'border-zinc-600 focus:border-indigo-500'
        }`}
      />
      {parseError && (
        <p className="text-xs text-red-400">{parseError}</p>
      )}
    </div>
  );
}
