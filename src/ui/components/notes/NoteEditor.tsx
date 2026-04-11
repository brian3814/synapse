import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { sourceContent, noteFolders, noteAttachments } from '../../../db/client/db-client';
import { parseMarkdown, generateNoteMarkdown } from '../../../filesystem/markdown-parser';
import { getStoredFolder, writeMarkdownFile } from '../../../filesystem/folder-access';
import { NoteMarkdownPreview } from '../shared/MarkdownRenderer';

type EditorTab = 'write' | 'preview';

interface NoteEditorProps {
  nodeId: string | null; // null = new note
  onBack: () => void;
}

export function NoteEditor({ nodeId, onBack }: NoteEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>('write');
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const graphStore = useGraphStore();
  // Track the effective note ID (may be created on-the-fly for image uploads)
  const effectiveNodeIdRef = useRef<string | null>(nodeId);

  // Load existing note
  useEffect(() => {
    if (!nodeId) return;

    const node = graphStore.nodes.find((n) => n.id === nodeId);
    if (node) {
      setTitle(node.name);
      setFolderPath(node.folderPath ?? '');
      // Load content from source_content or properties
      if (typeof node.properties?.content === 'string') {
        setContent(node.properties.content);
      }
      // Also try loading from source_content table
      sourceContent.getByNodeId(nodeId).then((sc: any) => {
        if (sc?.content) {
          const parsed = parseMarkdown(sc.content);
          setContent(parsed.content);
        }
      }).catch(() => {});
    }
  }, [nodeId]);

  // Load the set of folder choices (distinct folder_paths from notes + markers).
  useEffect(() => {
    (async () => {
      try {
        const markers = await noteFolders.getAll();
        const noteFolderPaths = new Set<string>(['']);
        for (const n of useGraphStore.getState().nodes) {
          if (n.type === 'note' && n.folderPath) noteFolderPaths.add(n.folderPath);
        }
        for (const m of markers) noteFolderPaths.add(m.path);
        setFolderOptions([...noteFolderPaths].sort());
      } catch {
        setFolderOptions(['']);
      }
    })();
  }, []);

  // Auto-focus textarea
  useEffect(() => {
    if (!nodeId) textareaRef.current?.focus();
  }, [nodeId]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);

    try {
      const wikiLinks = extractWikiLinks(content);
      const properties = { content, wikiLinks };

      if (nodeId) {
        // Update existing note
        await graphStore.updateNode({
          id: nodeId,
          name: title,
          folderPath,
          properties,
        });

        // Update source content
        await sourceContent.save({
          nodeId,
          url: `note://${nodeId}`,
          title,
          content: generateNoteMarkdown(title, content, wikiLinks),
        });
      } else {
        // Create new note node
        const node = await graphStore.createNode({
          name: title,
          type: 'note',
          folderPath,
          properties,
        });

        if (node) {
          // Save source content
          await sourceContent.save({
            nodeId: node.id,
            url: `note://${node.id}`,
            title,
            content: generateNoteMarkdown(title, content, wikiLinks),
          });

          // Create edges for wiki-links
          await createWikiLinkEdges(node.id, wikiLinks);
        }
      }

      // Optionally sync to filesystem
      try {
        const folderHandle = await getStoredFolder();
        if (folderHandle) {
          const fileName = sanitizeFileName(title) + '.md';
          const markdown = generateNoteMarkdown(title, content, wikiLinks);
          await writeMarkdownFile(folderHandle, `notes/${fileName}`, markdown);
        }
      } catch {
        // Folder not connected or permission denied — that's fine
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      if (!nodeId) {
        onBack();
      }
    } catch (e: any) {
      console.error('[NoteEditor] Save failed:', e);
    } finally {
      setSaving(false);
    }
  }, [title, content, nodeId, graphStore, onBack]);

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
        const node = await graphStore.createNode({
          name: t,
          type: 'note',
          properties: { content },
        });
        if (!node) return;
        nid = node.id;
        effectiveNodeIdRef.current = nid;
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

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSave]);

  return (
    <div className="p-4 space-y-3 flex flex-col h-full">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
        >
          &larr; Back
        </button>
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

      {/* Folder selection (three-layer model: Phase 5) */}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="shrink-0">Folder:</span>
        <select
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 outline-none focus:border-indigo-500"
        >
          {folderOptions.map((opt) => (
            <option key={opt || '__root__'} value={opt}>
              {opt === '' ? '(root)' : opt}
            </option>
          ))}
          {/* Allow typing a brand-new path by always listing the current value */}
          {!folderOptions.includes(folderPath) && folderPath && (
            <option value={folderPath}>{folderPath}</option>
          )}
        </select>
      </div>

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
