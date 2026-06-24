import React, { useState, useEffect, useRef, useCallback } from 'react';

interface PropertyEditorProps {
  value: Record<string, unknown>;
  onSave: (value: Record<string, unknown>) => void;
  nodeId: string;
}

type PropType = 'string' | 'number' | 'boolean' | 'json';

function detectType(value: unknown): PropType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}

function formatValue(value: unknown, type: PropType): string {
  if (type === 'json') return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(raw: string, type: PropType): unknown {
  if (type === 'string') return raw;
  if (type === 'number') return Number(raw);
  if (type === 'boolean') return raw === 'true';
  return JSON.parse(raw);
}

function deepEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function PropertyEditor({ value, onSave, nodeId }: PropertyEditorProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(value);
  const [baseline, setBaseline] = useState<Record<string, unknown>>(value);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<PropType>('string');
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  // Reset when node changes
  useEffect(() => {
    setDraft(value);
    setBaseline(value);
    setEditingField(null);
    setEditingKey(null);
    setJsonErrors({});
  }, [nodeId]);

  // Sync when external value changes (e.g., after panel-level save)
  useEffect(() => {
    if (!deepEqual(value, baseline)) {
      setDraft(value);
      setBaseline(value);
    }
  }, [value]);

  const isDirty = !deepEqual(draft, baseline);

  const updateField = useCallback((key: string, newVal: unknown) => {
    setDraft(prev => ({ ...prev, [key]: newVal }));
    setJsonErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const removeField = useCallback((key: string) => {
    setDraft(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setJsonErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const renameKey = useCallback((oldKey: string, newKeyName: string) => {
    if (!newKeyName.trim() || newKeyName === oldKey) {
      setEditingKey(null);
      return;
    }
    setDraft(prev => {
      const entries = Object.entries(prev);
      const next: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        next[k === oldKey ? newKeyName.trim() : k] = v;
      }
      return next;
    });
    setEditingKey(null);
  }, []);

  const addProperty = useCallback(() => {
    const key = newKey.trim();
    if (!key || key in draft) return;
    let val: unknown;
    if (newType === 'string') val = newValue;
    else if (newType === 'number') val = Number(newValue) || 0;
    else if (newType === 'boolean') val = false;
    else {
      try { val = JSON.parse(newValue || '{}'); } catch { val = {}; }
    }
    setDraft(prev => ({ ...prev, [key]: val }));
    setNewKey('');
    setNewValue('');
    setNewType('string');
  }, [newKey, newValue, newType, draft]);

  const handleSave = useCallback(() => {
    onSave(draft);
    setBaseline(draft);
  }, [draft, onSave]);

  const handleRevert = useCallback(() => {
    setDraft(baseline);
    setEditingField(null);
    setEditingKey(null);
    setJsonErrors({});
  }, [baseline]);

  const entries = Object.entries(draft);

  return (
    <div className="space-y-1">
      {entries.length === 0 && (
        <p className="text-xs text-zinc-600 italic">No properties</p>
      )}

      {entries.map(([key, val]) => {
        const type = detectType(val);
        return (
          <PropertyRow
            key={key}
            propKey={key}
            value={val}
            type={type}
            isEditing={editingField === key}
            isEditingKey={editingKey === key}
            jsonError={jsonErrors[key]}
            onStartEdit={() => {
              if (editingField && editingField !== key) {
                // Confirm the previous field
                setEditingField(null);
              }
              setEditingField(key);
            }}
            onStartKeyEdit={() => setEditingKey(key)}
            onChange={(newVal) => updateField(key, newVal)}
            onJsonError={(err) => setJsonErrors(prev => ({ ...prev, [key]: err }))}
            onBlur={() => setEditingField(null)}
            onRenameKey={(newName) => renameKey(key, newName)}
            onRemove={() => removeField(key)}
          />
        );
      })}

      {/* Add property row */}
      <div className="flex items-center gap-1 pt-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addProperty()}
          placeholder="key"
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
        {newType !== 'boolean' && (
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProperty()}
            placeholder="value"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          />
        )}
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as PropType)}
          className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-400 outline-none"
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="json">JSON</option>
        </select>
        <button
          onClick={addProperty}
          disabled={!newKey.trim()}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 px-1"
        >
          +
        </button>
      </div>

      {/* Save / Revert bar */}
      {isDirty && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500"
          >
            Save
          </button>
          <button
            onClick={handleRevert}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            Revert
          </button>
        </div>
      )}
    </div>
  );
}

// ── Individual property row ──────────────────────────────────────────

interface PropertyRowProps {
  propKey: string;
  value: unknown;
  type: PropType;
  isEditing: boolean;
  isEditingKey: boolean;
  jsonError?: string;
  onStartEdit: () => void;
  onStartKeyEdit: () => void;
  onChange: (value: unknown) => void;
  onJsonError: (err: string) => void;
  onBlur: () => void;
  onRenameKey: (newName: string) => void;
  onRemove: () => void;
}

function PropertyRow({
  propKey, value, type, isEditing, isEditingKey, jsonError,
  onStartEdit, onStartKeyEdit, onChange, onJsonError, onBlur, onRenameKey, onRemove,
}: PropertyRowProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const [keyDraft, setKeyDraft] = useState(propKey);

  useEffect(() => {
    if (isEditing && inputRef.current) inputRef.current.focus();
  }, [isEditing]);

  useEffect(() => {
    if (isEditingKey && keyInputRef.current) keyInputRef.current.focus();
  }, [isEditingKey]);

  useEffect(() => {
    setKeyDraft(propKey);
  }, [propKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'json') {
      onBlur();
    }
    if (e.key === 'Escape') {
      onBlur();
    }
  };

  return (
    <div className="group flex items-start gap-2 py-0.5">
      {/* Key */}
      <div className="w-28 shrink-0">
        {isEditingKey ? (
          <input
            ref={keyInputRef}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={() => onRenameKey(keyDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameKey(keyDraft);
              if (e.key === 'Escape') { setKeyDraft(propKey); onRenameKey(propKey); }
            }}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          />
        ) : (
          <span
            onClick={onStartKeyEdit}
            className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 truncate block"
            title={propKey}
          >
            {propKey}
          </span>
        )}
      </div>

      {/* Value */}
      <div className="flex-1 min-w-0">
        {type === 'boolean' ? (
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-indigo-500"
          />
        ) : isEditing ? (
          type === 'json' ? (
            <div>
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                defaultValue={formatValue(value, type)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    onChange(parsed);
                    onJsonError('');
                  } catch {
                    onJsonError('Invalid JSON');
                  }
                }}
                onBlur={onBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onBlur();
                }}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-100 font-mono outline-none focus:border-indigo-500 resize-y min-h-[60px]"
                spellCheck={false}
              />
              {jsonError && <p className="text-xs text-red-400 mt-0.5">{jsonError}</p>}
            </div>
          ) : type === 'number' ? (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="number"
              defaultValue={Number(value)}
              onChange={(e) => onChange(Number(e.target.value))}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              defaultValue={String(value)}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
            />
          )
        ) : (
          <span
            onClick={onStartEdit}
            className={`text-xs cursor-pointer hover:text-zinc-100 block truncate ${
              type === 'json' ? 'text-zinc-400 font-mono' : 'text-zinc-200'
            }`}
            title={formatValue(value, type)}
          >
            {type === 'json' ? JSON.stringify(value) : String(value)}
          </span>
        )}
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-0.5 shrink-0"
        title="Remove property"
      >
        ×
      </button>
    </div>
  );
}
