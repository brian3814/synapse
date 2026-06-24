import { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { noteSearch, noteAttachments } from '../../../db/client/db-client';
import { parseMarkdown, generateNoteMarkdown } from '../../../filesystem/markdown-parser';
import { getStoredFolder, writeMarkdownFile } from '../../../filesystem/folder-access';
import { NoteMarkdownPreview } from '../shared/MarkdownRenderer';
import { notes, entityFiles } from '@platform';
import { stripMarkdownToPlainText } from '../../../notes/markdown-utils';
import { SYNC_CHANNEL, type SyncEvent } from '../../../shared/sync-events';

type EditorTab = 'write' | 'preview';

interface NoteEditorProps {
  nodeId: string | null; // null = new note
  onBack?: () => void;
  isTab?: boolean;
}

export function NoteEditor({ nodeId: rawNodeId, onBack, isTab }: NoteEditorProps) {
  const isNewNote = !rawNodeId || rawNodeId.startsWith('new-');
  const nodeId = isNewNote ? null : rawNodeId;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>(isNewNote ? 'write' : 'preview');
  const [uploading, setUploading] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const graphStore = useGraphStore();
  // Track the effective note ID (may be created on-the-fly for image uploads)
  const effectiveNodeIdRef = useRef<string | null>(nodeId);
  const lastSavedTitleRef = useRef('');
  const lastSavedContentRef = useRef('');

  const nodeType = graphStore.nodes.find((n) => n.id === nodeId)?.type;
  const isEntity = nodeType === 'entity';

  // Load existing note or entity file
  useEffect(() => {
    if (!nodeId) return;

    const node = graphStore.nodes.find((n) => n.id === nodeId);
    if (node) {
      setTitle(node.name);
      lastSavedTitleRef.current = node.name;
    }

    if (isEntity) {
      entityFiles.read(nodeId).then((result: { path: string; content: string; contentHash: string | null } | null) => {
        if (result) {
          const parsed = parseMarkdown(result.content);
          if (parsed.title) {
            setTitle(parsed.title);
            lastSavedTitleRef.current = parsed.title;
          }
          setContent(parsed.content);
          lastSavedContentRef.current = parsed.content;
        }
      }).catch(() => {});
    } else {
      notes.read(nodeId).then((md) => {
        if (md) {
          const parsed = parseMarkdown(md);
          setContent(parsed.content);
          lastSavedContentRef.current = parsed.content;
        }
      }).catch(() => {});
    }
  }, [nodeId, isEntity]);

  // Cross-tab: reload content when another tab saves this note
  useEffect(() => {
    if (!nodeId || isEntity) return;
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channel.onmessage = (e: MessageEvent<SyncEvent>) => {
      if (e.data.type === 'note_content_updated' && e.data.nodeId === nodeId) {
        notes.read(nodeId).then((md) => {
          if (md) {
            const parsed = parseMarkdown(md);
            setContent(parsed.content);
          }
        }).catch(() => {});
      }
    };
    return () => channel.close();
  }, [nodeId, isEntity]);

  // External file change detection (e.g. edited in another app while Synapse is running)
  useEffect(() => {
    if (!nodeId || !notes.onExternalChange || isEntity) return;
    return notes.onExternalChange((changedNodeId) => {
      if (changedNodeId !== nodeId) return;
      const isDirty = title !== lastSavedTitleRef.current || content !== lastSavedContentRef.current;
      if (isDirty) {
        setShowConflictModal(true);
      } else {
        reloadFromDisk(nodeId);
      }
    });
  }, [nodeId, title, content, isEntity]);

  const reloadFromDisk = useCallback((nid: string) => {
    notes.read(nid).then((md) => {
      if (md) {
        const parsed = parseMarkdown(md);
        setTitle(parsed.title ?? title);
        setContent(parsed.content);
        lastSavedTitleRef.current = parsed.title ?? title;
        lastSavedContentRef.current = parsed.content;
      }
    }).catch(() => {});
    setShowConflictModal(false);
  }, [title]);

  // Auto-focus textarea
  useEffect(() => {
    if (!nodeId) textareaRef.current?.focus();
  }, [nodeId]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);

    try {
      const wikiLinks = extractWikiLinks(content);
      const markdown = generateNoteMarkdown(title, content, wikiLinks);

      if (nodeId) {
        if (isEntity) {
          // Entity file: write via entityFiles API, skip note-specific side effects
          await entityFiles.write(nodeId, markdown);
          await graphStore.updateNode({ id: nodeId, name: title });
        } else {
          // Note: existing path
          // 1. Write OPFS first (orphaned files are harmless)
          await notes.write(nodeId, markdown);
          // 2. Update search index
          await noteSearch.upsert(nodeId, title, stripMarkdownToPlainText(content));
          // 3. Update node metadata (no content in properties)
          await graphStore.updateNode({
            id: nodeId,
            name: title,
            properties: { wikiLinks },
          });
        }
      } else {
        // Create new note node (no content in properties)
        const node = await graphStore.createNode({
          name: title,
          type: 'note',
          properties: { wikiLinks },
        });

        if (node) {
          await notes.write(node.id, markdown);
          await noteSearch.upsert(node.id, title, stripMarkdownToPlainText(content));
          await createWikiLinkEdges(node.id, wikiLinks);
        }
      }

      if (!isEntity) {
        // Broadcast content update to other tabs
        const savedId = nodeId ?? graphStore.nodes.find((n) => n.name === title && n.type === 'note')?.id;
        if (savedId) {
          const channel = new BroadcastChannel(SYNC_CHANNEL);
          channel.postMessage({ type: 'note_content_updated', nodeId: savedId } satisfies SyncEvent);
          channel.close();
        }

        // Optionally sync to filesystem
        try {
          const folderHandle = await getStoredFolder();
          if (folderHandle) {
            const fileName = sanitizeFileName(title) + '.md';
            await writeMarkdownFile(folderHandle, `notes/${fileName}`, markdown);
          }
        } catch {
          // Folder not connected or permission denied — that's fine
        }
      }

      lastSavedTitleRef.current = title;
      lastSavedContentRef.current = content;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      if (!nodeId && isTab) {
        const created = graphStore.nodes.find((n) => n.name === title && n.type === 'note');
        if (created) {
          useUIStore.getState().closeContentTab(`note-${rawNodeId ?? ''}`);
          useUIStore.getState().openContentTab(
            { kind: 'noteEditor', noteId: created.id },
            title
          );
        }
      } else if (!nodeId) {
        onBack?.();
      }
    } catch (e: any) {
      console.error('[NoteEditor] Save failed:', e);
    } finally {
      setSaving(false);
    }
      if (isTab && nodeId) {
        useUIStore.getState().setContentTabTitle(`note-${nodeId}`, title);
      }
  }, [title, content, nodeId, isEntity, graphStore, onBack, isTab]);

  // Keep effectiveNodeIdRef in sync
  useEffect(() => { effectiveNodeIdRef.current = nodeId; }, [nodeId]);

  // --- Image drop/paste handling ---
  const insertImageFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;

    setUploading(true);
    try {
      // Ensure note exists before attaching images
      let nid = effectiveNodeIdRef.current;
      if (!nid) {
        const t = title.trim() || 'Untitled Note';
        const wikiLinks = extractWikiLinks(content);
        const node = await graphStore.createNode({
          name: t,
          type: 'note',
          properties: { wikiLinks },
        });
        if (!node) return;
        nid = node.id;
        effectiveNodeIdRef.current = nid;
        // Write initial content to OPFS + search index
        const markdown = generateNoteMarkdown(t, content, wikiLinks);
        notes.write(nid, markdown).catch(() => {});
        noteSearch.upsert(nid, t, stripMarkdownToPlainText(content)).catch(() => {});
      }

      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? content.length;
      let insertText = '';

      for (const file of images) {
        const { data, mimeType } = await compressImage(file);
        const attachment = await noteAttachments.create(nid, file.name, mimeType, data);
        insertText += `![${file.name}](attachment:${attachment.id})\n`;
      }

      // Insert at cursor position
      const before = content.slice(0, cursorPos);
      const after = content.slice(cursorPos);
      setContent(before + insertText + after);
    } finally {
      setUploading(false);
    }
  }, [title, content, graphStore]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      insertImageFiles(files);
    },
    [insertImageFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        insertImageFiles(files);
      }
    },
    [insertImageFiles]
  );

  // Ctrl+S / Cmd+S to save — only when this tab is active
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (isTab) {
          const { contentColumns, activeColumnId } = useUIStore.getState();
          const activeCol = contentColumns.find(c => c.id === activeColumnId);
          if (activeCol?.activeTabId !== `note-${rawNodeId}`) return;
        }
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSave, isTab, rawNodeId]);

  return (
    <div className="p-4 space-y-3 flex flex-col h-full">
      <div className="flex items-center gap-2">
        {!isTab && (
          <button
            onClick={onBack}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            &larr; Back
          </button>
        )}
        <span className="text-xs text-zinc-500 ml-auto">
          {saved ? 'Saved!' : saving ? 'Saving...' : ''}
        </span>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title..."
        className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 font-medium"
      />

      {/* Write / Preview tabs */}
      <div className="flex border-b border-zinc-700 shrink-0">
        <button
          onClick={() => setActiveTab('write')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
            activeTab === 'write' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Write
          {activeTab === 'write' && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-indigo-500 rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
            activeTab === 'preview' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Preview
          {activeTab === 'preview' && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-indigo-500 rounded-full" />}
        </button>
      </div>

      {activeTab === 'write' ? (
        <div className="flex-1 flex flex-col relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onPaste={handlePaste}
            placeholder="Write your note... Use [[Node Label]] to link to entities. Drop or paste images."
            className="flex-1 w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-none font-mono min-h-[200px]"
          />
          {uploading && (
            <div className="absolute inset-0 bg-zinc-900/60 flex items-center justify-center rounded">
              <span className="text-xs text-zinc-400 flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                Uploading image...
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 overflow-y-auto min-h-[200px]">
          {content.trim() ? (
            <NoteMarkdownPreview content={content} onNodeClick={(nodeId) => {
              useGraphStore.getState().selectNode(nodeId);
              useUIStore.getState().forceActivePanel('nodeDetail');
            }} />
          ) : (
            <p className="text-zinc-600 text-sm italic">Nothing to preview</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <WikiLinkHints content={content} />
      </div>

      <button
        onClick={handleSave}
        disabled={!title.trim() || saving}
        className="w-full bg-indigo-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {nodeId ? 'Save Note' : 'Create Note'} <span className="text-xs opacity-60">Ctrl+S</span>
      </button>

      {showConflictModal && nodeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-5 max-w-sm mx-4 shadow-xl">
            <h3 className="text-sm font-medium text-zinc-100 mb-2">Note modified externally</h3>
            <p className="text-xs text-zinc-400 mb-4">
              This note was changed outside Synapse. You have unsaved edits.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => reloadFromDisk(nodeId)}
                className="flex-1 text-xs px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500"
              >
                Load external changes
              </button>
              <button
                onClick={() => setShowConflictModal(false)}
                className="flex-1 text-xs px-3 py-2 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
              >
                Keep my version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WikiLinkHints({ content }: { content: string }) {
  const links = extractWikiLinks(content);
  const nodes = useGraphStore((s) => s.nodes);

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {links.map((link) => {
        const exists = nodes.some(
          (n) => n.name.toLowerCase() === link.toLowerCase()
        );
        return (
          <span
            key={link}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              exists
                ? 'bg-emerald-900/40 text-emerald-400'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            [[{link}]]
            {exists ? ' (linked)' : ' (new)'}
          </span>
        );
      })}
    </div>
  );
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const label = match[1].split('|')[0].trim();
    if (label && !links.includes(label)) links.push(label);
  }
  return links;
}

async function createWikiLinkEdges(sourceNodeId: string, wikiLinks: string[]) {
  const graphStore = useGraphStore.getState();
  for (const linkLabel of wikiLinks) {
    const target = graphStore.nodes.find(
      (n) => n.name.toLowerCase() === linkLabel.toLowerCase()
    );
    if (target && target.id !== sourceNodeId) {
      try {
        await graphStore.createEdge({
          sourceId: sourceNodeId,
          targetId: target.id,
          label: 'references',
          type: 'reference',
        });
      } catch {
        // Edge may already exist
      }
    }
  }
}

function sanitizeFileName(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

async function compressImage(
  file: File,
  maxWidth = 800,
  quality = 0.8
): Promise<{ data: Uint8Array; mimeType: string }> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  // Use JPEG for photos, keep PNG for images with transparency
  const isPng = file.type === 'image/png';
  const blob = await canvas.convertToBlob({
    type: isPng ? 'image/png' : 'image/jpeg',
    quality: isPng ? undefined : quality,
  });
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    mimeType: isPng ? 'image/png' : 'image/jpeg',
  };
}
