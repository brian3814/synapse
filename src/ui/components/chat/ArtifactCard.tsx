// src/ui/components/chat/ArtifactCard.tsx

import { useUIStore } from '../../../graph/store/ui-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';

const TYPE_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛',
  markdown: '📄',
  html: '🌐',
  svg: '◈',
  mermaid: '◇',
};

const TYPE_COLORS: Record<ArtifactType, string> = {
  jsx: 'bg-purple-900/40 text-purple-400',
  markdown: 'bg-teal-900/40 text-teal-400',
  html: 'bg-amber-900/40 text-amber-400',
  svg: 'bg-rose-900/40 text-rose-400',
  mermaid: 'bg-blue-900/40 text-blue-400',
};

interface ArtifactCardProps {
  artifactId: string;
  title: string;
  type: ArtifactType;
}

export function ArtifactCard({ artifactId, title, type }: ArtifactCardProps) {
  const openContentTab = useUIStore((s) => s.openContentTab);

  const handleOpen = () => {
    openContentTab({ kind: 'artifact', artifactId }, title);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden my-2">
      <div className="px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${TYPE_COLORS[type]}`}>
            <span className="text-base">{TYPE_ICONS[type]}</span>
          </div>
          <div className="min-w-0">
            <div className="text-zinc-200 text-xs font-medium truncate">{title}</div>
            <div className="text-zinc-500 text-[10px]">{ARTIFACT_TYPE_LABELS[type]}</div>
          </div>
        </div>
        <button
          onClick={handleOpen}
          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-md shrink-0 transition-colors"
        >
          Open
        </button>
      </div>
    </div>
  );
}
