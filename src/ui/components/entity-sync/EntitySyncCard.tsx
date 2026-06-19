import type { SyncNotification } from '../../../shared/entity-sync-types';

const BADGE_STYLES = {
  title_mismatch: { bg: 'bg-amber-800 text-amber-200', label: 'Title mismatch' },
  new_file: { bg: 'bg-emerald-800 text-emerald-200', label: 'New file' },
  unknown_id: { bg: 'bg-red-800 text-red-200', label: 'Unknown ID' },
  link_broken: { bg: 'bg-amber-800 text-amber-200', label: 'Broken link' },
  link_dead: { bg: 'bg-red-800 text-red-200', label: 'Dead link' },
  link_missing: { bg: 'bg-blue-800 text-blue-200', label: 'Relationship suggestion' },
} as const;

interface Props {
  notification: SyncNotification;
  onAction: (id: string, action: string) => void;
}

export function EntitySyncCard({ notification, onAction }: Props) {
  const n = notification;
  const style = BADGE_STYLES[n.type];

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${style.bg}`}>
          {style.label}
        </span>
        <span className="text-xs text-zinc-400 truncate">{n.filePath.split('/').pop()}</span>
      </div>

      {n.detail.kind === 'title_mismatch' && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">DB: <span className="text-zinc-200">"{n.detail.dbName}"</span></p>
          <p className="text-zinc-400">File: <span className="text-zinc-200">"{n.detail.fileTitle}"</span></p>
          <div className="flex gap-1 pt-1">
            <button onClick={() => onAction(n.id, 'rename_entity')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Rename entity</button>
            <button onClick={() => onAction(n.id, 'revert_file_title')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Revert file title</button>
            <button onClick={() => onAction(n.id, 'dismiss')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-400 rounded hover:bg-zinc-600">Dismiss</button>
          </div>
        </div>
      )}

      {n.detail.kind === 'new_file' && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">Title: <span className="text-zinc-200">"{n.detail.parsedTitle ?? 'Untitled'}"</span></p>
          <div className="flex gap-1 pt-1">
            <button onClick={() => onAction(n.id, 'create_entity')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Create entity</button>
            <button onClick={() => onAction(n.id, 'ignore_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Ignore file</button>
            <button onClick={() => onAction(n.id, 'delete_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Delete file</button>
          </div>
        </div>
      )}

      {n.detail.kind === 'unknown_id' && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">References unknown node ID</p>
          <div className="flex gap-1 pt-1">
            <button onClick={() => onAction(n.id, 'delete_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Delete file</button>
            <button onClick={() => onAction(n.id, 'dismiss')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-400 rounded hover:bg-zinc-600">Dismiss</button>
          </div>
        </div>
      )}

      {(n.detail.kind === 'link_broken' || n.detail.kind === 'link_dead' || n.detail.kind === 'link_missing') && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">
            {n.detail.kind === 'link_broken' && <>[[{n.detail.linkText}]] → [[{n.detail.suggestedFix}]]</>}
            {n.detail.kind === 'link_dead' && <>[[{n.detail.linkText}]] — entity was deleted</>}
            {n.detail.kind === 'link_missing' && <>Missing: [[{n.detail.linkText}]] — *{n.detail.edgeLabel}*</>}
          </p>
          <div className="flex gap-1 pt-1">
            {n.detail.kind === 'link_broken' && (
              <button onClick={() => onAction(n.id, 'fix_link')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Fix</button>
            )}
            {n.detail.kind === 'link_dead' && (
              <>
                <button onClick={() => onAction(n.id, 'remove_line')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Remove line</button>
                <button onClick={() => onAction(n.id, 'keep_as_text')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Keep as text</button>
              </>
            )}
            {n.detail.kind === 'link_missing' && (
              <button onClick={() => onAction(n.id, 'add_to_file')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Add to file</button>
            )}
            <button onClick={() => onAction(n.id, 'dismiss')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-400 rounded hover:bg-zinc-600">Ignore</button>
          </div>
        </div>
      )}
    </div>
  );
}
