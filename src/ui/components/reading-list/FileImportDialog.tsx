import { useState, useEffect, useCallback } from 'react';

interface FileImportDialogProps {
  files: Array<{ name: string; path: string }>;
  onConfirm: (opts: { imported: boolean; keepOriginal: boolean }) => void;
  onCancel: () => void;
}

export function FileImportDialog({ files, onConfirm, onCancel }: FileImportDialogProps) {
  const [imported, setImported] = useState(true);
  const [keepOriginal, setKeepOriginal] = useState(true);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-100">
            Add {files.length === 1 ? '1 File' : `${files.length} Files`}
          </h3>
          <div className="mt-1 max-h-16 overflow-y-auto">
            {files.map((f) => (
              <p key={f.path} className="text-xs text-zinc-400 truncate">
                {f.name}
              </p>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Import radio */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="import-mode"
              checked={imported}
              onChange={() => setImported(true)}
              className="mt-0.5 accent-indigo-500"
            />
            <div>
              <span className="text-sm text-zinc-200">Import into vault</span>
              <p className="text-xs text-zinc-500 mt-0.5">Copy the file into your vault's raw/ folder</p>
            </div>
          </label>

          {/* Keep original checkbox — only when import selected */}
          {imported && (
            <label className="flex items-center gap-2.5 ml-5 cursor-pointer">
              <input
                type="checkbox"
                checked={keepOriginal}
                onChange={(e) => setKeepOriginal(e.target.checked)}
                className="accent-indigo-500"
              />
              <span className="text-xs text-zinc-300">Keep original files after import</span>
            </label>
          )}

          {/* Reference radio */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="import-mode"
              checked={!imported}
              onChange={() => setImported(false)}
              className="mt-0.5 accent-indigo-500"
            />
            <div>
              <span className="text-sm text-zinc-200">Reference only</span>
              <p className="text-xs text-zinc-500 mt-0.5">Store the file path without copying</p>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-700 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ imported, keepOriginal: imported ? keepOriginal : false })}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
          >
            Add {files.length === 1 ? 'File' : 'Files'}
          </button>
        </div>
      </div>
    </div>
  );
}
