import { useState } from 'react';

interface ImportConfirmDialogProps {
  fileNames: string[];
  onConfirm: (deleteOriginals: boolean, remember: boolean) => void;
}

export function ImportConfirmDialog({ fileNames, onConfirm }: ImportConfirmDialogProps) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl p-5 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-zinc-100 mb-2">File imported</h3>
        <p className="text-[12px] text-zinc-400 mb-1">
          {fileNames.length === 1
            ? <><span className="text-zinc-200">{fileNames[0]}</span> has been copied to the vault.</>
            : <><span className="text-zinc-200">{fileNames.length} files</span> have been copied to the vault.</>
          }
        </p>
        <p className="text-[12px] text-zinc-400 mb-4">
          Would you like to keep or delete the original {fileNames.length === 1 ? 'file' : 'files'}?
        </p>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
          />
          <span className="text-[11px] text-zinc-400">Don't ask again</span>
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onConfirm(false, remember)}
            className="px-3 py-1.5 text-[12px] rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            Keep original
          </button>
          <button
            onClick={() => onConfirm(true, remember)}
            className="px-3 py-1.5 text-[12px] rounded bg-red-600/80 text-white hover:bg-red-600 transition-colors"
          >
            Delete original
          </button>
        </div>
      </div>
    </div>
  );
}
