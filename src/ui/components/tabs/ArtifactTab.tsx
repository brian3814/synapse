import { useState, useEffect, useCallback } from 'react';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { SvgRenderer } from '../artifacts/SvgRenderer';
import { MermaidRenderer } from '../artifacts/MermaidRenderer';
import { HtmlRenderer } from '../artifacts/HtmlRenderer';
import { JsxRenderer } from '../artifacts/JsxRenderer';
import { ArtifactEditor } from '../artifacts/ArtifactEditor';

interface ArtifactTabProps { artifactId: string; }
type ViewMode = 'preview' | 'source';

export function ArtifactTab({ artifactId }: ArtifactTabProps) {
  const artifacts = useArtifactStore((s) => s.artifacts);
  const getContent = useArtifactStore((s) => s.getArtifactContent);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>('preview');
  const [editContent, setEditContent] = useState('');
  const [modified, setModified] = useState(false);

  const artifact = artifacts.find((a) => a.id === artifactId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getContent(artifactId).then((c) => {
      if (!cancelled) { setContent(c); setEditContent(c); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [artifactId, getContent]);

  const handleSave = useCallback(async () => {
    const { updateArtifact } = useArtifactStore.getState();
    await updateArtifact(artifactId, editContent);
    setContent(editContent);
    setModified(false);
  }, [artifactId, editContent]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
  }, [content]);

  const handleEditChange = useCallback((value: string) => {
    setEditContent(value);
    setModified(value !== content);
  }, [content]);

  if (!artifact) {
    return <div className="h-full flex items-center justify-center bg-zinc-900"><p className="text-zinc-500 text-xs">Artifact not found</p></div>;
  }
  if (loading) {
    return <div className="h-full flex items-center justify-center bg-zinc-900"><p className="text-zinc-500 text-xs">Loading...</p></div>;
  }

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-purple-900/40 text-purple-400 px-1.5 py-0.5 rounded">
            {ARTIFACT_TYPE_LABELS[artifact.type]}
          </span>
          {modified ? (
            <span className="text-amber-400 text-[10px]">{'●'} Modified</span>
          ) : (
            <span className="text-zinc-500 text-[10px]">{formatTime(artifact.updatedAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex bg-zinc-800 rounded-md p-0.5">
            <button onClick={() => setMode('preview')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Preview</button>
            <button onClick={() => setMode('source')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mode === 'source' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>Source</button>
          </div>
          <button onClick={handleCopy} className="px-2 py-0.5 bg-zinc-800 text-zinc-300 text-[10px] rounded hover:bg-zinc-700">Copy</button>
          {mode === 'source' && modified && (
            <button onClick={handleSave} className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] rounded font-medium hover:bg-emerald-500">Save</button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === 'preview' ? (
          <ArtifactPreview type={artifact.type} content={content} />
        ) : (
          <ArtifactEditor content={editContent} onChange={handleEditChange} type={artifact.type} />
        )}
      </div>
    </div>
  );
}

function ArtifactPreview({ type, content }: { type: ArtifactType; content: string }) {
  switch (type) {
    case 'markdown':
      return <div className="h-full overflow-y-auto p-4"><MarkdownRenderer content={content} /></div>;
    case 'svg':
      return <SvgRenderer content={content} />;
    case 'mermaid':
      return <MermaidRenderer content={content} />;
    case 'html':
      return <HtmlRenderer content={content} />;
    case 'jsx':
      return <JsxRenderer content={content} />;
    default:
      return <pre className="p-4 text-zinc-400 text-xs font-mono overflow-auto h-full">{content}</pre>;
  }
}
