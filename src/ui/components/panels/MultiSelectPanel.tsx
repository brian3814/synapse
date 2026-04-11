import { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { entityResolution, noteSearch } from '../../../db/client/db-client';
import { write as writeNote } from '../../../notes/opfs-note-store';
import { generateNoteMarkdown, stripMarkdownToPlainText } from '../../../notes/markdown-utils';
import type { GraphNode } from '../../../shared/types';

type Action = 'none' | 'merge' | 'relate' | 'note';
type NoteMode = 'choose' | 'manual-saving' | 'auto-input' | 'auto-generating' | 'auto-preview';

interface RelationshipRow {
  sourceId: string;
  targetId: string;
  label: string;
}

const SEED_LABELS = [
  'related',
  'subfield_of',
  'part_of',
  'instance_of',
  'created_by',
  'affiliated_with',
  'used_in',
  'builds_on',
  'enables',
  'contradicts',
  'alternative_to',
  'preceded_by',
];

const NOTE_SYSTEM_PROMPT = `You are a knowledge synthesis assistant. You will be given a set of entities from a knowledge graph and an instruction. Generate a focused note as markdown prose.

Rules:
- Use [[Entity Name]] wikilinks when referencing entities (exact name match required)
- Write 3-10 sentences of clear, focused prose
- Follow the user's instruction for the type of note (comparison, summary, synthesis, new idea, etc.)
- Output ONLY the note content — no title, no metadata, no code fences`;

export function MultiSelectPanel() {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const createEdge = useGraphStore((s) => s.createEdge);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const forceActivePanel = useUIStore((s) => s.forceActivePanel);
  const setPendingEditNoteId = useUIStore((s) => s.setPendingEditNoteId);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const [action, setAction] = useState<Action>('none');
  const [masterId, setMasterId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [rows, setRows] = useState<RelationshipRow[]>([]);
  const [creating, setCreating] = useState(false);

  // Note generation state
  const [noteMode, setNoteMode] = useState<NoteMode>('choose');
  const [noteInstruction, setNoteInstruction] = useState('');
  const [notePreview, setNotePreview] = useState('');
  const [noteStreaming, setNoteStreaming] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const selectedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));

  // Reset action when selection changes
  useEffect(() => {
    setAction('none');
    setMasterId(null);
    setRows([]);
    setNoteMode('choose');
    setNoteInstruction('');
    setNotePreview('');
    setNoteStreaming('');
    setNoteError(null);
  }, [selectedNodeIds]);

  // --- Helpers: create note + mention edges + navigate to editor ---
  const saveNoteAndOpen = async (title: string, content: string) => {
    const graphStore = useGraphStore.getState();
    const wikiLinks = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split('|')[0].trim());

    const noteNode = await graphStore.createNode({
      name: title,
      type: 'note',
      properties: { wikiLinks },
    });
    if (!noteNode) return;

    // Write content to OPFS + search index
    const markdown = generateNoteMarkdown(title, content, wikiLinks);
    await writeNote(noteNode.id, markdown);
    await noteSearch.upsert(noteNode.id, title, stripMarkdownToPlainText(content));

    // Create mention edges to all selected nodes
    await Promise.all(
      selectedNodes.map((n) =>
        graphStore.createEdge({
          sourceId: noteNode.id,
          targetId: n.id,
          label: 'mention',
        }).catch(() => {})
      )
    );

    // Navigate to NoteEditor
    setPendingEditNoteId(noteNode.id);
    forceActivePanel('notes');
  };

  // --- Delete All ---
  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedNodes.length} selected nodes? Connected edges will also be removed.`))
      return;
    for (const n of selectedNodes) {
      await deleteNode(n.id);
    }
    setActivePanel('none');
  };

  // --- Merge ---
  const handleMerge = async () => {
    if (!masterId) return;
    const master = nodes.find((n) => n.id === masterId);
    if (!master) return;

    const others = selectedNodes.filter((n) => n.id !== masterId);
    if (others.length === 0) return;

    if (
      !confirm(
        `Merge ${others.length} node${others.length > 1 ? 's' : ''} into "${master.name}"? This will move all edges and add name aliases.`
      )
    )
      return;

    setMerging(true);
    try {
      const graphStore = useGraphStore.getState();

      for (const other of others) {
        try {
          await entityResolution.addAlias(masterId, other.name);
        } catch {}

        if (Object.keys(other.properties).length > 0) {
          const current = graphStore.nodes.find((n) => n.id === masterId);
          if (current) {
            await updateNode({
              id: masterId,
              properties: { ...current.properties, ...other.properties },
            });
          }
        }

        const edgesNow = useGraphStore.getState().edges;
        for (const edge of edgesNow) {
          let newSourceId: string | null = null;
          let newTargetId: string | null = null;
          if (edge.sourceId === other.id) {
            if (edge.targetId === masterId) continue;
            newSourceId = masterId;
            newTargetId = edge.targetId;
          } else if (edge.targetId === other.id) {
            if (edge.sourceId === masterId) continue;
            newSourceId = edge.sourceId;
            newTargetId = masterId;
          }
          if (newSourceId && newTargetId) {
            await graphStore.createEdge({
              sourceId: newSourceId,
              targetId: newTargetId,
              label: edge.label,
              type: edge.type,
              properties: edge.properties,
            });
            await graphStore.deleteEdge(edge.id);
          }
        }

        await deleteNode(other.id);
      }

      selectNode(masterId);
      setActivePanel('nodeDetail');
    } finally {
      setMerging(false);
    }
  };

  // --- Establish Relationships ---
  const addRow = useCallback(() => {
    const ids = [...selectedNodeIds];
    setRows((prev) => [
      ...prev,
      { sourceId: ids[0] ?? '', targetId: ids[1] ?? ids[0] ?? '', label: 'related' },
    ]);
  }, [selectedNodeIds]);

  const updateRow = (index: number, field: keyof RelationshipRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateRelationships = async () => {
    const valid = rows.filter((r) => r.sourceId && r.targetId && r.label.trim());
    if (valid.length === 0) return;

    setCreating(true);
    try {
      for (const row of valid) {
        await createEdge({
          sourceId: row.sourceId,
          targetId: row.targetId,
          label: row.label.trim(),
        });
      }
      setRows([]);
      setAction('none');
    } finally {
      setCreating(false);
    }
  };

  // --- Generate Note: Manual ---
  const handleManualNote = async () => {
    setNoteMode('manual-saving');
    const names = selectedNodes.map((n) => n.name);
    const title = `Note on ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
    const content = names.map((n) => `[[${n}]]`).join('\n\n');
    await saveNoteAndOpen(title, content);
  };

  // --- Generate Note: Auto ---
  const handleAutoGenerate = async () => {
    setNoteError(null);
    setNoteStreaming('');
    setNotePreview('');
    setNoteMode('auto-generating');
    abortRef.current = false;

    try {
      const configResult = await chrome.storage.local.get('llmConfig') as Record<string, any>;
      const config = configResult.llmConfig;
      if (!config?.apiKey) {
        setNoteError('No API key configured. Go to Settings to add one.');
        setNoteMode('auto-input');
        return;
      }

      // Build context about selected nodes
      const nodeContext = selectedNodes
        .map((n) => {
          const parts = [`- ${n.name} (${n.label ?? n.type})`];
          const propEntries = Object.entries(n.properties).filter(([k]) => k !== 'content' && k !== 'wikiLinks');
          if (propEntries.length > 0) {
            parts.push(`  Properties: ${propEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);
          }
          return parts.join('\n');
        })
        .join('\n');

      const userPrompt = `Entities:\n${nodeContext}\n\nInstruction: ${noteInstruction}`;
      const requestId = crypto.randomUUID();

      // Send LLM request
      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
          prompt: userPrompt,
          systemPrompt: NOTE_SYSTEM_PROMPT,
        },
      });

      // Listen for stream chunks
      const result = await new Promise<{ content?: string; error?: string }>((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve({ error: 'LLM request timed out after 120s' });
        }, 120_000);

        const listener = (message: any) => {
          if (abortRef.current) {
            cleanup();
            resolve({ error: 'Cancelled' });
            return;
          }
          if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
          const { chunk, done, content, error, errorType } = message.payload;
          if (chunk) {
            setNoteStreaming((prev) => prev + chunk);
          }
          if (done) {
            if (error && (errorType === 'rate_limit' || errorType === 'overloaded')) return;
            cleanup();
            resolve({ content, error });
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
        };

        chrome.runtime.onMessage.addListener(listener);
      });

      if (abortRef.current) return;

      if (result.error) {
        setNoteError(result.error);
        setNoteMode('auto-input');
        return;
      }

      setNotePreview(result.content ?? '');
      setNoteMode('auto-preview');
    } catch (e: any) {
      setNoteError(e.message);
      setNoteMode('auto-input');
    }
  };

  const handleSaveAutoNote = async () => {
    const names = selectedNodes.map((n) => n.name);
    const title = `Note on ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
    await saveNoteAndOpen(title, notePreview);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">
          {selectedNodes.length} nodes selected
        </h3>
      </div>

      {/* Selected nodes list */}
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {selectedNodes.map((n) => (
          <div key={n.id} className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded text-xs">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: n.color || getColorForType(n.type) }}
            />
            <span className="text-zinc-200 truncate">{n.name}</span>
            <span className="text-zinc-500 capitalize ml-auto flex-shrink-0">{n.type}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-400 block">Actions</label>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={handleBulkDelete}
            className="text-xs px-2 py-1.5 bg-red-900/50 text-red-400 rounded hover:bg-red-900"
          >
            Delete All
          </button>
          <ActionToggle label="Merge Nodes" active={action === 'merge'} onClick={() => setAction(action === 'merge' ? 'none' : 'merge')} />
          <ActionToggle label="Add Relationships" active={action === 'relate'} onClick={() => {
            if (action !== 'relate') {
              setAction('relate');
              if (rows.length === 0) {
                const ids = [...selectedNodeIds];
                setRows([{ sourceId: ids[0] ?? '', targetId: ids[1] ?? ids[0] ?? '', label: 'related' }]);
              }
            } else {
              setAction('none');
            }
          }} />
          <ActionToggle label="Generate Note" active={action === 'note'} onClick={() => {
            setAction(action === 'note' ? 'none' : 'note');
            setNoteMode('choose');
            setNotePreview('');
            setNoteStreaming('');
            setNoteError(null);
          }} />
        </div>
      </div>

      {/* Merge UI */}
      {action === 'merge' && (
        <div className="space-y-2 border border-zinc-700 rounded p-3">
          <label className="text-xs font-medium text-zinc-400 block">
            Select master node (others merge into it)
          </label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {selectedNodes.map((n) => (
              <button
                key={n.id}
                onClick={() => setMasterId(n.id)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  masterId === n.id
                    ? 'bg-indigo-600/30 border border-indigo-500 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: n.color || getColorForType(n.type) }}
                />
                <span className="truncate">{n.name}</span>
                {masterId === n.id && (
                  <span className="text-[10px] text-indigo-400 ml-auto shrink-0">master</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={handleMerge}
            disabled={!masterId || merging}
            className="w-full text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {merging ? 'Merging...' : `Merge ${selectedNodes.length - 1} into master`}
          </button>
        </div>
      )}

      {/* Relationship Builder UI */}
      {action === 'relate' && (
        <div className="space-y-2 border border-zinc-700 rounded p-3">
          <label className="text-xs font-medium text-zinc-400 block">
            Define relationships
          </label>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {rows.map((row, i) => (
              <RelationshipRowEditor
                key={i}
                row={row}
                index={i}
                selectedNodes={selectedNodes}
                onUpdate={updateRow}
                onRemove={removeRow}
              />
            ))}
          </div>
          <button
            onClick={addRow}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            + Add relationship
          </button>
          <button
            onClick={handleCreateRelationships}
            disabled={rows.length === 0 || creating}
            className="w-full text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? 'Creating...' : `Create ${rows.length} relationship${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Generate Note UI */}
      {action === 'note' && (
        <div className="space-y-2 border border-zinc-700 rounded p-3">
          {/* Mode chooser */}
          {noteMode === 'choose' && (
            <>
              <label className="text-xs font-medium text-zinc-400 block">
                How would you like to create the note?
              </label>
              <div className="flex gap-2">
                <button
                  onClick={handleManualNote}
                  className="flex-1 text-xs py-2 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600"
                >
                  Write Manually
                </button>
                <button
                  onClick={() => setNoteMode('auto-input')}
                  className="flex-1 text-xs py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                >
                  Auto-Generate
                </button>
              </div>
            </>
          )}

          {/* Manual: saving indicator */}
          {noteMode === 'manual-saving' && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-400">Creating note...</span>
            </div>
          )}

          {/* Auto: instruction input */}
          {noteMode === 'auto-input' && (
            <>
              <label className="text-xs font-medium text-zinc-400 block">
                What kind of note should be generated?
              </label>
              <textarea
                value={noteInstruction}
                onChange={(e) => setNoteInstruction(e.target.value)}
                placeholder="e.g. Summarize a comparison between these concepts, or Generate a new idea integrating their key insights..."
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500 placeholder-zinc-600 min-h-[60px] resize-y"
                autoFocus
              />
              {noteError && (
                <p className="text-xs text-red-400">{noteError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setNoteMode('choose')}
                  className="text-xs px-3 py-1.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
                >
                  Back
                </button>
                <button
                  onClick={handleAutoGenerate}
                  disabled={!noteInstruction.trim()}
                  className="flex-1 text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Generate
                </button>
              </div>
            </>
          )}

          {/* Auto: streaming */}
          {noteMode === 'auto-generating' && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-zinc-400">Generating...</span>
              </div>
              <div className="bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-300 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {noteStreaming || '...'}
              </div>
              <button
                onClick={() => { abortRef.current = true; setNoteMode('auto-input'); }}
                className="text-xs px-3 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
              >
                Cancel
              </button>
            </>
          )}

          {/* Auto: preview */}
          {noteMode === 'auto-preview' && (
            <>
              <label className="text-xs font-medium text-zinc-400 block">
                Preview
              </label>
              <textarea
                value={notePreview}
                onChange={(e) => setNotePreview(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500 min-h-[120px] resize-y font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setNoteMode('auto-input'); setNoteStreaming(''); }}
                  className="text-xs px-3 py-1.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
                >
                  Regenerate
                </button>
                <button
                  onClick={handleSaveAutoNote}
                  className="flex-1 text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                >
                  Edit &amp; Save
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ActionToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-1.5 rounded ${
        active ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
      }`}
    >
      {label}
    </button>
  );
}

function RelationshipRowEditor({
  row,
  index,
  selectedNodes,
  onUpdate,
  onRemove,
}: {
  row: RelationshipRow;
  index: number;
  selectedNodes: GraphNode[];
  onUpdate: (index: number, field: keyof RelationshipRow, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [custom, setCustom] = useState(false);

  return (
    <div className="flex items-center gap-1 bg-zinc-800 rounded p-1.5">
      <select
        value={row.sourceId}
        onChange={(e) => onUpdate(index, 'sourceId', e.target.value)}
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-200 outline-none"
      >
        {selectedNodes.map((n) => (
          <option key={n.id} value={n.id}>{n.name}</option>
        ))}
      </select>
      <span className="text-zinc-600 text-[10px] shrink-0">&rarr;</span>
      {custom ? (
        <input
          value={row.label}
          onChange={(e) => onUpdate(index, 'label', e.target.value)}
          placeholder="label"
          className="w-24 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-indigo-400 outline-none focus:border-indigo-500"
        />
      ) : (
        <select
          value={SEED_LABELS.includes(row.label) ? row.label : '__custom__'}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustom(true);
              onUpdate(index, 'label', '');
            } else {
              onUpdate(index, 'label', e.target.value);
            }
          }}
          className="w-24 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-indigo-400 outline-none"
        >
          {SEED_LABELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
          <option value="__custom__">custom...</option>
        </select>
      )}
      <span className="text-zinc-600 text-[10px] shrink-0">&rarr;</span>
      <select
        value={row.targetId}
        onChange={(e) => onUpdate(index, 'targetId', e.target.value)}
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-200 outline-none"
      >
        {selectedNodes.map((n) => (
          <option key={n.id} value={n.id}>{n.name}</option>
        ))}
      </select>
      <button
        onClick={() => onRemove(index)}
        className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0 px-1"
        title="Remove"
      >
        x
      </button>
    </div>
  );
}
