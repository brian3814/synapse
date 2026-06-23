import { SUPPORTED_FILE_EXTENSIONS } from '../../../shared/reading-list-types';

interface DropZoneOverlayProps {
  visible: boolean;
}

export function DropZoneOverlay({ visible }: DropZoneOverlayProps) {
  if (!visible) return null;

  const extensions = Array.from(SUPPORTED_FILE_EXTENSIONS)
    .map((ext) => ext.slice(1).toUpperCase())
    .join(', ');

  return (
    <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center bg-zinc-900/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-indigo-500 rounded-xl mx-6">
        {/* File icon */}
        <svg
          className="w-10 h-10 text-indigo-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>

        <p className="text-sm font-medium text-zinc-100">Drop files to add</p>
        <p className="text-xs text-zinc-400 text-center leading-relaxed">
          {extensions}
        </p>
      </div>
    </div>
  );
}
