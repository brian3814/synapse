import React, { useState, useEffect } from 'react';

interface PropertyEditorProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

export function PropertyEditor({ value, onChange }: PropertyEditorProps) {
  const [jsonText, setJsonText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');

  useEffect(() => {
    setJsonText(JSON.stringify(value, null, 2));
  }, [value]);

  const handleChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        onChange(parsed);
        setError('');
      } else {
        setError('Must be a JSON object');
      }
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <div>
      <textarea
        value={jsonText}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 font-mono outline-none focus:border-indigo-500 min-h-[80px] resize-y"
        spellCheck={false}
      />
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
